"""Persistent scripted experiment loop. No external Python dependencies."""
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import statistics
import subprocess
import sys
import tempfile

SCRIPTS = Path(__file__).resolve().parent
REGISTRY = 'research-lab-engagements'
NUMBER = r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?'
LEVELS = ['small changes', 'larger structural changes',
          'fresh hypotheses from another model family given the full log',
          'restart from a different design']


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def config(text, strategy):
    from experiment import field
    c = {k: field(text, k) for k in ('Measure', 'Checks', 'Tiebreak', 'Readability',
                                    'Held-out', 'Score', 'Metric name')}
    for name, default in [('Target', 0), ('Budget', None), ('Runs', 3),
                          ('Margin', None), ('Futility', 5), ('Bound', None),
                          ('Score target', None)]:
        raw = field(text, name)
        if raw is None:
            c[name] = default
        else:
            match = re.search(NUMBER, raw)
            require(match is not None, name + ' must be numeric')
            c[name] = float(match.group())
            require(math.isfinite(c[name]), name + ' must be finite')
    direction = (field(text, 'Direction') or 'lower').lower()
    c['sign'] = 1 if re.search(r'\bhigher\b', direction) else -1
    if strategy == 'remediate':
        require(re.search(r'\blower\b', direction) and c['sign'] == -1, 'remediate direction must be lower')
    return c


def validate(c):
    for name in ('Budget', 'Runs', 'Futility'):
        n = c[name]
        if n is not None:
            require(n >= 1 and n == int(n), name + ' must be a positive integer')
    require(c['Margin'] is None or c['Margin'] >= 0, 'Margin must be nonnegative')
    require(not c['Tiebreak'] or c['Readability'], 'Tiebreak requires Readability')
    require(c['Bound'] is None or (c['Target'] - c['Bound']) * c['sign'] <= 0,
            'target beyond measured bound')


def git(w, *args):
    r = subprocess.run(['git', '-C', str(w), *args], capture_output=True, text=True)
    require(r.returncode == 0, r.stderr.strip() or 'git command failed')
    return r.stdout.strip()


def clean(w):
    return not git(w, 'status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none')


def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def save(e, s):
    e.mkdir(parents=True, exist_ok=True)
    fd, path = tempfile.mkstemp(dir=e, prefix='.state-')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(s, f, indent=2, allow_nan=False)
            f.write('\n')
        os.replace(path, e / 'state.json')
    finally:
        if os.path.exists(path):
            os.unlink(path)


def shell(w, command):
    try:
        return subprocess.run(['bash', '-c', command], cwd=w, capture_output=True,
                              text=True, timeout=1800)
    except subprocess.TimeoutExpired:
        raise ValueError('command timed out: ' + command) from None


def number(w, command, metric=None):
    r = shell(w, command)
    require(r.returncode == 0, 'measurement command failed: ' + command)
    lines = [x.strip() for x in r.stdout.splitlines() if x.strip()]
    metrics = [x for x in lines if x.startswith('METRIC ')]
    if metrics:
        parsed = [re.fullmatch(r'METRIC\s+([^=\s]+)=(' + NUMBER + ')', x) for x in metrics]
        require(all(parsed), 'invalid METRIC line')
        selected = [m.group(2) for m in parsed if metric is None or m.group(1) == metric]
        require(len(selected) == 1, 'ambiguous or missing primary METRIC')
        value = selected[0]
    else:
        require(lines and re.fullmatch(NUMBER, lines[-1]), 'invalid measurement: expected one number')
        value = lines[-1]
    n = float(value)
    require(math.isfinite(n), 'invalid measurement: nonfinite number')
    return n


def measure(s, c, score=False):
    command = c['Score'] if score else c['Measure']
    runs = [number(s['worktree'], command, None if score else c['Metric name'])
            for _ in range(int(c['Runs']))]
    if s['strategy'] == 'remediate' and not score:
        require(all(x >= 0 and x == int(x) for x in runs), 'findings count must be a nonnegative integer')
    median = statistics.median(runs)
    return dict(median=median, runs=runs,
                mad=statistics.median(abs(x - median) for x in runs))


def goal(s, c, value=None):
    """Shared goal seam for the driver and future reporting."""
    value = s['ratchet'] if value is None else value
    target = c['Target'] + (len(s['exceptions']) if s['strategy'] == 'remediate' else 0)
    return value is not None and (value - target) * c['sign'] >= 0


def ending(s, kind, detail):
    s.update(status='paused' if kind == 'paused' else 'stopped',
             ending={'kind': kind, 'detail': detail})


def gap(s, c):
    target = c['Target'] + (len(s['exceptions']) if s['strategy'] == 'remediate' else 0)
    return None if s['ratchet'] is None else max(0, (target - s['ratchet']) * c['sign'])


def records(e):
    path = e / 'results.jsonl'
    return [json.loads(x) for x in path.read_text().splitlines()] if path.exists() else []


def next_action(e, s, c):
    if s['status'] != 'running':
        return dict(action='pause' if s.get('unresolved') else 'stop', ending=s['ending'],
                    **({'reason': s['ending']['detail']} if s.get('unresolved') else {}))
    if s['baseline'] is None:
        return dict(action='baseline')
    if s['trial']:
        return dict(action='resolve' if s['trial']['commit'] and not s['trial'].get('rework') else 'edit')
    if goal(s, c):
        return dict(action='confirm')
    tried = [r['change'] for r in records(e) if r['decision'] == 'discard'
             and r.get('incumbent') == s['incumbent']]
    return dict(action='propose', escalation=s['escalation'], level_name=LEVELS[s['escalation']],
                tried=tried, trials_left=int(c['Budget']) - s['trials_used'], gap=gap(s, c))


def log(e, s, c, m, decision, reason, before=None, change=None, extras=None, gate='pass'):
    t = s['trial']
    extra = dict(strategy=s['strategy'], runs=m['runs'], mad=m['mad'])
    if t:
        extra.update(trial=t['id'], tradeoff=t['tradeoff'], escalation=s['escalation'],
                     base=t['base'], commit=t['commit'], incumbent=s['incumbent'])
    extra.update(extras or {})
    args = [str(e / 'results.jsonl'), str(t['id'] if t else s['trials_used']),
            change or (t['change'] if t else 'Confirmation'),
            'fail' if decision == 'retry' else gate,
            json.dumps(before), str(m['median']), str(s['ratchet']), decision, reason, json.dumps(extra)]
    r = subprocess.run(['bash', str(SCRIPTS.parents[2] / 'scripts/log-iteration.sh'), *args],
                       capture_output=True, text=True)
    require(r.returncode == 0, 'logging failed: ' + r.stderr)
    line = (f"[trial {t['id'] if t else s['trials_used']}/{int(c['Budget'])}] {s['strategy']} · {m['median']:g} "
            f"(best {s['ratchet']:g}) target {c['Target']:g} gap {gap(s, c):g} · "
            f"{decision}: {reason} · noise ±{m['mad']:g} · escalation {s['escalation']}")
    with (e / 'progress.log').open('a') as f:
        f.write(line + '\n')
    print(line, file=sys.stderr)
    s['stop_blocks'] = 0


def ownership(s, expected, dirty=False):
    w = s['worktree']
    require(git(w, 'symbolic-ref', '--short', 'HEAD') == s['branch'], 'recorded branch changed')
    require(git(w, 'rev-parse', 'HEAD') == expected, 'HEAD differs from recorded commit')
    require(dirty or clean(w), 'worktree is dirty')


def init(a, e, check):
    require(not (e / 'state.json').exists(), 'state.json already exists')
    out = check(a.strategy, a.scorer, a.methodology)
    require(out['status'] == 'ready', out['reason'])
    w = Path(a.worktree).resolve()
    require(Path(git(w, 'rev-parse', '--show-toplevel')).resolve() == w, 'worktree must be root')
    gd = git(w, 'rev-parse', '--absolute-git-dir')
    common = git(w, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    require(Path(gd).resolve() != Path(common).resolve(), 'linked worktree required')
    branch = git(w, 'symbolic-ref', '--short', 'HEAD')
    require(branch not in ('main', 'master'), 'protected branch')
    if e.is_relative_to(w):
        require(e != w, 'engagement cannot be the worktree root')
        rel = e.relative_to(w).as_posix()
        # Escape gitignore metacharacters and anchor to this worktree root.
        pattern = '/' + re.sub(r'([\\*?\[\] !#])', r'\\\1', rel) + '/'
        exclude = Path(git(w, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'))
        exclude.parent.mkdir(parents=True, exist_ok=True)
        with exclude.open('a') as f:
            f.write('\n' + pattern + '\n')
    require(clean(w), 'worktree is dirty')
    method = Path(a.methodology).resolve()
    c = config(method.read_text(), a.strategy)
    hashes = {}
    for name in ('Measure', 'Checks'):
        tokens = shlex.split(c[name])
        if tokens:
            p = (w / tokens[0]).resolve()
            if p.is_relative_to(w) and p.is_file():
                hashes[str(p)] = digest(p)
    s = dict(version=1, strategy=a.strategy, scorer='scripted', status='running', ending=None,
             worktree=str(w), branch=branch, methodology=str(method), methodology_sha256=digest(method),
             scorer_sha256=hashes, baseline=None, margin=None, score_baseline=None, score_margin=None,
             ratchet=None, incumbent=git(w, 'rev-parse', 'HEAD'), trials_used=0,
             consecutive_discards=0, escalation=0, trial=None, exceptions=[], stop_blocks=0)
    save(e, s)
    # Registry in this worktree's git dir: hooks and status read it instead of walking the tree.
    registry = Path(git(w, 'rev-parse', '--path-format=absolute', '--git-path', REGISTRY))
    with registry.open('a') as f:
        f.write(str(e) + '\n')
    return dict(action='baseline')


def evaluate(e, s, c, command):
    """Measurements and resolution; failures preserve the pending trial and ratchet."""
    t, w = s['trial'], s['worktree']
    if command == 'baseline':
        require(s['baseline'] is None and t is None, 'baseline already exists or trial open')
        ownership(s, s['incumbent'])
        require(shell(w, c['Checks']).returncode == 0, 'baseline checks failed')
    elif command == 'score':
        require(t and t['commit'] and not t.get('rework'), 'commit the trial before scoring')
        ownership(s, t['commit'])
        require(git(w, 'rev-list', '--parents', '-n', '1', t['commit']).split() ==
                [t['commit'], t['base']], 'trial must have exactly the recorded base as parent')
    else:
        require(s['baseline'] is not None and t is None, 'confirmation requires baseline and no trial')
        ownership(s, git(w, 'rev-parse', 'HEAD'))
        require(git(w, 'rev-parse', 'HEAD^{tree}') == git(w, 'rev-parse', s['incumbent'] + '^{tree}'),
                'incumbent tree changed')
    m = measure(s, c)
    score = measure(s, c, True) if s['strategy'] == 'remediate' and c['Score'] else None
    before = s['ratchet']
    if command == 'baseline':
        tie = number(w, c['Tiebreak']) if c['Tiebreak'] else None
        s.update(baseline=m, margin=c['Margin'] if c['Margin'] is not None else 2 * m['mad'],
                 ratchet=m['median'], tiebreak=tie, score_baseline=score,
                 score_margin=2 * score['mad'] if score else None)
        log(e, s, c, m, 'keep', 'baseline established', change='Baseline survey',
            extras={'margin': s['margin'], 'score': score})
    elif command == 'confirm':
        s['ratchet'] = m['median']
        if goal(s, c):
            ending(s, 'exceptions' if s['exceptions'] else 'met', 'confirmed target')
        log(e, s, c, m, 'confirm', 'confirmed target' if goal(s, c) else 'confirmation missed target', before)
        s['confirmation'] = dict(incumbent=s['incumbent'], **m)
        if not goal(s, c) and s['trials_used'] >= c['Budget']:
            ending(s, 'paused', 'budget spent')
    else:
        checks = shell(w, c['Checks']).returncode == 0
        guard = score is None or score['median'] >= s['score_baseline']['median'] - s['score_margin']
        delta = (m['median'] - before) * c['sign']
        metric_better = delta > (0 if s['strategy'] == 'remediate' else s['margin'])
        better = metric_better
        tie = None
        tie_before = s.get('tiebreak')
        readable = False
        reason = 'gain beyond margin' if better else f"no gain beyond margin {s['margin']:g}"
        if s['strategy'] == 'climb' and abs(delta) <= s['margin'] and c['Tiebreak']:
            tie = number(w, c['Tiebreak'])
            readable = tie < s['tiebreak'] and shell(w, c['Readability']).returncode == 0
            if tie < s['tiebreak'] and readable:
                better, reason = True, 'simplicity tie-break'
        if not checks or not guard:
            reason = 'checks failed' if not checks else 'Score guardrail regression'
        if metric_better and (not checks or not guard) and not t['retried']:
            t.update(retried=True, rework=True)
            log(e, s, c, m, 'retry', reason, before, extras={'score': score})
            save(e, s)
            return dict(action='rework', decision='retry', reason=reason)
        decision = 'keep' if better and checks and guard else 'discard'
        if decision == 'discard':
            r = subprocess.run([sys.executable, str(SCRIPTS / 'discard-trial.py'),
                                '--worktree', w, '--branch', s['branch'], '--base', t['base'],
                                '--trial', t['commit']], capture_output=True, text=True)
            require(r.returncode == 0, 'discard refused: ' + r.stderr.strip())
            s['consecutive_discards'] += 1
            if s['consecutive_discards'] >= c['Futility']:
                s['escalation'] += 1
                s['consecutive_discards'] = 0
                if s['escalation'] > 3:
                    ending(s, 'paused', 'escalation ladder exhausted without a bound or scope block')
        else:
            if c['Tiebreak']:
                tie = number(w, c['Tiebreak']) if tie is None else tie
            s.update(incumbent=t['commit'], ratchet=m['median'], consecutive_discards=0, tiebreak=tie)
            if score:
                s['score_baseline'] = score
        s['trials_used'] += 1
        if s['trials_used'] >= c['Budget'] and not goal(s, c) and s['status'] == 'running':
            ending(s, 'paused', 'budget spent')
        log(e, s, c, m, decision, reason, before, extras={'score': score, 'tiebreak_before': tie_before,
                                   'tiebreak_after': tie, 'readable': readable},
            gate='pass' if checks and guard else 'fail')
        s['trial'] = None
        save(e, s)
        return dict(decision=decision, reason=reason, **next_action(e, s, c))
    save(e, s)
    return next_action(e, s, c)


def dispatch(a, check):
    if a.command == 'status':
        from experiment_report import status
        return status(a.repo)
    e = Path(a.engagement).resolve()
    if a.command == 'init':
        return init(a, e, check)
    s = json.loads((e / 'state.json').read_text())
    require(s['version'] == 1, 'unsupported state version')
    c = config(Path(s['methodology']).read_text(), s['strategy'])
    c['Budget'] = s.get('budget_override', c['Budget'])
    if a.command == 'report':
        from experiment_report import report
        return report(e, s, c)
    if a.command == 'resume':
        require(s['status'] == 'paused', 'only paused engagements can resume')
        require(a.note.strip(), 'resolution note required')
        previous = s['ending']
        require(not previous or previous['detail'] != 'budget spent' or a.budget is not None,
                'budget spent: resume requires --budget')
        if a.budget is not None:
            require(a.budget > s['trials_used'], 'new budget must exceed trials_used')
            s['budget_override'] = c['Budget'] = a.budget
        require(s['trials_used'] < c['Budget'], 'resume requires --budget greater than trials_used')
        if previous and 'escalation ladder exhausted' in previous['detail']:
            s['escalation'] = 0
        s.pop('unresolved', None)
        s.update(status='running', ending=None, stop_blocks=0)
        with (e / 'resolutions.jsonl').open('a') as f:
            f.write(json.dumps(dict(timestamp=datetime.now(timezone.utc).isoformat(),
                                    note=a.note, previous_ending=previous)) + '\n')
        save(e, s)
        return next_action(e, s, c)
    if a.command == 'next':
        return next_action(e, s, c)
    require(s['status'] == 'running', 'engagement is not running')
    require(digest(s['methodology']) == s['methodology_sha256'], 'methodology changed since init')
    cmd = a.command
    if cmd in ('baseline', 'confirm') or (cmd == 'trial' and a.trial_command == 'score'):
        try:
            return evaluate(e, s, c, a.trial_command if cmd == 'trial' else cmd)
        except (ValueError, OSError) as error:
            # No trial decision/log is written on invalid measurement or refused discard.
            ending(s, 'paused', str(error))
            s['unresolved'] = True
            save(e, s)
            raise
    if cmd == 'trial':
        if a.trial_command == 'begin':
            require(s['baseline'] is not None, 'baseline required')
            require(s['trial'] is None, 'trial already open')
            require(not goal(s, c), 'confirm the target before another trial')
            require(s['trials_used'] < c['Budget'], 'budget spent')
            require(a.change.strip() and a.tradeoff.strip(), 'change and tradeoff required')
            require(clean(s['worktree']), 'worktree is dirty')
            require(git(s['worktree'], 'symbolic-ref', '--short', 'HEAD') == s['branch'], 'branch changed')
            require(git(s['worktree'], 'rev-parse', 'HEAD^{tree}') ==
                    git(s['worktree'], 'rev-parse', s['incumbent'] + '^{tree}'), 'incumbent tree changed')
            s['trial'] = dict(id=s['trials_used'] + 1, base=git(s['worktree'], 'rev-parse', 'HEAD'),
                              commit=None, change=a.change, tradeoff=a.tradeoff, retried=False)
        else:
            t = s['trial']
            require(t is not None, 'no trial open')
            require(t['commit'] is None or t.get('rework'), 'trial already committed')
            ownership(s, t['commit'] or t['base'], dirty=True)
            require(not clean(s['worktree']), 'empty change')
            git(s['worktree'], 'add', '--all')
            require(git(s['worktree'], 'diff', '--cached', '--stat'), 'empty change')
            args = ['commit', '-m', f"perf({e.name}): {t['change']}"]
            if t['commit']:
                args.append('--amend')
            git(s['worktree'], *args)
            t.update(commit=git(s['worktree'], 'rev-parse', 'HEAD'), rework=False)
    elif cmd == 'conclude':
        require(s['strategy'] == 'climb', 'conclude is climb only')
        require(s['trial'] is None, 'resolve the open trial first')
        require(a.evidence.strip(), 'evidence required')
        ending(s, 'unreachable', a.kind + ': ' + a.evidence)
    elif cmd == 'exception':
        require(s['strategy'] == 'remediate', 'exceptions are remediate only')
        require(a.finding.strip() and a.evidence.strip(), 'finding and evidence required')
        require(not any(x['finding'] == a.finding for x in s['exceptions']), 'finding already excepted')
        s['exceptions'].append(dict(finding=a.finding, kind=a.kind, evidence=a.evidence))
    save(e, s)
    return next_action(e, s, c)


def add_commands(sub):
    for name in ('init', 'next', 'baseline', 'trial', 'confirm', 'conclude', 'exception', 'report', 'resume'):
        p = sub.add_parser(name)
        if name in ('trial', 'exception'):
            children = p.add_subparsers(dest=name + '_command', required=True)
            parsers = [children.add_parser(x) for x in
                       (('begin', 'commit', 'score') if name == 'trial' else ('add',))]
        else:
            parsers = [p]
        for child in parsers:
            child.add_argument('--engagement', required=True)
        if name == 'resume':
            p.add_argument('--note', required=True)
            p.add_argument('--budget', type=int)
        if name == 'init':
            for arg in ('worktree', 'methodology'):
                p.add_argument('--' + arg, required=True)
            p.add_argument('--strategy', choices=('climb', 'remediate'), required=True)
            p.add_argument('--scorer', choices=('scripted',), required=True)
        if name == 'trial':
            parsers[0].add_argument('--change', required=True)
            parsers[0].add_argument('--tradeoff', required=True)
        if name in ('conclude', 'exception'):
            child = parsers[0]
            child.add_argument('--kind', choices=('bound', 'scope'), required=True)
            child.add_argument('--evidence', required=True)
            if name == 'exception':
                child.add_argument('--finding', required=True)
    p = sub.add_parser('status')
    p.add_argument('--all', action='store_true', required=True)
    p.add_argument('--repo', required=True)
