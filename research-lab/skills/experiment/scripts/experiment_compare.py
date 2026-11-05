"""Compare scripted variants without advancing the experiment branch."""
import hashlib
import itertools
import random
import re
import shlex
import statistics
import subprocess
from pathlib import Path

from experiment_loop import (digest, dirty_paths, ending, git, log, measure, ownership,
                             require, require_clean, save, shell)


def configuration(text, c):
    from experiment import field
    mode = field(text, 'Variants')
    require(mode in ('given', 'generated', 'grid'), 'Variants must be given, generated or grid')
    require(field(text, 'Direction') and re.search(r'\b(higher|lower)\b', field(text, 'Direction'), re.I),
            'Direction must be higher or lower')
    require(c['Budget'] is not None, 'Budget is required')
    incumbent = field(text, 'Include incumbent')
    require(incumbent in (None, 'yes', 'no'), 'Include incumbent must be yes or no')
    def fields(prefix):
        names = re.findall(r'^\s*(?:[-*]\s+)?(?:\*\*)?' + prefix + r'\s+([^:*\n]+?)(?:\*\*)?\s*:', text, re.M | re.I)
        require(len(names) == len(set(names)), 'duplicate ' + prefix + ' name')
        return {name: field(text, re.escape(prefix + ' ' + name)) for name in names}
    declarations, grid = fields('Variant'), fields('Grid')
    if mode == 'given':
        require(declarations and all(re.fullmatch('[a-z0-9-]+', n) and d for n, d in declarations.items()),
                'given requires Variant <name>: description; names are [a-z0-9-]+')
        require('incumbent' not in declarations, 'incumbent is reserved')
        count = len(declarations)
    elif mode == 'generated':
        raw = field(text, 'Count') or ''
        require(raw.isdecimal() and 2 <= int(raw) <= 8, 'Count must be 2–8')
        require(field(text, 'Idea'), 'Idea is required')
        count = int(raw)
    else:
        require(grid and field(text, 'Apply'), 'grid requires Grid <param> and Apply')
        for name, values in grid.items():
            require(re.fullmatch('[a-zA-Z_][a-zA-Z0-9_-]*', name) and values, 'invalid Grid parameter')
            grid[name] = [v.strip() for v in values.split(',')]
            require(all(grid[name]) and len(set(grid[name])) == len(grid[name]), 'empty or duplicate Grid value')
        count = 1
        for values in grid.values():
            count *= len(values)
        require(count <= 64, 'grid exceeds 64 points')
        unknown = set(re.findall(r'\{([\w-]+)\}', field(text, 'Apply'))) - grid.keys()
        require(not unknown, 'unknown Apply parameter: ' + ', '.join(sorted(unknown)))
    total = count + (incumbent == 'yes')
    require(total * c['Runs'] + c['Runs'] <= c['Budget'], 'Budget must cover variants × Runs plus one confirmation')
    return dict(mode=mode, declared=declarations, grid=grid, count=count,
                apply=field(text, 'Apply'), include_incumbent=incumbent == 'yes')


def initialize(s, c, text):
    s.update(compare=configuration(text, c), base=s['incumbent'], variants={},
             seed=random.SystemRandom().randrange(2**32), order=[], measurements_used=0,
             building=None, confirmation=None, group=None)
    if s['compare']['include_incumbent']:
        s['variants']['incumbent'] = dict(commit=s['base'], branch=s['branch'],
            description='Unchanged base', tradeoff='Existing implementation', status='pending', runs=[])


def viable(s):
    return [n for n, v in s['variants'].items() if v['status'] == 'measured']


def ranked(s, c):
    return sorted(viable(s), key=lambda n: -c['sign'] * s['variants'][n]['median'])


def next_action(s, c):
    if s['status'] != 'running':
        return dict(action='stop', ending=s['ending'])
    cfg = s['compare']
    if len(s['variants']) < cfg['count'] + cfg['include_incumbent']:
        return dict(action='build-grid' if cfg['mode'] == 'grid' else 'add-variants',
                    building=s['building'])
    if any(v['status'] == 'pending' for v in s['variants'].values()):
        return dict(action='measure')
    if s['group'] is not None:
        return dict(action='decide', group=s['group'])
    return dict(action='confirm', variant=ranked(s, c)[0])


def finish(s, c):
    names = ranked(s, c)
    if not names:
        ending(s, 'no-path', 'no variant is viable')
        s['ending']['reasons'] = {n: v.get('reason', v['status']) for n, v in s['variants'].items()}
        return
    deviations = [abs(x - s['variants'][n]['median']) for n in names for x in s['variants'][n]['runs']]
    s['margin'] = c['Margin'] if c['Margin'] is not None else 2 * statistics.median(deviations)
    best = s['variants'][names[0]]['median']
    inc = s['variants'].get('incumbent')
    if inc and inc['status'] == 'measured' and not any(
            n != 'incumbent' and (inc['median'] - s['variants'][n]['median']) * -c['sign'] > s['margin']
            for n in names):
        ending(s, 'no-path', 'no variant beats the incumbent')
    elif len(names) > 1 and abs(best - s['variants'][names[1]]['median']) <= s['margin']:
        s['group'] = [n for n in names if abs(best - s['variants'][n]['median']) <= s['margin']]


def choose(s, name, basis, reason):
    ending(s, 'decision', reason)
    s['ending'].update(winner=name, basis=basis, branch=s['variants'][name]['branch'])


def restore(s):
    """Remove only command-created changes; commands start from a clean tree."""
    w = s['worktree']
    paths = dirty_paths(w)
    git(w, 'reset', '--hard', 'HEAD')
    if paths:
        git(w, 'clean', '-fd', '--', *paths)
    git(w, 'switch', s['branch'])


def commit_variant(e, s, v, name):
    w = s['worktree']
    if e.is_relative_to(Path(w)):
        git(w, 'reset', s['base'], '--', e.relative_to(w).as_posix())
    paths = dirty_paths(w)
    # E is ignored by init; explicitly exclude it even if an Apply force-staged it.
    paths = [p for p in paths if not (Path(w) / p).resolve().is_relative_to(e)]
    require(paths, 'empty change')
    git(w, 'switch', '-c', v['branch'])
    try:
        git(w, 'add', '--all', '--', *paths)
        require(git(w, 'diff', '--cached', '--stat'), 'empty change')
        git(w, 'commit', '-m', f"perf({e.name}): {v['description']}")
        v.update(commit=git(w, 'rev-parse', 'HEAD'), status='pending', runs=[])
        s['variants'][name] = v
    finally:
        git(w, 'switch', s['branch'])


def sample(s, c, v):
    require(s['measurements_used'] < c['Budget'], 'measurement budget spent')
    s['measurements_used'] += 1
    s['trials_used'] = s['measurements_used']
    return measure(s, dict(c, Runs=1))['median']


def summarize(v):
    v['median'] = statistics.median(v['runs']) if v['runs'] else None
    v['mad'] = statistics.median(abs(x - v['median']) for x in v['runs']) if v['runs'] else None


def measure_variants(e, s, c):
    require(next_action(s, c)['action'] == 'measure', 'variants must be built before measuring')
    ownership(s, s['base'])
    rng = random.Random(s['seed'])
    pending = [n for n, v in s['variants'].items() if v['status'] == 'pending']
    try:
        for i in range(int(c['Runs'])):
            order = pending[:]
            rng.shuffle(order)
            if len(order) > 1 and s['order'] and order == s['order'][-1]:
                order = order[1:] + order[:1]
            s['order'].append(order)
            for name in order:
                v = s['variants'][name]
                if v['status'] != 'pending' or len(v['runs']) > i:
                    continue
                try:
                    git(s['worktree'], 'switch', '--detach', v['commit'])
                    v['runs'].append(sample(s, c, v))
                    require_clean(s['worktree'], measurement=True)
                    if i == 0:
                        v['checks'] = shell(s['worktree'], c['Checks']).returncode == 0
                        require_clean(s['worktree'], measurement=True)
                        if not v['checks']:
                            v.update(status='fails checks', reason='Checks failed')
                except (ValueError, OSError) as error:
                    v.update(status='invalid', reason=str(error))
                    restore(s)
                save(e, s)
        for name in pending:
            v = s['variants'][name]
            if v['status'] == 'pending':
                v['status'] = 'measured'
            summarize(v)
            log(e, s, c, v, 'measured', v.get('reason', 'variant measured'), change=name,
                extras=dict(variant=name, commit=v['commit'], checks=v.get('checks', False), tradeoff=v['tradeoff']),
                gate='pass' if v['status'] == 'measured' else 'fail')
        finish(s, c)
    finally:
        restore(s)
        save(e, s)


def confirm(e, s, c):
    require(next_action(s, c)['action'] == 'confirm', 'confirmation is not pending')
    ownership(s, s['base'])
    names = ranked(s, c)
    name = names[0]
    v = s['variants'][name]
    result = dict(variant=name, commit=v['commit'], runs=[])
    try:
        git(s['worktree'], 'switch', '--detach', v['commit'])
        for _ in range(int(c['Runs'])):
            result['runs'].append(sample(s, c, v))
        require_clean(s['worktree'], measurement=True)
        summarize(result)
        s['confirmation'] = result
        if len(names) == 1 or (result['median'] - s['variants'][names[1]]['median']) * c['sign'] > s['margin']:
            choose(s, name, 'margin', 'confirmed gain beyond margin')
        else:
            values = {n: result['median'] if n == name else s['variants'][n]['median'] for n in names}
            best = max(values.values(), key=lambda x: x * c['sign'])
            s['group'] = [n for n in names if abs(values[n] - best) <= s['margin']]
    except (ValueError, OSError) as error:
        v.update(status='invalid', reason='confirmation failed: ' + str(error))
        s['confirmation'] = dict(result, reason=str(error))
        remaining = ranked(s, c)
        if remaining:
            s['group'] = remaining
        else:
            finish(s, c)
    finally:
        restore(s)
        save(e, s)


def dispatch(a, e, s, c):
    cmd = a.command
    if cmd == 'next':
        return next_action(s, c)
    require(digest(s['methodology']) == s['methodology_sha256'], 'methodology changed since init')
    if cmd == 'report':
        return report(e, s, c)
    require(s['status'] == 'running', 'engagement is not running')
    if cmd == 'variant':
        require(s['compare']['mode'] != 'grid' or a.variant_command == 'discard', 'use grid build')
        require(s['measurements_used'] == 0, 'variants cannot change after measuring')
        if a.variant_command == 'begin':
            ownership(s, s['base'])
            require(not s['building'], 'variant already open')
            require(re.fullmatch('[a-z0-9-]+', a.name) and a.name != 'incumbent', 'invalid or reserved variant name')
            require(a.name not in s['variants'], 'variant already exists')
            require(next_action(s, c)['action'] == 'add-variants', 'all variants already exist')
            require(a.tradeoff.strip(), 'tradeoff required')
            cfg = s['compare']
            require(cfg['mode'] != 'given' or a.name in cfg['declared'], 'undeclared variant')
            description = cfg['declared'].get(a.name) if cfg['mode'] == 'given' else a.description
            require(description and description.strip(), 'generated variant requires description')
            branch = s['branch'] + '--' + a.name
            require(not git(s['worktree'], 'branch', '--list', branch), 'variant branch already exists')
            s['building'] = dict(name=a.name, tradeoff=a.tradeoff, description=description, branch=branch)
        elif a.variant_command == 'commit':
            require(s['building'], 'no variant open')
            ownership(s, s['base'], dirty=True)
            v = s['building'].copy()
            name = v.pop('name')
            commit_variant(e, s, v, name)
            s['building'] = None
        else:
            ownership(s, s['base'])
            require(not s['building'], 'finish open variant first')
            require(a.name in s['variants'] and a.name != 'incumbent', 'unknown or reserved variant')
            branch = s['variants'][a.name]['branch']
            if git(s['worktree'], 'branch', '--list', branch):
                git(s['worktree'], 'branch', '-D', branch)
            del s['variants'][a.name]
    elif cmd == 'grid':
        require(s['compare']['mode'] == 'grid' and next_action(s, c)['action'] == 'build-grid', 'grid already built or not grid mode')
        ownership(s, s['base'])
        cfg = s['compare']
        points = list(itertools.product(*cfg['grid'].values()))
        for k, values in enumerate(points, 1):
            name = f'p{k}'
            if name in s['variants']:
                continue
            params = dict(zip(cfg['grid'], values))
            v = dict(params=params, tradeoff=', '.join(f'{p}={x}' for p, x in params.items()),
                     description=', '.join(f'{p}={x}' for p, x in params.items()), branch=s['branch'] + '--' + name,
                     commit=None, runs=[])
            require(not git(s['worktree'], 'branch', '--list', v['branch']), 'variant branch already exists')
            command = re.sub(r'\{([\w-]+)\}', lambda m: shlex.quote(params[m[1]]), cfg['apply'])
            try:
                require(shell(s['worktree'], command).returncode == 0, 'Apply failed')
                ownership(s, s['base'], dirty=True)
                commit_variant(e, s, v, name)
            except (ValueError, OSError) as error:
                v.update(status='invalid', reason=str(error))
                s['variants'][name] = v
            finally:
                restore(s)
                save(e, s)
    elif cmd == 'measure':
        require(not s['building'], 'finish open variant first')
        measure_variants(e, s, c)
    elif cmd == 'confirm':
        confirm(e, s, c)
    elif cmd == 'decide':
        require(next_action(s, c)['action'] == 'decide' and a.choose in s['group'], 'choose a variant in the within-noise group')
        require(a.reason.strip(), 'decision reason required')
        choose(s, a.choose, 'trade-offs', a.reason)
    else:
        raise ValueError('command is not available for compare')
    if cmd == 'grid' and not any(v['status'] == 'pending' for v in s['variants'].values()):
        finish(s, c)
    s['stop_blocks'] = 0
    save(e, s)
    return next_action(s, c)


def add_commands(sub):
    for command, actions in [('variant', ('begin', 'commit', 'discard')), ('grid', ('build',))]:
        p = sub.add_parser(command)
        children = p.add_subparsers(dest=command + '_command', required=True)
        for action in actions:
            child = children.add_parser(action)
            child.add_argument('--engagement', required=True)
            if command == 'variant' and action in ('begin', 'discard'):
                child.add_argument('--name', required=True)
            if command == 'variant' and action == 'begin':
                child.add_argument('--tradeoff', required=True)
                child.add_argument('--description')
    for command in ('measure', 'decide'):
        p = sub.add_parser(command)
        p.add_argument('--engagement', required=True)
        if command == 'decide':
            p.add_argument('--choose', required=True)
            p.add_argument('--reason', required=True)


def report(e, s, c):
    from experiment_report import cell
    ownership(s, s['base'])
    require(not s['building'], 'finish open variant before reporting')
    end = s['ending']
    names = ranked(s, c)
    winner = end.get('winner') if end else None
    lines = ['## Ending and goal', '', 'Ending: ' + (end['kind'] + ': ' + end['detail'] if end else 'running')]
    if winner:
        lines += [f"Winner: {winner}; basis: {end['basis']}; adopt branch `{end['branch']}` (never merged)."]
    lines += ['', '## Decisions to review', '',
              "| Variant | Median | MAD | Δ vs best | Checks | Tradeoff | worth adopting? (agent's view) |",
              '| --- | --- | --- | --- | --- | --- | --- |']
    for n in names:
        v = s['variants'][n]
        delta = abs(v['median'] - s['variants'][names[0]]['median'])
        lines.append(f"| {n + (' (chosen)' if n == winner else '')} | {v['median']:g} | {v['mad']:g} | {delta:g} | PASS | {cell(v['tradeoff'])} | _ |")
    lines += ['', '## Rejected directions', '']
    lines += [f"- {n}: {cell(v.get('reason', v['status']))}" for n, v in s['variants'].items()
              if v['status'] in ('invalid', 'fails checks')] or ['None.']
    if s['compare']['mode'] == 'grid':
        params = list(s['compare']['grid'])
        lines += ['', '## Response surface', '', '| Point | ' + ' | '.join(params) + ' | Median |',
                  '| --- | ' + ' | '.join('---' for _ in params) + ' | --- |']
        for n, v in s['variants'].items():
            if 'params' in v:
                lines.append('| ' + n + ' | ' + ' | '.join(cell(v['params'][p]) for p in params) + ' | ' +
                             (f"{v['median']:g}" if v.get('median') is not None else 'invalid') + ' |')
        lines += ['', '### Parameter sensitivity', '']
        for p in params:
            means = []
            for value in s['compare']['grid'][p]:
                values = [s['variants'][n]['median'] for n in names if s['variants'][n].get('params', {}).get(p) == value]
                if values:
                    means.append(statistics.mean(values))
            lines.append(f"- {p}: {max(means) - min(means):g}" if means else f'- {p}: absent')
    strategy = e / 'strategy.md'
    lines += ['', '## Router notes', '', strategy.read_text().strip() if strategy.exists() else 'Absent.', '', '## Validity', '']
    unchanged = all(Path(p).is_file() and digest(p) == sha for p, sha in s['scorer_sha256'].items())
    for v in s['variants'].values():
        if not v['commit']:
            continue
        for p, sha in s['scorer_sha256'].items():
            rel = Path(p).relative_to(s['worktree']).as_posix()
            # Hash raw blobs; text decoding would alter non-text scorers.
            blob = subprocess.run(['git', '-C', s['worktree'], 'show', v['commit'] + ':' + rel], capture_output=True)
            unchanged &= blob.returncode == 0 and hashlib.sha256(blob.stdout).hexdigest() == sha
    one_commit = all(n == 'incumbent' or not v['commit'] or
                     git(s['worktree'], 'rev-list', '--parents', '-n', '1', v['commit']).split() == [v['commit'], s['base']]
                     for n, v in s['variants'].items())
    expected = set(s['variants']) - {n for n, v in s['variants'].items() if not v['commit']}
    rng = random.Random(s['seed'])
    replay = []
    for _ in range(int(c['Runs'])):
        row = [n for n in s['variants'] if n in expected]
        rng.shuffle(row)
        if len(row) > 1 and replay and row == replay[-1]:
            row = row[1:] + row[:1]
        replay.append(row)
    interleaved = s['order'] == replay
    confirmed = bool(s['confirmation'] and winner == s['confirmation']['variant'] and
                     len(s['confirmation']['runs']) == int(c['Runs']) and not s['confirmation'].get('reason'))
    for label, ok in [('Scorer files unchanged', unchanged), ('Each variant is one commit on base', one_commit),
                      ('Experiment branch never moved', git(s['worktree'], 'rev-parse', s['branch']) == s['base']),
                      (f"Measurement order interleaved (seed {s['seed']})", interleaved)]:
        lines.append(f"- {label}: {'PASS' if ok else 'FAIL'}")
    lines.append('- Confirmation present: ' + ('PASS' if confirmed else 'FAIL') if end and end.get('basis') == 'margin'
                 else '- Confirmation present: n/a (basis is not margin)')
    lines += ['', '## Worth keeping', '']
    try:
        if winner:
            git(s['worktree'], 'switch', '--detach', s['variants'][winner]['commit'])
        for label in ('Held-out', 'Checks'):
            result = 'ABSENT' if not c[label] else 'n/a (no winner)'
            if winner and c[label]:
                try:
                    result = 'PASS' if shell(s['worktree'], c[label]).returncode == 0 else 'FAIL'
                except ValueError:
                    result = 'FAIL'
            lines.append(f'- {label}: {result}')
    finally:
        restore(s)
    path = e / 'report.md'
    path.write_text('\n'.join(lines) + '\n')
    return dict(path=str(path))
