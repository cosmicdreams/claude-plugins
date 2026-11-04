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
    if name == 'validate':
        p.add_argument('--host')
    if name in ('capture', 'trial', 'checks', 'resolve', 'next'):
        p.add_argument('--worktree', required=name in ('capture', 'trial', 'checks', 'next'))
    if name == 'capture':
        p.add_argument('--role', required=True, choices=('incumbent', 'candidate'))
    if name == 'trial':
        p.add_argument('--change')
    if name in ('open', 'next'):
        p.add_argument('--panel', required=True)
    if name == 'open':
        p.add_argument('--purpose', required=True, choices=('calibrate', 'confirm', 'measure'))
        p.add_argument('--seed', required=True, type=int)
    if name in ('score', 'abandon', 'invalidate', 'checks'):
        p.add_argument('--eval', required=True)
    if name == 'invalidate':
        p.add_argument('--reason', required=True)
    if name == 'checks':
        g = p.add_mutually_exclusive_group(required=True)
        g.add_argument('--passed', action='store_true')
        g.add_argument('--failed', action='store_true')
        p.add_argument('--details')
    if name == 'resolve':
        p.add_argument('--decision', required=True, choices=('withdraw', 'retry', 'continue', 'reject'))
        p.add_argument('--note', required=True)

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
    return [read_json(p) for p in sorted((engagement / 'evals').glob('e*/eval.json'))]


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


def run(a):
    eng, path = Path(a.engagement).resolve(), Path(a.protocol).resolve()
    if a.command == 'validate': return validate(path, a.host)
    if a.command in ('open', 'score', 'abandon', 'invalidate', 'checks', 'next'): raise ValueError('not implemented')
    results = records(eng / 'results.jsonl')
    trial = pending_trial(eng, results)
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
        write_json(eng / 'trial.json', trial)
        return trial
    if a.role == 'incumbent' and trial and trial.get('commit'): raise ValueError('committed trial pending')
    if a.role == 'candidate' and (not trial or not trial.get('commit') or trial['commit'] != head): raise ValueError('candidate requires trial commit')
    _, _, _, p = methodology(path)
    cfp = capture_fingerprint(p, path.parent)
    with tempfile.TemporaryDirectory(prefix='judged-capture-') as tmp:
        out = Path(tmp) / 'output'
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
