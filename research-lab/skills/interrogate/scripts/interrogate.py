#!/usr/bin/env python3
"""Deterministic preparation and scoring for independent examiners."""
import argparse
import json
import re
import sys
from pathlib import Path

RUBRIC = {
    'evidence-strength': ['No source supports it', 'Limited or weak support', 'Credible support with limitations', 'Several independent sources, quoted'],
    'rival-explanations': [
        'A stronger rival supported by the corpus defeats the claim',
        'A plausible rival supported by the corpus remains unaddressed or unresolved',
        'After checking the corpus, no supported rival materially weakens the claim; explicitly naming a rival is not required',
        'Plausible rivals are explicitly ruled out with evidence from the corpus',
    ],
    'reproducibility': ['Cannot be re-derived', 'Important steps or sources are missing', 'Mostly re-derivable with some uncertainty', 'Re-derived from the cited sources'],
    'internal-consistency': ['Contradicts itself or its evidence', 'Major tensions remain', 'Mostly consistent with minor tensions', 'Consistent throughout'],
    'relevance': ['Does not bear on the goal', 'Only tangentially bears on the goal', 'Substantially informs the goal', 'Decides part of the goal'],
}
RULES = '''- Check the corpus before scoring; every reason must cite a quote copied exactly from the corpus or the evidence. A score without a citation is invalid.
- You see only this submission; judge it, do not fix it.
- Do not end your turn while your own background work runs.
- A usage-limit reply is a failure, never a result.
- Read-only; write nothing. Start no child agents.
- Last message: one fenced ```json block in this exact schema; prose outside it is ignored:
  {"score":0|1|2|3,"reasons":["..."],"citations":[{"source":"<path or 'evidence'>","quote":"<exact text>"}],"fatal":false,"fatal_reason":null}'''

def read(path):
    return json.loads(Path(path).read_text())

def norm(s):
    return ' '.join(s.split())

def corpus(sub):
    texts = [str(sub.get('evidence', ''))]
    for name in sub.get('corpus', {}).get('paths', []):
        path = Path(name)
        for f in ([path] if path.is_file() else path.rglob('*') if path.is_dir() else []):
            try:
                if f.is_file() and f.stat().st_size < 2_000_000:
                    texts.append(f.read_text(encoding='utf-8'))
            except (OSError, UnicodeError):
                pass
    return [norm(x) for x in texts]

def brief(sub, dim):
    anchors = '\n'.join(f'{i}: {s}' for i, s in enumerate(RUBRIC[dim]))
    return f'You are an examiner for ONE dimension: {dim}.\n\n{anchors}\n\nSubmission:\n{json.dumps(sub, indent=2, ensure_ascii=False)}\n\n{RULES}\n'

def validate(result, texts):
    if not isinstance(result, dict) or type(result.get('score')) is not int or result['score'] not in range(4):
        raise ValueError('schema violation')
    reasons, citations = result.get('reasons'), result.get('citations')
    if not isinstance(reasons, list) or not reasons or not all(isinstance(x, str) and x.strip() for x in reasons) or not isinstance(citations, list) or type(result.get('fatal')) is not bool or not (result.get('fatal_reason') is None or isinstance(result.get('fatal_reason'), str)) or 'fatal_reason' not in result:
        raise ValueError('schema violation')
    if any(re.search(r'usage limit|rate limit|quota', x, re.I) for x in reasons):
        raise ValueError('usage limit')
    checked = []
    for c in citations:
        if not isinstance(c, dict) or not isinstance(c.get('source'), str) or not isinstance(c.get('quote'), str):
            raise ValueError('schema violation')
        q = norm(c['quote'])
        checked.append({**c, 'verified': len(q) >= 12 and any(q in text for text in texts)})
    if not any(c['verified'] for c in checked):
        raise ValueError('uncited score')
    return {**result, 'citations': checked}

def main():
    p = argparse.ArgumentParser()
    sp = p.add_subparsers(dest='command', required=True)
    for name in ['check', 'briefs', 'rebuttal', 'verdict']:
        q = sp.add_parser(name); q.add_argument('submission')
        if name in ('briefs', 'rebuttal', 'verdict'): q.add_argument('--out', required=True)
        if name in ('rebuttal', 'verdict'): q.add_argument('--results', required=True)
        if name == 'verdict': q.add_argument('--md'); q.add_argument('--calls', type=int, default=0)
    q = sp.add_parser('extract'); q.add_argument('reply_file')
    a = p.parse_args()
    if a.command == 'extract':
        raw = Path(a.reply_file).read_text()
        blocks = re.findall(r'```json\s*(.*?)```', raw, re.I | re.S)
        candidates = list(reversed(blocks)) if blocks else [raw]
        for candidate in candidates:
            try:
                obj = json.loads(candidate)
                if isinstance(obj, dict): print(json.dumps(obj)); return 0
            except ValueError: pass
        return 3
    sub = read(a.submission)
    if a.command == 'check':
        for key in ('claim', 'evidence'):
            if not str(sub.get(key) or '').strip(): print('no ' + key, file=sys.stderr); return 2
        if not sub.get('goal'): print('warning: no goal; relevance will score against the question', file=sys.stderr)
        print('ok'); return 0
    if a.command in ('briefs', 'rebuttal'):
        out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
        for dim in RUBRIC:
            content = brief(sub, dim)
            if a.command == 'rebuttal':
                result = read(Path(a.results) / f'{dim}.r1.json')
                if result['score'] > 1: continue
                content += '\nRound 1: ' + json.dumps({k: result[k] for k in ('score', 'reasons', 'citations')}) + '\nGo back to the evidence and corpus once. Look for the strongest answer to these objections. Re-score; same schema.\n'
                print(dim)
            (out / f'brief-{dim}{".r2" if a.command == "rebuttal" else ""}.md').write_text(content)
        return 0
    dimensions, errors = {}, []
    texts = corpus(sub)
    for dim in RUBRIC:
        r2 = Path(a.results) / f'{dim}.r2.json'; r1 = Path(a.results) / f'{dim}.r1.json'
        path = r2 if r2.exists() else r1
        try:
            # Round 1 remains required even when a later file exists.
            if not r1.exists(): raise ValueError('missing round 1 result')
            result = validate(read(path), texts)
            dimensions[dim] = {**result, 'dimension': dim, 'round': 2 if path == r2 else 1}
        except (ValueError, OSError, TypeError) as e:
            errors.append({'dimension': dim, 'reason': str(e)})
    low = [d for d, v in dimensions.items() if v['score'] <= 1]
    if errors: verdict = 'incomplete'
    elif dimensions['evidence-strength']['score'] == 0 or any(v['score'] == 0 and v['fatal'] and (v['fatal_reason'] or '').strip() for v in dimensions.values()): verdict = 'rejected'
    elif not low: verdict = 'survived'
    else: verdict = 'contested'
    result = {'verdict': verdict, 'low_dimensions': low, 'errors': errors, 'dimensions': dimensions, 'rounds': max((x['round'] for x in dimensions.values()), default=1), 'calls': a.calls}
    Path(a.out).write_text(json.dumps(result, indent=2) + '\n')
    if a.md:
        lines = ['| Dimension | Score |', '| --- | --- |'] + [f'| {d} | {dimensions[d]["score"] if d in dimensions else "error"} |' for d in RUBRIC]
        Path(a.md).write_text('\n'.join(lines) + f'\n\nVerdict: **{verdict}**\n')
    return 0

if __name__ == '__main__':
    sys.exit(main())
