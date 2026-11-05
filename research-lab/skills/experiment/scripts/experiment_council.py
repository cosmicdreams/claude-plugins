"""Blind, position-swapped pairwise council adapter for compare engagements."""
import itertools
import json
from pathlib import Path
import random
import re
import shlex
import subprocess
import tempfile

import judged
from experiment_loop import ending, git, ownership, require, require_clean, save, shell


def protocol(text):
    match = re.search(r'```judging-protocol\s*\n(.*?)\n```', text, re.S)
    require(match, 'council requires a judging-protocol block')
    p = json.loads(match[1])
    require(isinstance(p, dict) and p.get('artifact_command') and p.get('categories'),
            'council requires artifact_command and categories')
    require(isinstance(p.get('judges'), list) and p['judges'], 'council requires judges')
    roles = [j['role'] for j in p['judges']]
    require(1 <= len(roles) <= 4 and len(set(roles)) == len(roles) and
            all(re.fullmatch(r'[a-z][a-z0-9-]*', r) for r in roles), 'invalid judge roles')
    p.setdefault('references', [])
    p.setdefault('guardrails', [])
    return p


def artifact(s, p, base):
    """Capture the checked-out variant, validating the judged artifact manifest."""
    with tempfile.TemporaryDirectory(prefix='council-compare-') as tmp:
        out = Path(tmp)
        result = subprocess.run(judged.command_parts(p['artifact_command'], base) +
                                [s['worktree'], str(out)], capture_output=True, timeout=1800)
        require(result.returncode == 0, 'artifact command failed')
        manifest = judged.read_json(out / 'manifest.json')
        require(isinstance(manifest, dict) and manifest.get('tree') == git(s['worktree'], 'rev-parse', 'HEAD^{tree}')
                and isinstance(manifest.get('files'), list) and manifest['files'], 'invalid artifact manifest')
        texts = []
        for entry in manifest['files']:
            path = (out / entry['path']).resolve()
            require(path.is_relative_to(out.resolve()), 'invalid artifact path')
            data = path.read_bytes()
            require(judged.digest(data) == entry['sha256'], 'artifact hash mismatch')
            texts.append(data.decode('utf-8'))
        return '\n\n'.join(texts)


def open_round(a, e, s, c):
    from experiment import council_transport
    from experiment_compare import next_action, restore
    council_transport(s['transport'])
    require(next_action(s, c)['action'] == 'measure', 'build all variants first')
    require(a.panel, 'measure council requires --panel')
    ownership(s, s['base'])
    base = Path(s['methodology']).parent
    p = protocol(Path(s['methodology']).read_text())
    panel = judged.load_panel(Path(a.panel), p)
    # Freeze inputs before running any variant commands.
    references = [(base / name).read_text(encoding='utf-8') for name in p['references']]
    texts = {}
    try:
        for name, v in s['variants'].items():
            if not v['commit']:
                continue
            try:
                git(s['worktree'], 'switch', '--detach', v['commit'])
                passed = all(shell(s['worktree'], cmd).returncode == 0
                             for cmd in [c['Checks'], *[shlex.join(judged.command_parts(g, base)) for g in p['guardrails']]])
                v['checks'] = passed
                require_clean(s['worktree'], measurement=True)
                require(passed, 'Checks failed')
                texts[name] = artifact(s, p, base)
                require_clean(s['worktree'], measurement=True)
                v.update(status='measured', checks=True)
            except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as exc:
                v.update(status='invalid', reason=str(exc))
            finally:
                restore(s)
        cost = len(texts) * (len(texts) - 1) * len(panel)
        require(s['measurements_used'] + cost <= c['Budget'], 'judge request budget spent')
        dest = e / 'evals/e0001'
        require(not dest.exists(), 'pairwise round already exists')
        meta = dict(id=dest.name, purpose='pairwise', panel=panel, transport=s['transport'],
                    requests=cost, variants=list(texts), pairs=[], request_list=[])
        rng = random.Random(a.seed)
        for i, pair in enumerate(itertools.combinations(texts, 2)):
            meta['pairs'].append(list(pair))
            for role in panel:
                order = list(pair)
                if rng.randrange(2): order.reverse()
                for swap in range(2):
                    mapping = dict(zip(('X', 'Y'), order if swap == 0 else order[::-1]))
                    k = i * 2 + swap + 1
                    text = ('Judge only the supplied text. Do not read files or run commands. '
                            'Prefer the artifact that best meets the rubric. References are context. '
                            'Return only JSON: {"preferred": "X", "critique": "one sentence"}. '
                            'preferred must be X, Y or tie.\n\n')
                    text += '\n'.join(f'{cat}: {rubric}' for cat, rubric in p['categories'].items())
                    text += '\n\n' + '\n\n'.join(f'## {label}\n{texts[name]}' for label, name in mapping.items())
                    text += '\n\n' + '\n\n'.join(f'## Reference {j}\n{ref}' for j, ref in enumerate(references, 1))
                    meta['request_list'].append(judged.prepare_request(dest / f'{role}-{k}', role, k, mapping, text))
        judged.write_json(dest / 'eval.json', meta)
        s.update(council_round=dest.name, measurements_used=s['measurements_used'] + cost,
                 trials_used=s['measurements_used'] + cost)
        save(e, s)
        return dict(action='dispatch', eval=dest.name, transport=s['transport'], requests=meta['request_list'])
    finally:
        restore(s)
        save(e, s)


def record(a, e, s):
    dest = e / 'evals' / s['council_round']
    meta = judged.read_json(dest / 'eval.json')
    directory = Path(a.request).resolve()
    require(str(directory) in {r['dir'] for r in meta['request_list']}, 'unknown request')
    return judged.record_request(directory, judged.read_json(Path(a.return_file)),
                                 judged.read_json(Path(a.invocation_file)))


def unrecorded_requests(e, s):
    meta = judged.read_json(e / 'evals' / s['council_round'] / 'eval.json')
    return [dict(dir=r['dir'], role=r['role']) for r in meta['request_list']
            if not (Path(r['dir']) / 'return.json').is_file()]


def score_round(e, s, c):
    from experiment_compare import choose, next_action
    ownership(s, s['base'])
    require(s.get('council_round') and not s.get('council_result'), 'no unscored pairwise round')
    remaining = unrecorded_requests(e, s)
    require(not remaining, f'{len(remaining)} requests unrecorded')
    dest = e / 'evals' / s['council_round']
    meta = judged.read_json(dest / 'eval.json')
    table, invalid, inconsistent = [], [], dict.fromkeys(meta['panel'], 0)
    beaten = set()
    wins = dict.fromkeys(meta['variants'], 0)
    for i, pair in enumerate(meta['pairs']):
        preferences, rows = [], []
        for role in meta['panel']:
            orders = []
            for swap in range(2):
                directory = dest / f'{role}-{i * 2 + swap + 1}'
                mapping = judged.read_json(directory / 'mapping.json')
                try:
                    data = judged.request_return(directory, meta['panel'][role], 'preferred')
                    require(data['preferred'] in ('X', 'Y', 'tie') and isinstance(data.get('critique'), str),
                            'invalid preference or critique')
                    value = mapping[data['preferred']] if data['preferred'] != 'tie' else 'tie'
                    rows.append(dict(role=role, order=swap + 1, first=mapping['X'], preferred=value,
                                     critique=data['critique']))
                except (ValueError, OSError, KeyError, TypeError) as exc:
                    value = 'invalid'
                    invalid.append(dict(request=directory.name, reason=str(exc)))
                    rows.append(dict(role=role, order=swap + 1, first=mapping['X'], preferred='invalid', critique=str(exc)))
                orders.append(value)
            if 'invalid' not in orders and orders[0] != orders[1]: inconsistent[role] += 1
            preferences.append(orders[0] if orders[0] == orders[1] else 'tie')
        winner = preferences[0] if len(set(preferences)) == 1 and preferences[0] in pair else None
        if winner:
            wins[winner] += 1
            beaten.add(next(n for n in pair if n != winner))
        table.append(dict(pair=pair, winner=winner, orders=rows))
    result = dict(status='invalid' if invalid else 'valid', pairwise=table,
                  position_inconsistencies=inconsistent, invalid_requests=invalid)
    judged.write_json(dest / 'result.json', result)
    s['council_result'] = result
    names = meta['variants']
    if invalid:
        ending(s, 'paused', 'invalid council requests; inspect pairwise result')
    elif not names:
        ending(s, 'no-path', 'no variant is viable')
    elif 'incumbent' in names and 'incumbent' not in beaten:
        ending(s, 'no-path', 'incumbent unbeaten')
    elif len(names) > 1 and any(wins[n] == len(names) - 1 for n in names):
        name = next(n for n in names if wins[n] == len(names) - 1)
        choose(s, name, 'council: unanimous', 'position-consistent unanimous preference')
    else:
        s['group'] = [n for n in names if n not in beaten]
        # A unanimous cycle has no unbeaten member; all viable variants need review.
        if not s['group']: s['group'] = names
    save(e, s)
    return dict(result=result, **next_action(s, c))


def report(e, s, c):
    from experiment_report import cell
    ownership(s, s['base'])
    result = s.get('council_result', {})
    end = s.get('ending') or {}
    lines = ['## Council comparison', '', f"Ending: {end.get('kind', 'running')}; {end.get('detail', '')}",
             f"Decision basis: {end.get('basis', 'pending trade-offs' if s.get('group') else 'none')}",
             f"Winner: {end.get('winner', 'none')}; adopt branch: {end.get('branch', 'none')}", f"Judge requests used: {s['measurements_used']}", '',
             '| Pair | Judge | Order | First shown | Preference | Pair winner | Critique |',
             '| --- | --- | --- | --- | --- | --- | --- |']
    for row in result.get('pairwise', []):
        for order in row['orders']:
            lines.append('| ' + ' | '.join(cell(str(x)) for x in
                [' / '.join(row['pair']), order['role'], order['order'], order['first'],
                 order['preferred'], row['winner'] or 'tie', order['critique']]) + ' |')
    lines += ['', '## Position inconsistencies', '']
    lines += [f'- {role}: {count}' for role, count in result.get('position_inconsistencies', {}).items()]
    lines += ['', '## Variants and trade-offs', '',
              "| Variant | Status | Checks | Tradeoff | Reason | Commit | worth adopting? (agent's view) |",
              '| --- | --- | --- | --- | --- | --- | --- |']
    for name, v in s['variants'].items():
        checks = 'PASS' if v.get('checks') is True else 'FAIL' if v.get('checks') is False else '—'
        lines.append('| ' + ' | '.join(cell(str(x)) for x in
            [name, v['status'], checks, v['tradeoff'], v.get('reason', ''), v['commit'], '_']) + ' |')
    lines += ['', 'Unbeaten review group: ' + ', '.join(s.get('group') or [])]
    path = e / 'report.md'
    path.write_text('\n'.join(lines) + '\n')
    return dict(path=str(path))
