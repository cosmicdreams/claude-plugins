"""Explore orchestration over compare's variants and scripted/council rounds."""
import random
import re
from pathlib import Path

from experiment_loop import ending, git, ownership, require, save, shell


def round_cost(s, c, first=False):
    n = s['compare']['count'] + (first and s['compare']['include_incumbent'])
    return n * (n - 1) * s['explore']['judges'] if s['scorer'] == 'council' else n * int(c['Runs'])


def configuration(text, c):
    from experiment import field
    require(field(text, 'Question'), 'Question is required')
    values = {}
    for name, default, maximum in [('Count', '4', 6), ('Rounds', '2', 3)]:
        raw = field(text, name) or default
        minimum = 2 if name == 'Count' else 1
        require(raw.isdecimal() and minimum <= int(raw) <= maximum,
                f'{name} must be {minimum}–{maximum}')
        values[name.lower()] = int(raw)
    require(c['Budget'] is not None, 'Budget is required')
    incumbent = field(text, 'Include incumbent')
    require(incumbent in (None, 'yes', 'no'), 'Include incumbent must be yes or no')
    judges = 0
    if c.get('scorer') == 'council':
        from experiment_council import protocol
        judges = len(protocol(text)['judges'])
    else:
        require(field(text, 'Direction') and re.search(r'\b(higher|lower)\b', field(text, 'Direction'), re.I),
                'Direction must be higher or lower')
    cfg = dict(mode='generated', count=values['count'], declared={}, grid={}, apply=None,
               include_incumbent=incumbent == 'yes')
    exp = dict(rounds=values['rounds'], judges=judges, question=field(text, 'Question'))
    provisional = dict(compare=cfg, explore=exp, scorer=c.get('scorer'))
    cost = round_cost(provisional, c, first=True) + (exp['rounds'] - 1) * round_cost(provisional, c)
    require(cost <= c['Budget'], 'Budget must cover all planned rounds (including incumbent)')
    return cfg, exp


def initialize(s, c, text):
    cfg, exp = configuration(text, c)
    s.update(compare=cfg, explore=exp, round=1, round_results={}, announcements=[],
             base=s['incumbent'], variants={}, seed=random.SystemRandom().randrange(2**32),
             order=[], measurements_used=0, building=None, confirmation=None, group=None)
    if cfg['include_incumbent']:
        s['variants']['incumbent'] = dict(commit=s['base'], branch=s['branch'],
            description='Unchanged base', tradeoff='Existing implementation', status='pending',
            runs=[], round=1, parent=None)


def announcements(s):
    return [a for a in s['announcements'] if a['round'] == s['round']]


def can_continue(s, c):
    return s['round'] < s['explore']['rounds'] and c['Budget'] - s['measurements_used'] >= round_cost(s, c)


def next_action(s, c):
    from experiment_compare import active_variants
    if s['status'] != 'running':
        return dict(action='stop', ending=s['ending'])
    ranked = s['round_results'].get(str(s['round']))
    if ranked is not None:
        if not announcements(s):
            return dict(action='announce', round=s['round'], ranking=ranked['ranking'])
        if not can_continue(s, c):
            return dict(action='stop', ending=s['ending'])
        return dict(action='add-variants', round=s['round'] + 1, building=s['building'],
                    remaining_count=s['compare']['count'], points_of_interest=announcements(s))
    variants = active_variants(s)
    remaining = s['compare']['count'] - len(set(variants) - {'incumbent'})
    if remaining:
        return dict(action='add-variants', round=s['round'], building=s['building'],
                    remaining_count=remaining, points_of_interest=[a for a in s['announcements']
                                                                  if a['round'] == s['round'] - 1])
    if s['scorer'] == 'council' and s.get('council_round') and not s.get('council_result'):
        return dict(action='score', eval=s['council_round'])
    return dict(action='measure')


def finish_round(s, c):
    from experiment_compare import active_variants
    variants = active_variants(s)
    names = [n for n, v in variants.items() if v['status'] == 'measured']
    if s['scorer'] == 'council':
        pairs = s['council_result']['pairwise']
        for n in names:
            involved = [p for p in pairs if n in p['pair']]
            variants[n]['wins'] = sum(p['winner'] == n for p in involved)
            variants[n]['ties'] = sum(p['winner'] is None for p in involved)
        names.sort(key=lambda n: (-variants[n]['wins'], -variants[n]['ties']))
    else:
        names.sort(key=lambda n: -c['sign'] * variants[n]['median'])
    for rank, n in enumerate(names, 1):
        variants[n]['rank'] = rank
    s['round_results'][str(s['round'])] = dict(ranking=names, seed=s['seed'], order=s['order'],
                                              council_result=s.get('council_result'))


def conclude(s):
    count = len(set(s['variants']) - {'incumbent'})
    ending(s, 'explored', f"{len(s['round_results'])} rounds completed; {count} candidates built; "
                         f"{s['measurements_used']} budget used")
    s['ending'].update(rounds_completed=len(s['round_results']), candidates_built=count,
                       budget_used=s['measurements_used'])


def prepare_variant(a, s, c):
    from experiment_compare import active_variants
    completed = str(s['round']) in s['round_results']
    if a.variant_command == 'begin':
        require(next_action(s, c)['action'] == 'add-variants', 'announce before opening another round')
        parents = announcements(s) if completed else [x for x in s['announcements'] if x['round'] == s['round'] - 1]
        require((s['round'] == 1 and not completed and a.parent is None) or
                a.parent in {x['name'] for x in parents}, 'parent must be an announced candidate from the previous round')
        if completed:
            s['round'] += 1
            s.update(seed=random.SystemRandom().randrange(2**32), order=[], council_round=None, council_result=None)
    require(str(s['round']) not in s['round_results'] and not s.get('council_round') and
            not s['order'], 'variants cannot change after measuring this round')
    if a.variant_command == 'discard':
        require(a.name in active_variants(s), 'only current-round variants can be discarded')


def dispatch_command(a, e, s, c):
    if a.command == 'report':
        return report(e, s, c)
    if a.command == 'announce':
        require(str(s['round']) in s['round_results'], 'announce only after a round is ranked')
        ownership(s, s['base'])
        current = announcements(s)
        require(len(current) < 2, 'at most two announcements per round')
        require(a.name in s['variants'] and s['variants'][a.name]['round'] == s['round'],
                'announce a candidate from this round')
        require(a.name not in {x['name'] for x in current}, 'candidate already announced')
        require(a.note.strip(), 'announcement note required')
        s['announcements'].append(dict(round=s['round'], name=a.name, note=a.note))
        if not can_continue(s, c):
            conclude(s)
        save(e, s)
        return next_action(s, c)
    require(a.command not in ('confirm', 'decide', 'grid'), 'explore has no confirmation, decision or grid')
    return None


def report(e, s, c):
    from experiment_compare import restore, validity
    from experiment_report import cell
    available = Path(s['worktree']).is_dir()
    if available or s['status'] == 'running':
        ownership(s, s['base'])
    require(not s['building'], 'finish open variant before reporting')
    end = s['ending'] or dict(kind='running', detail='')
    lines = ['## Ending', '', f"Ending: {end['kind']}; {end['detail']}",
             'No improvement is claimed.', f"Budget used: {s['measurements_used']}", '', '## Gallery', '']
    for r in range(1, s['round'] + 1):
        lines += [f'### Round {r}', '',
                  "| Candidate | Rank | Metric (median; MAD or wins; ties) | Trade-off | Parent | Branch | Status | worth pursuing? (agent's view) |",
                  '| --- | --- | --- | --- | --- | --- | --- | --- |']
        for n, v in s['variants'].items():
            if v['round'] != r:
                continue
            metric = (f"{v['wins']} wins; {v['ties']} ties" if 'wins' in v else
                      f"{v['median']:g}; MAD {v['mad']:g}" if v.get('median') is not None else '—')
            lines.append('| ' + ' | '.join(cell(str(x)) for x in
                [n, v.get('rank', '—'), metric, v['tradeoff'], v['parent'] or '—',
                 v['branch'], v.get('reason', v['status']), '_']) + ' |')
        result = s['round_results'].get(str(r), {}).get('council_result')
        if not result and r == s['round']:
            result = s.get('council_result')
        if result:
            lines += ['', '| Pair | Judge | Order | Preference | Critique |', '| --- | --- | --- | --- | --- |']
            for pair in result['pairwise']:
                for order in pair['orders']:
                    lines.append('| ' + ' | '.join(cell(str(x)) for x in
                        [' / '.join(pair['pair']), order['role'], order['order'], order['preferred'], order['critique']]) + ' |')
    lines += ['', '## Points of interest', '']
    lines += [f"- Round {a['round']}, {a['name']}: {cell(a['note'])}" for a in s['announcements']] or ['None.']
    lines += ['', '## Next experiments', '']
    lines += [f"- Round {a['round']}, {a['name']}: climb (reachable number) or compare (choice): _" for a in s['announcements']]
    strategy = e / 'strategy.md'
    lines += ['', '## Router notes', '', strategy.read_text().strip() if strategy.exists() else 'Absent.', '', '## Validity', '']
    if not available:
        lines += ['VALIDITY NOT RE-VERIFIED: worktree unavailable.']
    for r in range(1, s['round'] + 1):
        round_state = dict(s, variants={n: v for n, v in s['variants'].items() if v['round'] == r})
        result = s['round_results'].get(str(r), {})
        round_state.update(seed=result.get('seed', s['seed']), order=result.get('order', s['order']))
        lines += [f'Round {r}:']
        validity(lines, round_state, c, available)
        if s['scorer'] == 'council':
            lines[-1] = '- Scripted interleaving: n/a (position-swapped pairwise council)'
    lines += ['', '## Worth keeping', '']
    names = s['round_results'].get(str(s['round']), {}).get('ranking', [])
    result = 'n/a (no ranked candidate)'
    try:
        if names:
            v = s['variants'][names[0]]
            lines.append(f"Top candidate: {names[0]}; commit `{v['commit']}`; branch `{v['branch']}`.")
            result = 'n/a (worktree unavailable)'
            if available:
                git(s['worktree'], 'switch', '--detach', v['commit'])
                try:
                    from experiment_loop import require_clean
                    result = 'PASS' if shell(s['worktree'], c['Checks']).returncode == 0 else 'FAIL'
                    require_clean(s['worktree'], measurement=True)
                except (ValueError, OSError):
                    result = 'FAIL'
        lines.append('- Checks: ' + result)
    finally:
        if available:
            restore(s)
    path = e / 'report.md'
    path.write_text('\n'.join(lines) + '\n')
    return dict(path=str(path))
