#!/usr/bin/env python3
"""Interface placeholder for judged experiment state transitions."""
import argparse
import json
import sys

parser = argparse.ArgumentParser()
sub = parser.add_subparsers(dest='command', required=True)
for name in ('validate', 'capture', 'trial', 'open', 'score', 'abandon',
             'invalidate', 'checks', 'resolve', 'next'):
    p = sub.add_parser(name)
    if name == 'trial':
        p.add_argument('operation', choices=('begin', 'commit'))
    p.add_argument('--engagement', required=True)
    p.add_argument('--protocol', required=True)
    for commands, flag, options in (
        ('validate', 'host', dict(required=False)),
        ('capture trial checks resolve next', 'worktree', dict(required=name != 'resolve')),
        ('capture', 'role', dict(choices=('incumbent', 'candidate'))),
        ('trial', 'change', dict(required=False)),
        ('open next', 'panel', {}),
        ('open', 'purpose', dict(choices=('calibrate', 'confirm', 'measure'))),
        ('open', 'seed', dict(type=int)),
        ('score abandon invalidate checks', 'eval', {}),
        ('invalidate', 'reason', {}),
        ('checks', 'details', dict(required=False)),
        ('resolve', 'decision', dict(choices=('withdraw', 'retry', 'continue', 'reject'))),
        ('resolve', 'note', {}),
    ):
        if name in commands.split():
            p.add_argument('--' + flag, **({'required': True} | options))
    if name == 'checks':
        g = p.add_mutually_exclusive_group(required=True)
        for flag in ('passed', 'failed'):
            g.add_argument('--' + flag, action='store_true')

import hashlib
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile


def read_json(path, default=None):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default


def records(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()] if path.exists() else []


def append(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a', encoding='utf-8') as f:
        f.write(json.dumps(value, ensure_ascii=False) + '\n')


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.tmp-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(value, f, ensure_ascii=False)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)
    return value


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def methodology(path):
    text = path.read_text(encoding='utf-8')
    sections = {int(m.group(1)): m.group(3).strip() for m in re.finditer(
        r'^##\s+(\d+)\.\s*([^\n]*)\n(.*?)(?=^##\s+\d+\.|\Z)', text, re.M | re.S)}
    one = sections.get(1, '')
    metric = re.search(r'^metric_type:\s*(\S+)', one, re.M)
    direction = re.search(r'^direction:\s*(\S+)', one, re.M)
    fence = re.search(r'```judging-protocol\s*\n(.*?)\n```', sections.get(9, ''), re.S)
    protocol = json.loads(fence.group(1)) if fence else None
    if protocol is not None:
        protocol.setdefault('iterations', 20); protocol.setdefault('futility', 5)
    return sections, metric.group(1) if metric else 'scripted', direction.group(1) if direction else None, protocol


def command_parts(command, base):
    parts = shlex.split(command)
    if not parts: raise ValueError('empty command')
    parts[0] = str((base / parts[0]).resolve())
    return parts


def capture_fingerprint(p, base):
    cmd = p['artifact_command']
    return digest(canonical([cmd, Path(command_parts(cmd, base)[0]).read_bytes().hex()]))


def reference_manifest(p, base):
    return [{'path': name, 'sha256': digest((base / name).read_bytes())} for name in p['references']]


def protocol_fingerprint(p, base, engagement, sections):
    manifest = read_json(engagement / 'references/manifest.json')
    if manifest is None: manifest = reference_manifest(p, base)
    guards = []
    for cmd in p['guardrails']:
        path = Path(command_parts(cmd, base)[0])
        guards.append([cmd, path.read_bytes().hex() if path.is_file() else None])
    return digest(canonical(dict(categories=p['categories'], relative_to=p['relative_to'], references=manifest,
                                 margin_floor=p['margin_floor'], judges=p['judges'],
                                 cfp=capture_fingerprint(p, base), guardrails=guards, correctness=sections.get(6, ''))))


def load_panel(path, p):
    panel = read_json(path)
    if set(panel) != {j['role'] for j in p['judges']} or any(
        not isinstance(v, dict) or not {'provider', 'model', 'options'} <= v.keys() or not isinstance(v['options'], dict)
        for v in panel.values()): raise ValueError('invalid panel')
    return panel


def git(work, *args):
    return subprocess.run(['git', '-C', str(work), *args], check=True, capture_output=True, text=True).stdout.strip()


def pending_trial(engagement, results=None):
    trial = read_json(engagement / 'trial.json')
    results = records(engagement / 'results.jsonl') if results is None else results
    if trial and not any(r.get('iteration') == trial['iteration'] and r.get('decision') in ('keep', 'discard', 'skip') for r in results):
        return trial
    return None


def evals(engagement):
    return [read_json(p) for p in sorted((engagement / 'evals').glob('e[0-9]*/eval.json'), key=lambda p: int(p.parent.name[1:]))]


def captures(engagement, tree, cfp):
    return sorted((engagement / 'captures').glob(f'{tree}-{cfp[:12]}-*'), key=lambda p: int(p.name.rsplit('-', 1)[1]))


def incumbent_tree(engagement, current, results=None):
    results = records(engagement / 'results.jsonl') if results is None else results
    resolutions = records(engagement / 'resolutions.jsonl')
    events = [(i + 1, 0, r.get('tree')) for i, r in enumerate(results) if r.get('decision') in ('keep', 'calibrate') and r.get('tree')]
    events += [(r['results_lines'], 1, r.get('tree')) for r in resolutions if r.get('decision') == 'continue' and r.get('adopted') and r.get('tree')]
    return max(events)[2] if events else current


def active_calibration(engagement, panel, fingerprint):
    results = records(engagement / 'results.jsonl')
    found = [(i, r) for i, r in enumerate(results) if r.get('decision') == 'calibrate']
    if not found: return None, True
    i, record = found[-1]
    meta = read_json(engagement / 'evals' / record.get('eval', '') / 'eval.json', {})
    stale = meta.get('panel') != panel or meta.get('fingerprint') != fingerprint
    stale |= any(r.get('results_lines', 0) >= i + 1 and (r.get('decision') == 'withdraw' or (r.get('decision') == 'continue' and r.get('adopted'))) for r in records(engagement / 'resolutions.jsonl'))
    return record, bool(stale)


def retained_metric(results):
    return next((r.get('ratchet') for r in reversed(results) if r.get('decision') in ('keep', 'discard', 'calibrate', 'confirm') and r.get('metric_type') == 'judged'), None)


def since_resolution(engagement):
    resolutions = records(engagement / 'resolutions.jsonl')
    last = resolutions[-1] if resolutions else {}
    results = records(engagement / 'results.jsonl')[last.get('results_lines', 0):]
    failures = {role: records(engagement / 'captures' / f'{role}-failures.jsonl')[last.get('failures', {}).get(role, 0):] for role in ('incumbent', 'candidate')}
    return results, failures


def iteration_counters(results):
    sequence = [r for r in results if r.get('decision') in ('keep', 'discard', 'skip')
                and not str(r.get('reason', '')).startswith('withdrawn:')]
    used = len({r.get('iteration') for r in sequence})
    streak = 0
    for record in reversed(sequence):
        if record['decision'] == 'keep': break
        streak += 1
    return used, streak


def validate(path, host):
    errors, warnings = [], []
    try:
        sections, metric, direction, p = methodology(path)
        if host != 't3': errors.append('host must be t3')
        if metric != 'judged' or 9 not in sections or p is None: errors.append('judged methodology and protocol required')
        if direction != 'higher': errors.append('direction must be higher')
        if p is not None:
            judges, categories = p['judges'], p['categories']
            roles = [j['role'] for j in judges]
            if not 1 <= len(judges) <= 4 or len(set(roles)) != len(roles): errors.append('invalid judges')
            if not 3 <= len(categories) <= 7: errors.append('invalid categories')
            if not 0.25 <= p['margin_floor'] <= 5: errors.append('invalid margin')
            mode, target = p['relative_to'], p['target']
            if mode not in ('absolute', 'references') or not (0 if mode == 'absolute' else -10) < target <= 10: errors.append('invalid target')
            if mode == 'references' and not p['references']: errors.append('references required')
            if mode == 'absolute' and not p['references']: warnings.append('No references to detect drift')
            for ref in p['references']: (path.parent / ref).read_text(encoding='utf-8')
            if p['max_batch'] < 1 or p['budget_calls'] < 2 * len(judges) or p['iterations'] < 1 or p['futility'] < 1: errors.append('invalid budget or limits')
    except (ValueError, TypeError, KeyError, OSError) as e:
        errors.append(str(e) or 'invalid protocol')
    return {'ok': not errors, **({'errors': errors} if errors else {'warnings': warnings})}


def open_eval(a, eng, path, p, sections, trial, results):
    panel = load_panel(Path(a.panel), p)
    cost = len(panel) * (1 if a.purpose == 'measure' else 2)
    if sum(e['requests'] for e in evals(eng)) + cost > p['budget_calls']: raise ValueError('budget exceeded')
    cfp = capture_fingerprint(p, path.parent)
    allcaps = list((eng / 'captures').glob(f'*-{cfp[:12]}-*'))
    fallback = trial['base_tree'] if trial else (allcaps[-1].name.split('-')[0] if allcaps else '')
    tree = incumbent_tree(eng, fallback, results)
    inc = captures(eng, tree, cfp)
    if a.purpose != 'measure' and (trial or len(inc) < 2): raise ValueError('two incumbent captures required, without trial')
    if a.purpose == 'measure':
        if not trial or not trial.get('commit') or not inc: raise ValueError('committed trial and captures required')
        candidate_tree = git(trial['worktree'], 'rev-parse', trial['commit'] + '^{tree}')
        candidate = captures(eng, candidate_tree, cfp)
        if not candidate: raise ValueError('candidate capture required')
    else: candidate_tree, candidate = None, []
    fingerprint = protocol_fingerprint(p, path.parent, eng, sections)
    cal, stale = active_calibration(eng, panel, fingerprint)
    if a.purpose != 'calibrate' and (not cal or stale): raise ValueError('calibration missing or stale')
    manifest = read_json(eng / 'references/manifest.json')
    if manifest is None: manifest = reference_manifest(p, path.parent)
    reftexts = {e['path']: ((eng / 'references' / e['path']) if (eng / 'references/manifest.json').exists() else (path.parent / e['path'])).read_text(encoding='utf-8') for e in manifest}
    def capture_text(cap):
        m = read_json(cap / 'manifest.json')
        return '\n\n'.join((cap / entry['path']).read_text(encoding='utf-8') for entry in m['files'])
    texts = ({'incumbent': capture_text(inc[0]), 'candidate': capture_text(candidate[0])} if candidate else
             {'capture-1': capture_text(inc[0]), 'capture-2': capture_text(inc[1])})
    texts.update({'ref:' + k: v for k, v in reftexts.items()})
    ids = [int(x.name[1:]) for x in (eng / 'evals').glob('e[0-9]*') if x.name[1:].isdigit()]
    eid = f'e{max(ids, default=0)+1:04d}'
    dest = eng / 'evals' / eid
    meta = dict(id=eid, purpose=a.purpose, iteration=trial['iteration'] if trial else max([r.get('iteration', 0) for r in results], default=0), incumbent_tree=tree, candidate_tree=candidate_tree, captures=[str(x) for x in (inc[:1] + candidate[:1] if candidate else inc[:2])], panel=panel, fingerprint=fingerprint, requests=cost, calibration=cal.get('eval') if cal else None)
    if not (eng / 'references/manifest.json').exists():
        for entry in manifest:
            destref = eng / 'references' / entry['path']; destref.parent.mkdir(parents=True, exist_ok=True)
            destref.write_text(reftexts[entry['path']], encoding='utf-8')
        write_json(eng / 'references/manifest.json', manifest)
    write_json(dest / 'eval.json', meta)
    requests = []
    import random
    rng = random.Random(a.seed)
    for role in panel:
        for k in range(1, (2 if candidate else 3)):
            pair = list(texts)[:2]
            if rng.randrange(2): pair.reverse()
            mapping = dict(zip(('A', 'B'), pair))
            mapping.update({f'Ref-{i}': 'ref:' + name for i, name in enumerate(reftexts, 1)})
            d = dest / f'{role}-{k}'; write_json(d / 'mapping.json', mapping)
            request = 'Judge only the text given. Do not read files or run commands. Return JSON with items, score and critique for each category. Scores must be 0 to 10.\n\n'
            request += '\n'.join(f'{c}: {rubric}' for c, rubric in p['categories'].items()) + '\n\n'
            cell = {'score': 0, 'critique': '<one sentence>'}
            shape = {'items': {label: dict.fromkeys(p['categories'], cell) for label in mapping}}
            request += 'Each score is a JSON number from 0 to 10, not a string. '
            request += 'Reply with only this JSON, filled in:\n' + json.dumps(shape, indent=1) + '\n\n'
            request += '\n\n'.join(f'## {label}\n{texts[meaning]}' for label, meaning in mapping.items())
            (d / 'request.md').write_text(request, encoding='utf-8')
            requests.append(dict(role=role, k=k, dir=str(d), request_md=str(d / 'request.md')))
    return dict(eval=eid, requests=requests)


def score_eval(eng, dest, meta, p):
    import math
    dirs = sorted(dest.glob('*/mapping.json'))
    if any(not (d.parent / 'return.json').exists() for d in dirs): raise ValueError('missing return')
    def unique(pairs):
        result = {}
        for k, v in pairs:
            if k in result: raise ValueError('duplicate key')
            result[k] = v
        return result
    try:
        for entry in read_json(eng / 'references/manifest.json', []):
            if digest((eng / 'references' / entry['path']).read_bytes()) != entry['sha256']: raise ValueError('reference hash mismatch')
        raw, critiques = {}, []
        for mp in dirs:
            role, k = mp.parent.name.rsplit('-', 1); mapping = read_json(mp)
            if read_json(mp.parent / 'invocation.json') != meta['panel'][role]: raise ValueError('invocation mismatch')
            data = json.loads((mp.parent / 'return.json').read_text(), object_pairs_hook=unique)
            items = data['items']
            if set(items) != set(mapping): raise ValueError('invalid labels')
            values = {}
            for label, meaning in mapping.items():
                if set(items[label]) != set(p['categories']): raise ValueError('invalid categories')
                values[meaning] = {}
                for cat, cell in items[label].items():
                    score = cell['score']
                    if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 10 or not isinstance(cell['critique'], str): raise ValueError('invalid score or critique')
                    values[meaning][cat] = score
                    critiques.append(dict(item=meaning.removeprefix('ref:'), role=role, category=cat, critique=cell['critique']))
            raw[(role, int(k))] = values
        refs = [x for x in next(iter(raw.values())) if x.startswith('ref:')]
        roles = list(meta['panel']); cats = list(p['categories'])
        baseline = {r: {ref: {c: sum(raw[(r,k)][ref][c] for k in (1,2)) / 2 for c in cats} for ref in refs} for r in roles} if meta['purpose'] != 'measure' else None
        cal = read_json(eng / 'evals' / (meta.get('calibration') or '') / 'result.json', {})
        drift = meta['purpose'] != 'calibrate' and max((
            abs(vals[ref][c] - cal['reference_baseline'][r][ref][c]) > 2 * cal['margin']
            for (r, k), vals in raw.items() for ref in refs for c in cats), default=False)
        def value(vals, item, cat):
            return vals[item][cat] - (max(vals[ref][cat] for ref in refs) if p['relative_to'] == 'references' else 0)
        if drift: result = dict(status='invalid', reason='reference drift', drift=True, margin=cal['margin'])
        elif meta['purpose'] == 'measure':
            cells = {r: {c: {item: value(raw[(r,1)], item, c) for item in ('incumbent','candidate')} for c in cats} for r in roles}
            mi = min(cells[r][c]['incumbent'] for r in roles for c in cats); mc = min(cells[r][c]['candidate'] for r in roles for c in cats); margin = cal['margin']
            keep = mc - mi > margin and all(cells[r][c]['candidate'] - cells[r][c]['incumbent'] >= -margin for r in roles for c in cats)
            result = dict(status='keep' if keep else 'discard', reason='paired comparison', metric_candidate=mc, metric_incumbent=mi, margin=margin, drift=False, cells=cells, references={r: {ref: raw[(r,1)][ref] for ref in refs} for r in roles})
        else:
            cells = {}; noise = 0
            for r in roles:
                cells[r] = {}
                for c in cats:
                    v = {(i,k): value(raw[(r,k)], 'capture-' + str(i), c) for i in (1,2) for k in (1,2)}
                    cells[r][c] = sum(v.values()) / 4
                    noise = max(noise, *(abs(v[(1,k)]-v[(2,k)]) for k in (1,2)), *(abs(v[(i,1)]-v[(i,2)]) for i in (1,2)))
            result = dict(status='valid', reason='', metric=min(cells[r][c] for r in roles for c in cats), margin=max(p['margin_floor'], noise), noise=noise, reference_baseline=baseline, cells=cells, panel=meta['panel'])
        write_json(dest / 'critiques.json', critiques)
    except (ValueError, KeyError, TypeError, OSError) as e:
        result = dict(status='invalid', reason=str(e) or 'invalid return')
    return write_json(dest / 'result.json', result)


def head_state(work, trial):
    head = git(work, 'rev-parse', 'HEAD')
    if trial['commit'] is None: return 'base' if head == trial['base'] else None
    if head == trial['commit']: return 'commit'
    if git(work, 'rev-list', '--parents', '-n', '1', 'HEAD').split()[1:] == [trial['commit']] and git(work, 'rev-parse', 'HEAD^{tree}') == trial['base_tree']:
        return 'reverted'
    return None


def diagnostics(eng, all_evals, results, resolutions, tree):
    out, done = [], {r['eval'] for r in results if r.get('eval') and r.get('decision') != 'skip'}
    def add(eid, items, kind):
        for c in read_json(eng / 'evals' / eid / 'critiques.json', []):
            if c['item'] in items: out.append(dict(eval=eid, kind=kind, text=f"{c['category']}: {c['critique']}"))
    for ev in reversed(all_evals):
        items = ({'incumbent', 'capture-1', 'capture-2'} if ev['incumbent_tree'] == tree else
                 {'candidate'} if ev.get('candidate_tree') == tree else set())
        if ev['id'] in done and items:
            add(ev['id'], items, 'incumbent')
            if out: break
    tried = [r['eval'] for r in results if r.get('decision') == 'discard' and r.get('eval')]
    if tried: add(tried[-1], {'candidate'}, 'tried')
    out += [dict(eval=r.get('last_eval'), kind='review', text=r['note']) for r in resolutions
            if r.get('decision') == 'reject' and r.get('tree') == tree]
    return out


def next_action(a, eng, path):
    sections, _, _, p = methodology(path)
    base = path.parent
    work = Path(a.worktree).resolve()
    panel = load_panel(Path(a.panel), p)
    results, resolutions, all_evals = records(eng / 'results.jsonl'), records(eng / 'resolutions.jsonl'), evals(eng)
    try:
        trial = read_json(eng / 'trial.json')
        if trial is not None and not (isinstance(trial, dict) and {'iteration', 'worktree', 'branch', 'base', 'base_tree', 'commit'} <= trial.keys()):
            raise ValueError('trial.json is not a trial record')
    except ValueError:
        return dict(action='pause', gate='G1', reason='trial.json malformed')
    trial = pending_trial(eng, results) if trial else None
    dirty = bool(git(work, 'status', '--porcelain', '--untracked-files=all'))
    current = git(work, 'rev-parse', 'HEAD^{tree}')
    inc_tree = incumbent_tree(eng, current, results)
    state = None
    if trial:
        try: branch = git(work, 'symbolic-ref', '--short', 'HEAD')
        except subprocess.CalledProcessError: branch = None
        state = head_state(work, trial)
        if str(work) != trial['worktree'] or branch != trial['branch'] or dirty or state is None:
            return dict(action='pause', gate='G2', reason='worktree, branch, cleanliness or HEAD does not match the trial')
    elif dirty or current != inc_tree:
        return dict(action='pause', gate='G3', reason='worktree is dirty or not the incumbent tree')

    fingerprint = protocol_fingerprint(p, base, eng, sections)
    cfp = capture_fingerprint(p, base)
    cal, stale = active_calibration(eng, panel, fingerprint)
    retained = retained_metric(results)
    maxit = max([r.get('iteration', 0) for r in results], default=0)
    since, failures = since_resolution(eng)
    spent = sum(e['requests'] for e in all_evals)
    finalized = {r['eval'] for r in results if r.get('eval')}

    def open_or_stop(purpose):
        if spent + len(panel) * (1 if purpose == 'measure' else 2) > p['budget_calls']: return dict(action='stop', reason='budget')
        return dict(action='open', purpose=purpose)

    def measure_eval(iteration):
        return next((e['id'] for e in reversed(all_evals) if e['purpose'] == 'measure' and e['iteration'] == iteration), None)

    def log(decision, ev=None, iteration=maxit, change=None, reason=None, after=None, ratchet=None, **extras):
        extras = {k: v for k, v in dict(metric_type='judged', eval=ev, **extras).items() if v is not None or k == 'metric_type'}
        argv = [str(eng / 'results.jsonl'), iteration, change, 'skip' if decision == 'skip' else 'pass', retained, after, ratchet, decision, reason]
        args = [json.dumps(x) if x is None or isinstance(x, (int, float)) else str(x) for x in argv] + [json.dumps(extras)]
        return dict(action='log', decision=decision, **({'eval': ev} if ev else {}), args=args)

    def trial_change(iteration):
        return trial['change'] if trial and trial['iteration'] == iteration else 'Measurement'

    if all_evals:
        ev = all_evals[-1]
        eid, dest = ev['id'], eng / 'evals' / ev['id']
        result = read_json(dest / 'result.json')
        if result is None:
            return dict(action='abandon' if any(not (d.parent / 'return.json').exists() for d in dest.glob('*/mapping.json')) else 'score', eval=eid)
        status, measure, done = result['status'], ev['purpose'] == 'measure', eid in finalized
        if not done and status in ('valid', 'keep', 'discard') and (ev['panel'] != panel or ev['fingerprint'] != fingerprint or (measure and stale)):
            return dict(action='invalidate', eval=eid, reason='stale')
        if not done and status == 'invalid':
            change = trial_change(ev['iteration']) if measure else 'Calibration' if ev['purpose'] == 'calibrate' else 'Confirmation'
            return log('invalid', eid, ev['iteration'] if measure else maxit, change, result['reason'], ratchet=retained, drift=result.get('drift'))
        if not done and not measure:
            checks = read_json(dest / 'checks.json')
            if not checks or checks['tree'] != ev['incumbent_tree'] or checks['fingerprint'] != fingerprint:
                return dict(action='run_checks', eval=eid, target='incumbent', tree=ev['incumbent_tree'])
            if not checks['passed']:
                return log('invalid', eid, maxit, 'Calibration' if ev['purpose'] == 'calibrate' else 'Confirmation', 'checks failed', ratchet=retained)
            name = ev['purpose']
            return log(name, eid, maxit, 'Calibration' if name == 'calibrate' else 'Confirmation',
                       'calibrated' if name == 'calibrate' else 'confirmed', ratchet=result['metric'], tree=ev['incumbent_tree'], cells=result['cells'])
        if not done and measure and status in ('keep', 'discard'):
            failed = False
            if status == 'keep':
                checks = read_json(dest / 'checks.json')
                if not checks or checks['tree'] != ev['candidate_tree'] or checks['fingerprint'] != fingerprint:
                    return dict(action='run_checks', eval=eid, target='candidate', tree=ev['candidate_tree'])
                if checks['passed']:
                    return log('keep', eid, ev['iteration'], trial_change(ev['iteration']), result['reason'], result['metric_candidate'], result['metric_candidate'],
                               tree=ev['candidate_tree'], drift=result.get('drift'), cells=result['cells'], references=result['references'])
                failed = True
            if not trial: return dict(action='pause', rule=7, reason='measured evaluation without a pending trial')
            if state == 'commit': return dict(action='discard_trial', worktree=trial['worktree'], branch=trial['branch'], base=trial['base'], trial=trial['commit'])
            return log('discard', eid, ev['iteration'], trial['change'], 'checks failed' if failed else result['reason'], result['metric_candidate'], result['metric_incumbent'],
                       drift=result.get('drift'), cells=result['cells'], references=result['references'])

    if trial and trial['commit'] and stale:
        if state == 'commit': return dict(action='discard_trial', worktree=trial['worktree'], branch=trial['branch'], base=trial['base'], trial=trial['commit'])
        by_chris = any(r.get('decision') == 'withdraw' and r.get('trial_iteration') == trial['iteration'] for r in resolutions)
        return log('skip', measure_eval(trial['iteration']), trial['iteration'], trial['change'], 'withdrawn: ' + ('by Chris' if by_chris else 'calibration changed'), ratchet=retained)
    if any(r.get('decision') == 'invalid' and r.get('reason') != 'stale' for r in since):
        return dict(action='pause', rule=9, reason='an invalid evaluation since the last resolution')
    if trial and trial['commit']:
        if failures['candidate']: return dict(action='pause', rule=10, reason='candidate capture failed since the last resolution')
        tree = git(trial['worktree'], 'rev-parse', trial['commit'] + '^{tree}')
        return open_or_stop('measure') if captures(eng, tree, cfp) else dict(action='capture', role='candidate')
    if trial:
        if any(r.get('decision') == 'withdraw' and r.get('trial_iteration') == trial['iteration'] for r in resolutions):
            return log('skip', measure_eval(trial['iteration']), trial['iteration'], trial['change'], 'withdrawn: by Chris', ratchet=retained)
        return dict(action='pause', rule=11, reason='trial has no commit')
    if failures['incumbent']: return dict(action='pause', rule=12, reason='incumbent capture failed since the last resolution')
    if len(captures(eng, inc_tree, cfp)) < 2: return dict(action='capture', role='incumbent')
    if not cal or stale: return open_or_stop('calibrate')
    if retained is not None and retained >= p['target'] and not any(r.get('decision') == 'reject' and r.get('tree') == inc_tree for r in resolutions):
        index = max(i for i, r in enumerate(results) if r.get('decision') == 'calibrate')
        confirms = [r for r in results[index + 1:] if r.get('decision') == 'confirm' and r.get('tree') == inc_tree]
        if not confirms: return open_or_stop('confirm')
        if confirms[-1]['ratchet'] >= p['target']: return dict(action='stop', reason='target')
    used, streak = iteration_counters(results)
    if used >= p['iterations']: return dict(action='stop', reason='iterations')
    if streak >= p['futility']: return dict(action='stop', reason='futility')
    previous = read_json(eng / 'trial.json', {})
    iteration = 1 + max([previous.get('iteration', 0)] + [r.get('iteration', 0) for r in results if r.get('decision') in ('keep', 'discard', 'skip')])
    return dict(action='propose', iteration=iteration, diagnostics=diagnostics(eng, all_evals, results, resolutions, inc_tree))


def run(a):
    eng, path = Path(a.engagement).resolve(), Path(a.protocol).resolve()
    if a.command == 'validate': return validate(path, a.host)
    if a.command == 'next': return next_action(a, eng, path)
    results = records(eng / 'results.jsonl')
    trial = pending_trial(eng, results)
    if a.command in ('open', 'score', 'abandon', 'invalidate', 'checks'):
        sections, _, _, p = methodology(path)
        if a.command == 'open': return open_eval(a, eng, path, p, sections, trial, results)
        if not re.fullmatch(r'e[0-9]+', a.eval): raise ValueError('invalid eval')
        dest = eng / 'evals' / a.eval
        meta = read_json(dest / 'eval.json')
        if not meta or any(r.get('eval') == a.eval for r in results): raise ValueError('missing or finalized eval')
        result = read_json(dest / 'result.json')
        if a.command == 'abandon':
            invalid = dict(status='invalid', reason='abandoned')
            if result and result != invalid: raise ValueError('already scored')
            if result: return result
            return write_json(dest / 'result.json', invalid)
        if a.command == 'invalidate':
            if not result or result.get('status') == 'invalid':
                raise ValueError('not scored or already invalid')
            os.replace(dest / 'result.json', dest / 'result.scored.json')
            return write_json(dest / 'result.json', dict(status='invalid', reason=a.reason))
        if a.command == 'checks':
            if not result or result.get('status') not in ('valid', 'keep'): raise ValueError('not eligible for checks')
            check = dict(tree=git(a.worktree, 'rev-parse', 'HEAD^{tree}'), fingerprint=protocol_fingerprint(p, path.parent, eng, sections), passed=a.passed, details=a.details)
            return write_json(dest / 'checks.json', check)
        if result: raise ValueError('already scored')
        return score_eval(eng, dest, meta, p)
    if a.command == 'resolve':
        if a.decision == 'withdraw' and not trial: raise ValueError('no pending trial')
        ids = sorted(p.name for p in (eng / 'evals').glob('e[0-9]*') if p.is_dir())
        record = dict(decision=a.decision, note=a.note, results_lines=len(results), failures={role: len(records(eng / 'captures' / f'{role}-failures.jsonl')) for role in ('incumbent', 'candidate')}, last_eval=ids[-1] if ids else None)
        if a.decision in ('continue', 'reject'):
            if not a.worktree: raise ValueError('worktree required')
            record['tree'] = git(a.worktree, 'rev-parse', 'HEAD^{tree}')
            if a.decision == 'continue': record['adopted'] = trial is None
        if a.decision == 'withdraw': record['trial_iteration'] = trial['iteration']
        append(eng / 'resolutions.jsonl', record)
        return record
    work = Path(a.worktree).resolve()
    head, tree = git(work, 'rev-parse', 'HEAD'), git(work, 'rev-parse', 'HEAD^{tree}')
    if a.command == 'trial':
        branch = git(work, 'symbolic-ref', '--short', 'HEAD')
        if git(work, 'status', '--porcelain', '--untracked-files=all'): raise ValueError('dirty worktree')
        if a.operation == 'begin':
            if trial or tree != incumbent_tree(eng, tree, results) or not a.change: raise ValueError('cannot begin trial')
            previous = read_json(eng / 'trial.json', {})
            iteration = 1 + max([previous.get('iteration', 0)] + [r.get('iteration', 0) for r in results if r.get('decision') in ('keep', 'discard', 'skip')])
            trial = dict(iteration=iteration, worktree=str(work), branch=branch, base=head, base_tree=tree, commit=None, change=a.change)
        else:
            if not trial or trial.get('commit') or trial['worktree'] != str(work) or trial['branch'] != branch or head == trial['base'] or git(work, 'rev-list', '--parents', '-n', '1', 'HEAD').split()[1:] != [trial['base']]: raise ValueError('invalid trial commit')
            trial['commit'] = head
        return write_json(eng / 'trial.json', trial)
    if a.role == 'incumbent' and trial and trial.get('commit'): raise ValueError('committed trial pending')
    if a.role == 'candidate' and (not trial or not trial.get('commit') or trial['commit'] != head): raise ValueError('candidate requires trial commit')
    _, _, _, p = methodology(path)
    cfp = capture_fingerprint(p, path.parent)
    with tempfile.TemporaryDirectory(prefix='judged-capture-') as tmp:
        out = Path(tmp) / 'output'
        out.mkdir()
        try:
            result = subprocess.run(command_parts(p['artifact_command'], path.parent) + [str(work), str(out)], capture_output=True)
            if result.returncode: raise ValueError('capture command failed')
            manifest = read_json(out / 'manifest.json')
            if not isinstance(manifest, dict) or manifest['tree'] != tree or not isinstance(manifest['files'], list): raise ValueError('invalid manifest')
            for entry in manifest['files']:
                target = (out / entry['path']).resolve()
                if not target.is_relative_to(out.resolve()): raise ValueError('invalid capture path')
                data = target.read_bytes(); data.decode('utf-8')
                if digest(data) != entry['sha256']: raise ValueError('capture hash mismatch')
            existing = captures(eng, tree, cfp)
            number = max([int(x.name.rsplit('-', 1)[1]) for x in existing], default=0) + 1
            dest = eng / 'captures' / f'{tree}-{cfp[:12]}-{number}'
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(out), str(dest))
            return dict(status='ok', dir=str(dest))
        except (OSError, ValueError, KeyError, TypeError) as e:
            reason = str(e) or 'invalid capture'
            append(eng / 'captures' / f'{a.role}-failures.jsonl', dict(tree=tree, cfp=cfp, reason=reason))
            return dict(status='invalid', reason=reason)


if __name__ == '__main__':
    args = parser.parse_args()
    try:
        response = run(args)
        code = 1 if response.get('ok') is False else 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        response, code = {'error': str(exc) or 'refused'}, 1
    print(json.dumps(response, ensure_ascii=False))
    sys.exit(code)
