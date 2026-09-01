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



# ---------------------------------------------------------------------------------------
# Schema normalisation
#
# The three plug points vary independently (README), so the token source is free to be a
# Sass source map rather than Site Studio configuration. The planner below was written
# against the Site Studio shape - four typed arrays plus `modes` - and read `tokens['modes']`
# directly, so a sourcemap tokens.json crashed with KeyError: 'modes'.
#
# Defaulting that key is the wrong repair: every remaining lookup is `.get(...) or []`, so
# the planner would return four empty collections and report success while silently
# discarding every recovered token. Normalise into the canonical shape instead, and refuse
# outright on a schema nobody has taught it to read.
# ---------------------------------------------------------------------------------------

CANONICAL = ('colors', 'fontStacks', 'scssVariables', 'customStyles')


def _primary_family(stack):
    """First family in a CSS font stack, unquoted."""
    first = str(stack).split(',')[0].strip()
    return first.strip('\'"') or None


def normalize(tokens):
    """Return tokens in the canonical Site Studio shape, whatever strategy produced them."""
    strategy = (tokens.get('source') or {}).get('strategy')

    if 'modes' in tokens and any(k in tokens for k in CANONICAL):
        return tokens, []            # already canonical (sitestudio-styles)

    if strategy == 'sass-sourcemap':
        return _from_sourcemap(tokens)

    raise SystemExit(
        'plan_variables: unrecognised tokens.json schema (source.strategy=%r).\n'
        'Expected the canonical shape (modes + %s) or a strategy with a normaliser.\n'
        'Add one rather than defaulting keys - a partial read reports success while '
        'discarding every token.' % (strategy, '/'.join(CANONICAL)))


def _from_sourcemap(tokens):
    """sass-sourcemap -> canonical.

    Two things the source map genuinely does not carry, recorded rather than faked:

    * **No breakpoint cascade.** A Sass variable is declared once. The theme's media-query
      boundaries are values *in* the token set, not modes over it, so the collection gets a
      single mode. Inventing Desktop/Tablet/Mobile here would copy the same number into
      three modes and present a guess as a measurement.
    * **No property association.** Nothing says `$h2-size` is a `font-size`, so there is no
      customStyles layer and no per-role type ramp.

    The `layer` field the extractor already assigns is what separates the global palette
    from component-local values. Only the base layer becomes primitives: promoting
    component-scoped values is precisely the Schusterman error the plugin documents, where
    172 component styles were mistaken for a palette.
    """
    rows = tokens.get('tokens') or []
    base = [t for t in rows if t.get('layer') == 'base']
    skipped = len(rows) - len(base)
    warnings = []
    if skipped:
        warnings.append({
            'kind': 'component-layer-excluded', 'value': skipped,
            'detail': 'component-local Sass variables are not the palette; see '
                      'references/tokens-and-variables.md'})

    colors = [{'name': t['name'], 'hex': t['value'], 'codeName': t.get('codeName'),
               'tags': [], 'inUse': True, 'provenance': t.get('provenance')}
              for t in base if t.get('family') == 'color']

    stacks = [{'name': t['name'], 'stack': t['value'],
               'primaryFamily': _primary_family(t['value']),
               'codeName': t.get('codeName'), 'inUse': True}
              for t in base if t.get('family') == 'font-family']

    scss = [{'name': t['name'], 'value': t['value'], 'codeName': t.get('codeName')}
            for t in base if t.get('family') in ('spacing', 'number')]

    unresolved = [t['name'] for t in base if t.get('family') == 'unknown']
    if unresolved:
        warnings.append({
            'kind': 'unresolved-sass-value', 'value': len(unresolved),
            'detail': 'values the resolver could not reduce to a literal: %s'
                      % ', '.join('$' + n for n in sorted(unresolved)[:12])})

    # No tags exist on a Sass variable, so the tag-driven SEMANTIC rules below cannot fire.
    # Say so once, here, instead of emitting five identical near-miss warnings.
    warnings.append({
        'kind': 'semantic-layer-needs-authoring', 'value': 'Semantic',
        'detail': 'Site Studio colours carry tags that state what they are FOR; a Sass '
                  'variable carries only a name. The semantic layer for this strategy is a '
                  'naming decision a human makes, not something extraction can derive.'})

    return ({'source': tokens.get('source'), 'modes': ['Value'],
             'modeRationale': 'a Sass source map declares each variable once; it carries no '
                              'breakpoint cascade to build modes from',
             'typeScaling': tokens.get('typeScaling'),
             'colors': colors, 'fontStacks': stacks,
             'scssVariables': scss, 'customStyles': []},
            warnings)


def build(tokens):
    tokens, prewarnings = normalize(tokens)
    order = tokens['modes']
    out = {'modes': order, 'collections': {}, 'warnings': list(prewarnings)}

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
    taggable = any(p['tags'] for p in prims)
    for sname, pred in (SEMANTIC if taggable else []):
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
