#!/usr/bin/env python3
"""Join components.json with builds/*.json into the Getting Started index.

One row per component discovered, whether or not it was built, each carrying the node
identifier its row hyperlinks to. Deterministic and idempotent: run it after every single
component build and render the whole index from the result. Emits JSON; --report prints a
readable summary.

See references/library-standard.md section 8.
"""
import json, os, sys, argparse, datetime

STANDARD_VERSION = '2.1.0'

HIGH, MEDIUM, LOW = 'Components — High Use', 'Components — Medium Use', 'Components — Low Use'
STRUCTURAL, RETIRE = 'Components — Structural Only', 'Components — Retirement Candidates'
TIER_ORDER = [HIGH, MEDIUM, LOW, STRUCTURAL, RETIRE]


def structural_refs(usage):
    """How many times the component renders without an author placing it.

    `structuralRefs` per references/model.md; the longer spelling is accepted because it is
    the obvious thing to write and silently returning zero is the worst possible failure —
    it marks load-bearing components as deletion candidates.
    """
    for k in ('structuralRefs', 'structuralReferences'):
        if usage.get(k) is not None:
            return usage[k]
    return None


def tier_of(comp, high, medium):
    """Usage decides the page. No usage data is a gap, not a default."""
    usage = comp.get('usage')
    if not usage:
        return None
    placements = usage.get('placements') or 0
    # `structuralRefs` is the key references/model.md defines and every extractor writes.
    # This read `structuralReferences` — a name that exists nowhere — so it was always 0 and
    # every structural-only component was tiered as a retirement candidate instead.
    structural = structural_refs(usage) or 0
    if placements >= high:
        return HIGH
    if placements >= medium:
        return MEDIUM
    if placements >= 1:
        return LOW
    return STRUCTURAL if structural >= 1 else RETIRE


def record_path(builds_dir, comp):
    """Build records are named for the machine name; fall back to a sanitised id."""
    for stem in (comp.get('machineName'), comp['id'].replace(':', '_').replace('/', '_')):
        if not stem:
            continue
        p = os.path.join(builds_dir, stem + '.json')
        if os.path.exists(p):
            return p
    return None


def read_record(builds_dir, comp):
    p = record_path(builds_dir, comp)
    if not p:
        return None
    try:
        return json.load(open(p))
    except (ValueError, IOError) as e:
        return {'_unreadable': '%s: %s' % (os.path.basename(p), e)}


def why_not_built(rec):
    if rec is None:
        return 'not attempted'
    if rec.get('_unreadable'):
        return 'build record unreadable — %s' % rec['_unreadable']
    if rec.get('verdict') == 'refuse':
        n = (rec.get('built') or {}).get('variants')
        return 'refused by the planner' + (' — would be %s variants' % format(n, ',') if n else '')
    failed = [k for k, v in (rec.get('assertions') or {}).items() if v.get('verdict') == 'fail']
    if failed:
        return 'build failed — %s assertion(s): %s' % (len(failed), ', '.join(sorted(failed)))
    return 'build record exists but records no Figma node'


def row_for(comp, rec, high, medium):
    figma = (rec or {}).get('figma') or {}
    node = figma.get('componentSetId') or figma.get('componentId')
    card = figma.get('documentationCardId')
    usage = comp.get('usage') or {}
    row = {
        'id': comp['id'],
        'machineName': comp.get('machineName') or comp['id'].split(':')[-1],
        'label': comp.get('label') or comp['id'],
        'tier': tier_of(comp, high, medium),
        'placements': usage.get('placements'),
        'structuralRefs': structural_refs(usage),
        'built': bool(node),
        'figma': {'pageId': figma.get('pageId'), 'componentNodeId': node,
                  'documentationCardId': card},
        'linkTarget': card or node,
        'reason': None,
        'deferred': len((rec or {}).get('deferred') or []),
        'unsupported': len((rec or {}).get('unsupported') or []),
    }
    if not row['built']:
        row['reason'] = why_not_built(rec)
    return row


def sort_key(row):
    tier = row['tier']
    return (TIER_ORDER.index(tier) if tier in TIER_ORDER else len(TIER_ORDER),
            -(row['placements'] or 0),
            row['machineName'])


def build_index(comps, builds_dir, high, medium):
    rows = [row_for(c, read_record(builds_dir, c), high, medium) for c in comps]
    rows.sort(key=sort_key)
    by_tier = {}
    for t in TIER_ORDER + [None]:
        in_tier = [r for r in rows if r['tier'] == t]
        if not in_tier and t is None:
            continue
        by_tier[t or 'no usage data'] = {
            'components': len(in_tier),
            'built': sum(1 for r in in_tier if r['built']),
        }
    problems = []
    untiered = [r for r in rows if r['tier'] is None]
    if untiered:
        problems.append({'check': 'usage-data-missing',
                         'detail': '%d component(s) have no usage data, so no tier could be '
                                   'assigned: %s' % (len(untiered),
                                                     ', '.join(r['machineName'] for r in untiered[:8]))})
    seen = {}
    for r in rows:
        seen.setdefault(r['machineName'], []).append(r['id'])
    clashes = {name: ids for name, ids in seen.items() if len(ids) > 1}
    if clashes:
        # Figma component names must be unique, and a jump list with two identical rows
        # sends the reader to the wrong card. Qualify the name at build time.
        problems.append({'check': 'machine-name-collision',
                         'detail': '%d machine name(s) are used by more than one component, so '
                                   'they cannot each be named "machine_name — Human Label": %s'
                                   % (len(clashes),
                                      '; '.join('%s (%s)' % (n, ', '.join(i))
                                                for n, i in sorted(clashes.items())[:5]))})
    return {
        'standardVersion': STANDARD_VERSION,
        'generatedAt': datetime.datetime.now(datetime.timezone.utc)
                               .replace(microsecond=0).isoformat().replace('+00:00', 'Z'),
        'thresholds': {'high': high, 'medium': medium,
                       'default': high == 50 and medium == 10},
        'totals': {'components': len(rows),
                   'built': sum(1 for r in rows if r['built']),
                   'notBuilt': sum(1 for r in rows if not r['built']),
                   'byTier': by_tier},
        'rows': rows,
        'notBuilt': [{'id': r['id'], 'machineName': r['machineName'], 'label': r['label'],
                      'tier': r['tier'], 'reason': r['reason']}
                     for r in rows if not r['built']],
        'problems': problems,
    }


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('components_json')
    ap.add_argument('--builds', default='builds', help='directory of build records')
    ap.add_argument('--high', type=int, default=50, help='placements for High Use')
    ap.add_argument('--medium', type=int, default=10, help='placements for Medium Use')
    ap.add_argument('--report', action='store_true')
    a = ap.parse_args()
    d = json.load(open(a.components_json))
    idx = build_index(d['components'], a.builds, a.high, a.medium)
    if not a.report:
        print(json.dumps(idx, indent=2)); sys.exit()
    t = idx['totals']
    print('%d component(s): %d built, %d not built' % (t['components'], t['built'], t['notBuilt']))
    if not idx['thresholds']['default']:
        print('thresholds overridden: High >= %d, Medium >= %d — state the reason on '
              'Getting Started' % (a.high, a.medium))
    print()
    for tier, counts in t['byTier'].items():
        print('  %-38s %3d component(s), %3d built' % (tier, counts['components'], counts['built']))
    if idx['notBuilt']:
        print('\nNOT BUILT:')
        for r in idx['notBuilt'][:20]:
            print('  %-36s %s' % (r['machineName'], r['reason']))
        if len(idx['notBuilt']) > 20:
            print('  ... and %d more' % (len(idx['notBuilt']) - 20))
    for p in idx['problems']:
        print('\nPROBLEM %s: %s' % (p['check'], p['detail']))
