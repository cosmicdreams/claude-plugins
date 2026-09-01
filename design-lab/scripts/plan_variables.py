#!/usr/bin/env python3
"""tokens.json -> a Figma variable plan: primitives, semantics, modes, scopes, code syntax.

The palette comes from cohesion_website_settings and is already a design system: named
colours, resolved font stacks, a spacer scale, each with its own Sass variable. So this does
almost no guessing about those - it carries them across intact, because the names a human
already chose beat any name a heuristic can derive.

Deduplication is only needed for the component-scoped custom-style layer, where 172 entities
collapse to a handful of real ramps.

    python3 plan_variables.py tokens.json > variable-plan.json
"""
import json, re, sys, collections

SLUG = re.compile(r'[^a-z0-9]+')
slug = lambda s: SLUG.sub('-', str(s).lower()).strip('-')


def num(v):
    m = re.match(r'^\s*(-?[\d.]+)\s*(px|rem|em)?\s*$', str(v))
    return float(m.group(1)) if m else None


def uniquify(vs):
    """Figma variable names must be unique within a collection."""
    counts = collections.Counter(v['name'] for v in vs)
    for v in vs:
        if counts[v['name']] > 1:
            disc = v.get('hex') or next(iter(v.get('valuesByMode', {}).values()), '')
            v['name'] = '%s-%s' % (v['name'], slug(str(disc)).lstrip('-'))
            v['nameDisambiguated'] = True
    return vs


# A colour's tags say what it is FOR. That is the only semantic signal the configuration
# carries, so it is what the semantic layer is built from rather than invented.
SEMANTIC = [
    ('surface/brand',     lambda t, n: 'brand' in t and 'background' in t),
    ('surface/dark',      lambda t, n: 'dark' in t and 'background' in t),
    ('surface/light',     lambda t, n: 'light' in t and 'background' in t),
    ('text/default',      lambda t, n: 'text' in t and 'dark' in t),
    ('text/on-dark',      lambda t, n: 'text' in t and 'light' in t),
]


def build(tokens):
    order = tokens['modes']
    out = {'modes': order, 'collections': {}, 'warnings': []}

    # ---- primitives: the palette, carried across intact ------------------------------
    prims = []
    for c in tokens.get('colors') or []:
        if not c.get('hex'):
            out['warnings'].append({'kind': 'colour-without-hex', 'value': c.get('name')})
            continue
        prims.append({'name': 'color/%s' % slug(c['name']), 'type': 'COLOR', 'hex': c['hex'],
                      'codeName': c.get('codeName'), 'tags': c.get('tags') or [],
                      'inUse': c.get('inUse', True), 'scopes': []})
    out['collections']['Primitives'] = {'modes': ['Value'], 'variables': uniquify(prims)}

    # ---- semantics: aliases, driven by the palette's own tags -------------------------
    byname = {p['name']: p for p in prims}
    sem = []
    for sname, pred in SEMANTIC:
        hit = next((p for p in prims
                    if p['inUse'] and pred(set(p['tags']), p['name'])), None)
        if hit:
            sem.append({'name': sname, 'type': 'COLOR', 'aliasOf': hit['name'],
                        'hex': hit['hex'], 'codeName': hit['codeName'],
                        'scopes': (['TEXT_FILL'] if sname.startswith('text/')
                                   else ['FRAME_FILL', 'SHAPE_FILL'])})
        else:
            out['warnings'].append({'kind': 'no-semantic-candidate', 'value': sname,
                                    'detail': 'no in-use palette colour carries the required tags'})
    out['collections']['Semantic'] = {'modes': ['Value'], 'variables': sem}

    # ---- type families: resolved, never the raw Sass variable -------------------------
    fams = []
    for f in tokens.get('fontStacks') or []:
        if not f.get('primaryFamily'):
            continue
        fams.append({'name': 'type/family/%s' % slug(f['name']), 'type': 'STRING',
                     'valuesByMode': {'Value': f['primaryFamily']},
                     'codeName': f.get('codeName'), 'stack': f.get('stack'),
                     'inUse': f.get('inUse', True), 'scopes': ['FONT_FAMILY']})

    # ---- spacing: the scss spacer scale, then deduped custom-style ramps ---------------
    space = []
    for v in tokens.get('scssVariables') or []:
        n = num(v.get('value'))
        if n is None:
            continue
        space.append({'name': 'space/%s' % slug(v['name']), 'type': 'FLOAT',
                      'valuesByMode': {b: n for b in order},
                      'codeName': v.get('codeName'), 'scopes': ['GAP', 'WIDTH_HEIGHT'],
                      'scales': False})

    groups = collections.OrderedDict()
    for r in tokens.get('customStyles') or []:
        if r['family'] != 'spacing':
            continue
        vals = tuple(r['valuesByBreakpoint'].get(b) for b in order)
        if all(num(v) is None for v in vals):
            continue
        groups.setdefault(vals, []).append(r)
    for vals, rows in groups.items():
        pref = [r for r in rows if re.search(r'padding|margin|spacing|gap',
                                             slug(r.get('codeName') or ''))] or rows
        name = sorted({r['name'] for r in pref}, key=lambda n: (len(n), n))[0]
        nums = [num(v) for v in vals]
        space.append({'name': 'space/%s' % slug(name), 'type': 'FLOAT',
                      'valuesByMode': {b: n for b, n in zip(order, nums) if n is not None},
                      'codeName': sorted({r['codeName'] for r in pref if r.get('codeName')})[:1] or None,
                      'scopes': ['GAP', 'WIDTH_HEIGHT'],
                      'scales': len({n for n in nums if n is not None}) > 1})
    out['collections']['Spacing'] = {'modes': order, 'variables': uniquify(space)}

    # ---- type sizes and leading -------------------------------------------------------
    tv = list(fams)
    for prop, prefix, scopes in (('font-size', 'type/size', ['FONT_SIZE']),
                                 ('line-height', 'type/leading', ['LINE_HEIGHT'])):
        g = collections.OrderedDict()
        for r in tokens.get('customStyles') or []:
            if r['property'] != prop:
                continue
            vals = tuple(r['valuesByBreakpoint'].get(b) for b in order)
            if all(num(v) is None for v in vals):
                continue
            g.setdefault(vals, []).append(r)
        for vals, rows in g.items():
            nums = [num(v) for v in vals]
            declared = [n for n in nums if n is not None]
            # CSS line-height is legally a length OR a unitless ratio. A ratio bound to
            # Figma's lineHeight is read as PIXELS and collapses every line of text.
            ratio = prop == 'line-height' and declared and max(declared) < 4
            name = sorted({r['name'] for r in rows}, key=lambda n: (len(n), n))[0]
            tv.append({'name': '%s/%s' % ('type/leading-ratio' if ratio else prefix, slug(name)),
                       'type': 'FLOAT',
                       'valuesByMode': {b: n for b, n in zip(order, nums) if n is not None},
                       'codeName': sorted({r['codeName'] for r in rows if r.get('codeName')})[:1] or None,
                       'scopes': [] if ratio else scopes,
                       'unitlessRatio': bool(ratio),
                       'scales': len({n for n in declared}) > 1})
    any_scale = any(v.get('scales') for v in tv)
    out['collections']['Type'] = {
        'modes': order if any_scale else ['Value'],
        'modeRationale': ('at least one type role scales across breakpoints' if any_scale
                          else 'no type role scales; one mode is correct'),
        'variables': uniquify(tv)}
    return out


if __name__ == '__main__':
    p = build(json.load(open(sys.argv[1])))
    print(json.dumps(p, indent=2))
    for n, c in p['collections'].items():
        print('%-12s %2d modes  %3d variables' % (n, len(c['modes']), len(c['variables'])),
              file=sys.stderr)
    for w in p['warnings']:
        print('warning: %s %s' % (w['kind'], w.get('value')), file=sys.stderr)
