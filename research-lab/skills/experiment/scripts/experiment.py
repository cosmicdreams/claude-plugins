#!/usr/bin/env python3
"""Strategy and scorer resolution for research-lab:experiment. Stdlib only.

check: resolve strategy and scorer (argument > methodology field > router) and
validate the inputs the chosen combination needs. Prints one JSON object.
Exit 0 = ready, 2 = route (no strategy given; run the router and pause),
1 = refused (see reason and missing).
"""
import argparse
import json
import re
import sys
from pathlib import Path

STRATEGIES = ('remediate', 'climb', 'compare', 'explore')
SCORERS = ('scripted', 'council')
NOT_BUILT = {'explore': 5}
COUNCIL_STATUS = Path(__file__).resolve().parent.parent / 'references/council-status.json'


def council_transport(transport):
    status = json.loads(COUNCIL_STATUS.read_text())
    if status.get('status') != 'passed':
        raise ValueError('council scoring is blocked; see ' + status.get('record', str(COUNCIL_STATUS)))
    if transport not in status.get('transports', []):
        raise ValueError('council transport has not passed: ' + transport)


CLIMB_SECTIONS = ('Objective', 'Baseline', 'Hypotheses', 'Iteration Rules', 'Measurement Protocol',
                  'Correctness Checks', 'Scope Constraints', 'Working Directory')
NUMBER = r'[-+]?\d+(?:\.\d+)?'


def field(text, name):
    """`name: value` or `**Name:** value` on one line; first match, or None when absent or empty."""
    h = r'[ \t]*'  # never \s: an empty field must not swallow the next line
    m = re.search(rf'^{h}(?:[-*]{h})?(?:\*\*)?{name}(?:\*\*)?{h}:{h}(?:\*\*)?{h}(.*?){h}$',
                  text, re.M | re.I)
    value = m.group(1).strip().strip('`*').strip() if m else ''
    return value or None


def sections(text):
    """Heading titles, without `## n.` numbering or trailing parentheticals."""
    titles = []
    for m in re.finditer(r'^#{2,3}\s+(?:\d+\.\s*)?(.+?)\s*$', text, re.M):
        titles.append(re.sub(r'\s*\(.*\)$', '', m.group(1)).strip().lower())
    return titles


def climb_missing(text):
    missing = []
    have = sections(text)
    for name in CLIMB_SECTIONS:
        if not any(t == name.lower() or t.startswith(name.lower()) for t in have):
            missing.append(f'section: {name}')
    target = field(text, 'target')
    if not target or not re.search(NUMBER, target):
        missing.append('target: a numeric target value')
    direction = field(text, 'direction')
    if not direction or not re.search(r'\b(higher|lower)\b', direction, re.I):
        missing.append('direction: higher or lower')
    budget = field(text, 'budget')
    if not budget or not re.search(r'\d', budget):
        missing.append('budget: maximum iterations')
    return missing


def resolve(arg, method_value, legacy=None):
    """Precedence: argument > methodology field > legacy field. Returns (value, source)."""
    if arg and arg != 'auto':
        return arg, 'argument'
    if method_value and method_value != 'auto':
        return method_value, 'methodology'
    if legacy:
        return legacy, 'methodology'
    return None, None


def check(strategy_arg, scorer_arg, methodology_path, transport=None):
    out = dict(status='refused', strategy=None, scorer=None, source={}, missing=[], reason=None)
    text = ''
    if methodology_path:
        path = Path(methodology_path)
        if not path.is_file():
            out.update(missing=['methodology'], reason=f'methodology not found: {methodology_path}')
            return out
        text = path.read_text(encoding='utf-8')

    mt = (field(text, 'metric_type') or '').lower() or None
    if mt not in (None, 'scripted', 'judged'):
        out['reason'] = f'unknown metric_type: {mt}'
        return out
    legacy_scorer = {'judged': 'council', 'scripted': 'scripted'}.get(mt)
    m_strategy = (field(text, 'strategy') or '').lower() or None
    m_scorer = (field(text, 'scorer') or '').lower() or None
    if m_scorer and m_scorer != 'auto' and legacy_scorer and m_scorer != legacy_scorer:
        out['reason'] = f'methodology conflict: scorer: {m_scorer} but metric_type: {mt}'
        return out

    strategy, s_src = resolve((strategy_arg or '').lower() or None, m_strategy)
    scorer, c_src = resolve((scorer_arg or '').lower() or None, m_scorer, legacy_scorer)

    if strategy is None:
        out.update(status='route', scorer=scorer, source={'scorer': c_src} if c_src else {},
                   reason='no strategy given: run the router, show the strategy card and pause')
        return out
    out.update(strategy=strategy, source={'strategy': s_src})

    if strategy in ('not-an-experiment', 'build'):
        out['reason'] = 'not an experiment: the answer is already known; build it directly'
        return out
    if strategy not in STRATEGIES:
        out['reason'] = f'unknown strategy: {strategy} (expected one of {", ".join(STRATEGIES)})'
        return out
    if scorer is None:
        scorer, c_src = 'scripted', 'default'
    if scorer not in SCORERS:
        out['reason'] = f'unknown scorer: {scorer} (expected scripted or council)'
        return out
    out['scorer'] = scorer
    out['source']['scorer'] = c_src
    if legacy_scorer and scorer != legacy_scorer:
        out['reason'] = f'methodology metric_type: {mt} conflicts with scorer={scorer}'
        return out
    if strategy in NOT_BUILT:
        out['reason'] = f'{strategy} is not built yet (plan phase {NOT_BUILT[strategy]})'
        return out
    transport = transport or field(text, 'Transport') or 't3'
    if scorer == 'council':
        try:
            council_transport(transport)
            if strategy not in ('climb', 'compare'): raise ValueError('council supports climb and compare')
        except (ValueError, OSError) as error:
            out['reason'] = str(error)
            return out
    if not methodology_path:
        out.update(missing=['methodology'], reason=f'{strategy} needs a methodology file')
        return out
    from experiment_loop import config, validate
    if scorer == 'council' and strategy == 'climb':
        import judged
        result = judged.validate(Path(methodology_path), transport, council=True)
        out.update(status='ready' if result['ok'] else 'refused', metric_type='judged',
                   engine='judged.py', transport=transport, reason=None if result['ok'] else '; '.join(result['errors']))
        return out
    out['missing'] = (climb_missing(text) if strategy == 'climb' else [
        f'section: {name}' for name in ('Objective', 'Scope Constraints', 'Working Directory')
        if not any(t.startswith(name.lower()) for t in sections(text))])
    out['missing'] += [name.lower() + ': command' for name in (('Checks',) if scorer == 'council' else ('Measure', 'Checks'))
                       if not field(text, name)]
    if strategy == 'remediate' and not field(text, 'Budget'):
        out['missing'].append('budget: maximum iterations')
    try:
        c = config(text, strategy)
        c['scorer'] = scorer
        validate(c)
        if strategy == 'compare':
            from experiment_compare import configuration
            configuration(text, c)
    except (ValueError, KeyError, TypeError, OSError) as error:
        out['reason'] = str(error)
        return out
    if out['missing']:
        out['reason'] = f'methodology is missing required inputs for {strategy}'
        return out
    out.update(status='ready', reason=None, **({'transport': transport} if scorer == 'council' else {}))
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    c = sub.add_parser('check')
    c.add_argument('--strategy')
    c.add_argument('--scorer')
    c.add_argument('--methodology')
    c.add_argument('--transport', choices=('t3', 'direct'))
    from experiment_loop import add_commands, dispatch
    add_commands(sub)
    a = parser.parse_args(argv)
    if a.command != 'check':
        try:
            result = dispatch(a, check)
            code = 0
        except (ValueError, OSError) as error:
            result, code = {'status': 'refused', 'reason': str(error)}, 1
        if a.command == 'status' and code == 0:
            for row in result:
                print(json.dumps(row, sort_keys=True))
        else:
            print(json.dumps(result, sort_keys=True))
        return code
    result = check(a.strategy, a.scorer, a.methodology, a.transport)
    print(json.dumps(result, sort_keys=True))
    return {'ready': 0, 'route': 2}.get(result['status'], 1)


if __name__ == '__main__':
    sys.exit(main())
