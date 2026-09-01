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


ROOT_FONT_PX = 16.0   # CSS default; no theme examined so far overrides it


def num(v):
    """Numeric pixel value, or None.

    Unit-aware on purpose. Figma FLOAT variables are pixels, so reducing `2.25rem` to 2.25
    binds a 36px heading as 2.25 pixels. Site Studio authors in px and is unaffected; CSS
    custom properties are overwhelmingly authored in rem, which is what forced this.
    """
    m = re.match(r'^\s*(-?[\d.]+)\s*(px|rem|em|%)?\s*$', str(v))
    if not m:
        return None
    n, unit = float(m.group(1)), m.group(2)
    if unit in ('rem', 'em'):
        return n * ROOT_FONT_PX
    if unit == '%':
        return None      # a percentage is not a pixel length; refuse rather than guess
    return n


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

    if strategy == 'css-custom-properties':
        return _from_cssvars(tokens)

    raise SystemExit(
        'plan_variables: unrecognised tokens.json schema (source.strategy=%r).\n'
        'Expected the canonical shape (modes + %s) or a strategy with a normaliser.\n'
        'Add one rather than defaulting keys - a partial read reports success while '
        'discarding every token.' % (strategy, '/'.join(CANONICAL)))



# Colour names that state a ROLE rather than name a hue. A design system usually declares
# both - `--color-brand: #526fdc` alongside `--color-text-info: #526FDC` - and which is
# which is the whole primitive-versus-semantic distinction.
ROLE_WORD = re.compile(
    r'(^|-)(text|bg|background|surface|border|skin|link|fill|shadow|action|on|'
    r'primary|secondary|tertiary|info|danger|warning|success|muted|subtle)(-|$)', re.I)

# Role name -> the Figma semantic path and the scopes that role may be bound to.
SEMANTIC_ROLE = [
    (re.compile(r'^color-text(-|$)|^color-link', re.I), 'text',    ['TEXT_FILL']),
    (re.compile(r'^color-(bg|background)(-|$)|^color-surface|^skin-', re.I),
                                                       'surface', ['FRAME_FILL', 'SHAPE_FILL']),
    (re.compile(r'^color-border(-|$)', re.I),          'border',  ['STROKE_COLOR']),
    (re.compile(r'^color-brand(-|$)', re.I),           'action',  ['FRAME_FILL', 'SHAPE_FILL']),
]

FAMILY_SCOPES = {
    'spacing':        ['GAP', 'WIDTH_HEIGHT'],
    'radius':         ['CORNER_RADIUS'],
    'font-size':      ['FONT_SIZE'],
    'line-height':    ['LINE_HEIGHT'],
    'font-weight':    ['FONT_WEIGHT'],
    'letter-spacing': ['LETTER_SPACING'],
}


def _semantic_path(name):
    """`--color-text-muted` -> `text/muted`, `--skin-brand` -> `surface/brand`.

    Two strips, and the second one must not eat the leaf. `--skin-brand` reduces to `brand`
    after the first, and blindly stripping the role words again leaves nothing - which named
    it `surface/default` and collided it with the actual page background.
    """
    for pat, group, scopes in SEMANTIC_ROLE:
        if pat.match(name):
            leaf = re.sub(r'^(color|skin)-', '', name)
            stripped = re.sub(r'^(text|bg|background|surface|border|brand|link)-', '', leaf)
            leaf = stripped if stripped and stripped != leaf else leaf
            # A leaf that only restates its own group carries no extra information.
            if leaf in (group, 'bg', 'background', ''):
                leaf = 'default'
            return '%s/%s' % (group, slug(leaf)), scopes
    return None, None


def _norm_hex(v):
    """`#fff` and `#FFFFFF` are the same colour; grouping on the raw string says otherwise."""
    v = str(v).strip().lower()
    m = re.fullmatch(r'#([0-9a-f]{3})', v)
    if m:
        return '#' + ''.join(c * 2 for c in m.group(1))
    return v


def _from_cssvars(tokens):
    """css-custom-properties -> canonical.

    This source is different in kind from the other two: a `:root` block is authored, so the
    names already carry intent. That makes the semantic layer *derivable* here, where for a
    Sass source map it is not - and it is derived from evidence rather than invented:
    colours that share a hex are the same colour, and the name without a role word is the
    palette entry the role names point at.
    """
    rows = [t for t in (tokens.get('tokens') or []) if t.get('layer') == 'base']
    warnings = []
    modes = tokens.get('modes') or ['Value']

    def val(t):
        return (t.get('valuesByMode') or {}).get('Value', t.get('value'))

    colours = [t for t in rows if t['family'] == 'color']

    # Group by resolved hex. The member whose name carries no role word is the palette
    # entry; the rest become aliases of it.
    by_hex = collections.OrderedDict()
    for t in colours:
        by_hex.setdefault(_norm_hex(val(t)), []).append(t)

    palette, aliases = [], []
    for hexv, members in by_hex.items():
        plain = [m for m in members if not ROLE_WORD.search(m['name'])]
        lead = sorted(plain or members, key=lambda m: (len(m['name']), m['name']))[0]
        palette.append(lead)
        aliases += [m for m in members if m is not lead]

    colors = [{'name': t['name'], 'hex': val(t), 'codeName': t.get('codeName'),
               'tags': [], 'inUse': True, 'provenance': t.get('provenance')}
              for t in palette]

    semantic = []
    for t in aliases:
        path, scopes = _semantic_path(t['name'])
        if not path:
            # A role-named colour we have no mapping for is still a duplicate of a palette
            # entry; keep it addressable rather than dropping it silently.
            path, scopes = 'other/%s' % slug(t['name']), ['FRAME_FILL', 'SHAPE_FILL']
        members = by_hex[_norm_hex(val(t))]
        lead = sorted([m for m in members if not ROLE_WORD.search(m['name'])] or members,
                      key=lambda m: (len(m['name']), m['name']))[0]
        semantic.append({'name': path, 'type': 'COLOR', 'aliasOf': 'color/%s' % slug(lead['name']),
                         'hex': val(t), 'codeName': t.get('codeName'), 'scopes': scopes})

    # Role-named colours that are the ONLY holder of their hex never became aliases above,
    # so they would vanish from the semantic layer. Promote them, aliasing themselves.
    for t in palette:
        if not ROLE_WORD.search(t['name']):
            continue
        path, scopes = _semantic_path(t['name'])
        if path:
            semantic.append({'name': path, 'type': 'COLOR',
                             'aliasOf': 'color/%s' % slug(t['name']), 'hex': val(t),
                             'codeName': t.get('codeName'), 'scopes': scopes})

    seen_paths, deduped = set(), []
    for v in semantic:
        if v['name'] in seen_paths:
            warnings.append({'kind': 'semantic-path-collision', 'value': v['name'],
                             'detail': '%s resolves to a role already claimed by another '
                                       'custom property with the same value' % v['codeName']})
            continue
        seen_paths.add(v['name'])
        deduped.append(v)
    semantic = deduped

    stacks = [{'name': t['name'], 'stack': val(t),
               'primaryFamily': _primary_family(val(t)),
               'codeName': t.get('codeName'), 'inUse': True}
              for t in rows if t['family'] == 'font-family']

    scss = [{'name': t['name'], 'value': val(t), 'codeName': t.get('codeName')}
            for t in rows if t['family'] == 'spacing']

    # font-size and line-height carry a real CSS property, so they route through the
    # customStyles layer and land in the Type collection with the right scopes.
    custom = []
    for t in rows:
        # font-size only. line-height is handled above as an unscoped ratio; sending it
        # here would let it become a bindable pixel line-height.
        prop = {'font-size': 'font-size'}.get(t['family'])
        if not prop:
            continue
        custom.append({'name': t['name'], 'codeName': t.get('codeName'), 'property': prop,
                       'family': 'type',
                       'valuesByBreakpoint': dict(t.get('valuesByMode')
                                                  or {'Value': t.get('value')})})

    extra = collections.OrderedDict()

    # Unitless line-height ratios get their OWN collection with NO scopes. CSS line-height
    # is legally a length or a ratio; Figma has no ratio-typed line-height variable, so
    # binding 1.56 makes Figma read 1.56 PIXELS and collapse every line of text. Empty
    # scopes make that mistake impossible rather than merely discouraged.
    ratios = [t for t in rows if t['family'] == 'line-height'
              and (num(val(t)) or 0) and (num(val(t)) or 0) < 4]
    if ratios:
        extra['LeadingRatio'] = {'modes': ['Value'], 'variables': [
            {'name': 'leading/%s' % slug(t['name']), 'type': 'FLOAT',
             'valuesByMode': {'Value': num(val(t))}, 'codeName': t.get('codeName'),
             'scopes': [], 'unitlessRatio': True,
             'description': 'Ratio, not a length. Multiply by the font size; never bind to '
                            'lineHeight, which Figma reads as pixels.'} for t in ratios]}

    # Durations have no Figma scope at all, so they are stored unbound for reference.
    motion = [t for t in rows if t['family'] == 'motion']
    if motion:
        def ms(v):
            m = re.match(r'^\s*(-?[\d.]+)\s*(ms|s)\s*$', str(v))
            return None if not m else float(m.group(1)) * (1 if m.group(2) == 'ms' else 1000)
        vals = [(t, ms(val(t))) for t in motion]
        extra['Motion'] = {'modes': ['Value'], 'variables': [
            {'name': 'motion/%s' % slug(t['name']), 'type': 'FLOAT',
             'valuesByMode': {'Value': n}, 'codeName': t.get('codeName'), 'scopes': [],
             'description': 'Milliseconds. Figma has no duration scope, so this cannot be '
                            'bound; it is here so the value has one source.'}
            for t, n in vals if n is not None]}

    for fam in ('radius', 'font-weight', 'letter-spacing'):
        vs = [t for t in rows if t['family'] == fam]
        if not vs:
            continue
        extra[fam.replace('-', ' ').title().replace(' ', '')] = {
            'modes': ['Value'],
            'variables': [{'name': '%s/%s' % (fam.split('-')[0], slug(t['name'])),
                           'type': 'FLOAT', 'valuesByMode': {'Value': val(t)},
                           'codeName': t.get('codeName'),
                           'scopes': FAMILY_SCOPES.get(fam, [])} for t in vs]}

    unknown = [t['codeName'] for t in rows if t['family'] == 'unknown']
    if unknown:
        warnings.append({'kind': 'unclassified-custom-property', 'value': len(unknown),
                         'detail': ', '.join(sorted(unknown)[:12])})

    return ({'source': tokens.get('source'), 'modes': modes,
             'modeRationale': tokens.get('modeRationale'),
             'typeScaling': tokens.get('typeScaling'),
             'colors': colors, 'fontStacks': stacks, 'scssVariables': scss,
             'customStyles': custom,
             '_semantic': semantic, '_extraCollections': extra},
            warnings)


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
    # A normaliser that could derive the semantic layer from authored names supplies it
    # directly; the tag-driven rules above only ever fire for Site Studio.
    sem = tokens.get('_semantic') or sem
    out['collections']['Semantic'] = {'modes': ['Value'], 'variables': uniquify(sem)}

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
    for cname, coll in (tokens.get('_extraCollections') or {}).items():
        out['collections'][cname] = coll
    return out


if __name__ == '__main__':
    p = build(json.load(open(sys.argv[1])))
    print(json.dumps(p, indent=2))
    for n, c in p['collections'].items():
        print('%-12s %2d modes  %3d variables' % (n, len(c['modes']), len(c['variables'])),
              file=sys.stderr)
    for w in p['warnings']:
        print('warning: %s %s' % (w['kind'], w.get('value')), file=sys.stderr)
