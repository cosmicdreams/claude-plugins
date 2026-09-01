#!/usr/bin/env python3
"""Turn components.json into a build proposal a human can approve.

Applies references/variant-policy.md defaults, shows the variant arithmetic, and refuses
components that would explode. Emits JSON; --report prints a readable summary.
"""
import json, sys, re, argparse

MAX_VARIANTS = 64
SIDE_WORDS = re.compile(r'-(top|bottom|left|right|equal)\b|-(top-bottom|left-right)-')

def varies_by_side(field):
    sides = set()
    for o in field.get('options') or []:
        v = str(o.get('value') or '')
        m = re.findall(r'padding-(top-bottom|left-right|top|bottom|left|right|small|medium|large|none)', v)
        sides.update(x for x in m if x not in ('small', 'medium', 'large', 'none'))
    return len(sides) > 1

def effective_options(field):
    """Declared options, plus an implicit unset state when the default is empty."""
    opts = field.get('options') or []
    if not opts:
        return 0
    has_empty = any((o.get('value') in (None, '')) for o in opts)
    implicit = 0 if has_empty else (1 if field.get('default') in (None, '') else 0)
    return len(opts) + implicit


def treat(field):
    kind, fam = field['kind'], field.get('tokenFamily')
    opts = field.get('options') or []
    n = effective_options(field)
    if kind == 'enum' and n == 0:
        # Options could not be extracted (dynamic or referenced elsewhere). Never let this
        # become a variant axis - it would multiply the whole set to zero.
        return 'manual', 1, 'no options could be extracted - resolve by hand"'.rstrip('"')
    if kind == 'enum':
        if fam == 'spacing':
            flag = 'options vary by which sides are padded - variant may be wanted' if varies_by_side(field) else None
            return 'variable', n, flag
        if fam in ('color-scheme', 'layout'):
            return 'variant', n, None
        if n == 2:
            return 'boolean', 2, None
        if n <= 6:
            return 'variant', n, None
        # More than 6 options and no token family. variant-policy.md calls for a review,
        # not an axis - so do NOT multiply it into the set. Returning 'variant' here made
        # a single wide enum refuse the whole component: PNCB's icon_callout carries two
        # 10-option icon pickers, and 11 x 11 = 121 tripped the hard stop even though an
        # icon picker is an instance swap, never a variant axis.
        return 'manual', 1, ('%d options and no token family - not built as a variant axis. '
                             'Icon or media pickers want an instance swap; a long value '
                             'list is usually tokens in disguise. Decide by hand.' % n)
    if kind in ('richtext', 'text'):
        return 'text', 1, None
    if kind == 'boolean':
        return 'boolean', 1, None
    if kind in ('hidden', 'help'):
        return 'skip', 1, None
    if kind in ('media', 'color', 'number', 'reference', 'array'):
        return 'manual', 1, None
    return 'manual', 1, None

def plan_component(c):
    axes, props, flags, skipped = [], [], [], []
    for f in c['fields']:
        t, n, flag = treat(f)
        if flag:
            flags.append({'field': f['name'], 'note': flag})
        if t == 'variant':
            axes.append({'field': f['name'], 'label': f['label'], 'options': n})
        elif t == 'skip':
            skipped.append(f['name'])
        else:
            props.append({'field': f['name'], 'treatment': t})
    for s in c.get('slots') or []:
        props.append({'field': s['name'], 'treatment': 'swap'})
    total = 1
    for a in axes:
        total *= a['options']
    naive = 1
    for f in c['fields']:
        if f['kind'] == 'enum' and f.get('options'):
            naive *= max(1, effective_options(f))
    return {
        'id': c['id'], 'label': c['label'],
        'variantAxes': axes, 'variants': total, 'naiveVariants': naive,
        'properties': props, 'flags': flags, 'skippedFields': skipped,
        'verdict': 'refuse' if total > MAX_VARIANTS else 'build',
        'refuseReason': ('proposed %d variants exceeds maxVariants %d - treat as a layout '
                         'engine (auto-layout plus variable modes), not a variant set'
                         % (total, MAX_VARIANTS)) if total > MAX_VARIANTS else None,
        'defects': c.get('defects') or [],
    }

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('components_json')
    ap.add_argument('--report', action='store_true')
    ap.add_argument('--only', help='comma-separated component ids')
    a = ap.parse_args()
    d = json.load(open(a.components_json))
    comps = d['components']
    if a.only:
        keep = set(a.only.split(','))
        comps = [c for c in comps if c['id'] in keep]
    plans = [plan_component(c) for c in comps]
    if not a.report:
        print(json.dumps({'plans': plans}, indent=2)); sys.exit()
    build = [p for p in plans if p['verdict'] == 'build']
    refuse = [p for p in plans if p['verdict'] == 'refuse']
    print('%d component(s): %d buildable, %d refused' % (len(plans), len(build), len(refuse)))
    print('total variants if built: %d' % sum(p['variants'] for p in build))
    print()
    for p in sorted(build, key=lambda x: -x['variants'])[:20]:
        axes = ' x '.join('%s(%d)' % (a['field'], a['options']) for a in p['variantAxes']) or '(none)'
        print('  %-36s %4d variants  (naive %s)  %s' %
              (p['id'], p['variants'],
               format(p['naiveVariants'], ','), axes))
        for f in p['flags']:
            print('        flag: %s - %s' % (f['field'], f['note']))
    if refuse:
        print('\nREFUSED:')
        for p in refuse:
            print('  %-36s would be %s variants' % (p['id'], format(p['variants'], ',')))
