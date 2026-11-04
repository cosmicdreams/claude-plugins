"""File-derived reporting and bounded engagement discovery. Stdlib only."""
import json
import subprocess
from pathlib import Path

from experiment_loop import digest, git, goal, measure, ownership, records, require, shell


def engagements(root):
    """Version-one states registered by `init` in this worktree's git directory."""
    from experiment_loop import REGISTRY
    r = subprocess.run(['git', '-C', str(root), 'rev-parse', '--path-format=absolute',
                        '--git-path', REGISTRY], capture_output=True, text=True, timeout=2)
    registry = Path(r.stdout.strip()) if r.returncode == 0 else None
    if registry is None or not registry.is_file():
        return
    for line in dict.fromkeys(registry.read_text().splitlines()):
        e = Path(line)
        try:
            s = json.loads((e / 'state.json').read_text())
        except (OSError, ValueError):
            continue
        if isinstance(s, dict) and s.get('version') == 1:
            yield e, s


def status(repo):
    from experiment_loop import config
    rows = []
    for line in git(repo, 'worktree', 'list', '--porcelain').splitlines():
        if not line.startswith('worktree '):
            continue
        w = line[len('worktree '):]
        for e, s in engagements(w):
            c = config(Path(s['methodology']).read_text(), s['strategy'])
            rows.append(dict(worktree=w, engagement=str(e), strategy=s['strategy'],
                             status=s['status'], trials_used=s['trials_used'],
                             budget=s.get('budget_override', c['Budget']),
                             ratchet=s['ratchet'], ending=s['ending']))
    return rows


def cell(value):
    return str(value).replace('|', '\\|').replace('\n', ' ')


def report(e, s, c):
    w = s['worktree']
    require(s['trial'] is None, 'resolve the open trial before reporting')
    ownership(s, git(w, 'rev-parse', 'HEAD'))
    incumbent_tree = (git(w, 'rev-parse', 'HEAD^{tree}') ==
                      git(w, 'rev-parse', s['incumbent'] + '^{tree}'))
    require(incumbent_tree, 'incumbent tree changed')
    log = records(e)
    keeps = [r for r in log if r['decision'] == 'keep' and r.get('trial')]
    discards = [r for r in log if r['decision'] == 'discard']
    # Only reachable history counts: amended retry commits are intentionally absent.
    history = {}
    for entry in git(w, 'log', '--format=%H%x1f%P%x1f%B%x1e').split('\x1e'):
        if entry.strip():
            sha, parents, message = entry.strip().split('\x1f', 2)
            history[sha] = (parents.split(), message)
    unchanged = all(Path(p).is_file() and digest(p) == sha
                    for p, sha in s['scorer_sha256'].items())
    gains = all((r['metric_after'] - r['metric_before']) * c['sign'] >
                (0 if s['strategy'] == 'remediate' else s['margin'])
                or (s['strategy'] == 'climb' and r['reason'] == 'simplicity tie-break'
                    and abs(r['metric_after'] - r['metric_before']) <= s['margin']
                    and c['Tiebreak'] and c['Readability']
                    and r.get('readable') and r.get('tiebreak_after') is not None
                    and r.get('tiebreak_before') is not None
                    and r['tiebreak_after'] < r['tiebreak_before'])
                for r in keeps)
    reverted = all(any(parents == [r['commit']] and
                       ('This reverts commit ' + r['commit']) in message
                       for parents, message in history.values()) for r in discards)
    trials = {}
    for r in log:
        if r.get('trial'):
            trials.setdefault(r['trial'], []).append(r)
    one_commit = len(trials) == s['trials_used'] and all(
        len([r for r in rs if r['decision'] in ('keep', 'discard')]) == 1 and
        history.get(rs[-1]['commit'], ([], ''))[0] == [rs[-1]['base']]
        for rs in trials.values())
    confirmation = s.get('confirmation')
    confirmed = bool(confirmation and confirmation['incumbent'] == s['incumbent']
                     and log and log[-1]['decision'] == 'confirm'
                     and log[-1]['metric_after'] == confirmation['median'])
    end = s['ending']
    allowed = bool(end and (
        (s['status'] == 'paused' and end['kind'] == 'paused') or
        (s['status'] == 'stopped' and (
            (end['kind'] == 'unreachable' and s['strategy'] == 'climb'
             and end['detail'].startswith(('bound: ', 'scope: ')) and end['detail'][7:].strip()) or
            (end['kind'] in ('met', 'exceptions') and confirmed and goal(s, c, confirmation['median'])
             and (end['kind'] == 'exceptions') == bool(s['exceptions'])
             and (end['kind'] != 'exceptions' or s['strategy'] == 'remediate'))))))
    progress = e / 'progress.log'
    progress_ok = progress.exists() and len(progress.read_text().splitlines()) == len(log)
    lines = ['## Ending and goal', '',
             f"Ending: {end['kind'] + ': ' + end['detail'] if end else 'running'}",
             '', f"Goal: {c['Target']:g}; best measured value: "
             + (f"{s['ratchet']:g}" if s['ratchet'] is not None else 'absent')
             + '; confirmed final number: '
             + (f"{confirmation['median']:g}" if confirmed else 'absent'), '',
             '## Decisions to review', '',
             "| Trial | Change | Gain | Tradeoff | worth maintaining? (agent's view) |",
             '| --- | --- | --- | --- | --- |']
    for r in keeps:
        gain = (r['metric_after'] - r['metric_before']) * c['sign']
        lines.append(f"| {r['trial']} | {cell(r['change'])} | {gain:g} | {cell(r.get('tradeoff', ''))} | _ |")
    lines += ['', '## Rejected directions', '']
    groups = {}
    for r in discards:
        groups.setdefault(r['change'].split(':', 1)[0], []).append(r)
    lines += [f"- {cell(name)}: {len(rs)} discard(s); " +
              '; '.join(cell(r['reason']) for r in rs) for name, rs in groups.items()] or ['None.']
    strategy = e / 'strategy.md'
    lines += ['', '## Router notes', '', strategy.read_text().strip() if strategy.exists() else 'Absent.',
              '', '## Validity', '']
    for label, ok in [('Scorer files unchanged', unchanged),
                      ('Every keep beat margin or tie-break', gains),
                      ('Every discard has a revert commit referencing the trial commit', reverted),
                      ('One trial commit per trial', one_commit),
                      ('Ending is allowed', allowed),
                      ('Progress line per result', progress_ok),
                      ('Incumbent tree matches worktree', incumbent_tree),
                      ('Every keep has tradeoff', all(r.get('tradeoff', '').strip() for r in keeps))]:
        lines.append(f"- {label}: {'PASS' if ok else 'FAIL'}")
    confirmation_status = ('n/a (ending ' + end['kind'] + ')'
                           if end and end['kind'] in ('unreachable', 'paused')
                           else 'PASS' if confirmed else 'FAIL')
    lines += ['', '## Worth keeping', '', '- Confirmation present: ' + confirmation_status]
    for label in ('Held-out', 'Checks'):
        result = 'ABSENT'
        if c[label]:
            try:
                result = 'PASS' if shell(w, c[label]).returncode == 0 else 'FAIL'
            except ValueError:
                result = 'FAIL'
        lines.append(f'- {label}: {result}')
    if s['strategy'] == 'remediate' and c['Score target'] is not None and c['Score']:
        score = measure(s, c, True)['median']
        lines.append(f"- Final score: {score:g}; Score target: {c['Score target']:g}")
        if score < c['Score target']:
            lines.append('- Offer a climb hand-off to pursue the unmet Score target.')
    path = e / 'report.md'
    path.write_text('\n'.join(lines) + '\n')
    return dict(path=str(path))
