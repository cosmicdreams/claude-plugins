#!/usr/bin/env python3
"""tokens.json -> a Figma variable plan: primitives, semantics, modes, scopes, code syntax.

Raw extraction is not a variable plan. Site Studio custom styles are component-scoped, so
Schusterman yields 57 colour rows that collapse to 11 distinct hexes, and 115 spacing rows
that collapse to a handful of ramps. Creating a variable per row would produce a picker
nobody can use.

So: deduplicate by VALUE, name from the styles that carry it, and keep every contributing
class name as code syntax so the round trip back to the codebase survives.

    python3 plan_variables.py tokens.json > variable-plan.json
"""
import json, re, sys, collections

SLUG = re.compile(r'[^a-z0-9]+')


def slug(s):
    return SLUG.sub('-', str(s).lower()).strip('-')


def num(v):
    """'32', '32px', 32 -> 32.0; anything non-numeric -> None."""
    m = re.match(r'^\s*(-?[\d.]+)\s*(px)?\s*$', str(v))
    return float(m.group(1)) if m else None


def dedupe(rows, key, order):
    """Group rows by an identical value signature across breakpoints."""
    groups = collections.OrderedDict()
    for r in rows:
        vals = tuple(r['valuesByBreakpoint'].get(b) for b in order)
        groups.setdefault(vals, []).append(r)
    return groups


# Classes whose name says the value IS the thing we are naming. A spacing group that
# contains .coh-style-padding-small should be called padding-small, even though several
# component-scoped styles share the value 32 and one of them has a shorter label.
AFFINITY = {
    'space':      re.compile(r'padding|margin|spacing|gap|gutter'),
    'type/leading-ratio': re.compile(r'heading|body|paragraph|title|type-system|line-height'),
    'type/size':  re.compile(r'heading|body|paragraph|title|type-system|caption|label'),
    'type/leading': re.compile(r'heading|body|paragraph|title|type-system|line-height'),
    'color':      re.compile(r'color|theme|background|text'),
}


def pick_name(rows, prefix):
    """Name a group from the contributing style that best describes the VALUE.

    Shortest-name-wins alone produces nonsense on Site Studio, because custom styles are
    component-scoped and unrelated components share values: Schusterman's 16px spacing
    group picked "Heading 4 size" over "Padding small" purely on length. So prefer a
    contributing style whose class name matches the family being named, and fall back to
    shortest only when none does."""
    rx = AFFINITY.get(prefix)
    if rx:
        preferred = [r for r in rows
                     if rx.search(slug(r.get('codeName') or '')) or rx.search(slug(r['name']))]
        if preferred:
            rows = preferred
    names = sorted({r['name'] for r in rows}, key=lambda n: (len(n), n))
    return '%s/%s' % (prefix, slug(names[0]))


def uniquify(variables):
    """Figma variable names must be unique within a collection. Two different values can
    easily pick the same shortest style name - on Schusterman #26A3DD and #FFFFFF both
    resolved to color/card-fake-button - and creating the second silently collides with
    the first. Disambiguate with the value rather than a counter, so the name still says
    something true."""
    counts = collections.Counter(v['name'] for v in variables)
    for v in variables:
        if counts[v['name']] > 1:
            if v.get('hex'):
                v['name'] = '%s-%s' % (v['name'], v['hex'].lstrip('#').lower())
            else:
                first = next(iter(v.get('valuesByMode', {}).values()), '')
                v['name'] = '%s-%s' % (v['name'], slug(first))
            v['nameDisambiguated'] = True
    return variables


def build(tokens):
    order = tokens['modes']
    out = {'modes': order, 'collections': {}, 'warnings': []}

    # ---- colour primitives: one per distinct hex -------------------------------------
    by_hex = collections.OrderedDict()
    for c in tokens['colors']:
        if c.get('hex'):
            by_hex.setdefault(c['hex'], []).append(c)
    prims = []
    for hexv, rows in by_hex.items():
        prims.append({
            'name': pick_name(rows, 'color'),
            'type': 'COLOR', 'hex': hexv,
            'codeNames': sorted({r['codeName'] for r in rows if r.get('codeName')}),
            'scopes': ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR'],
            'usedBy': len(rows),
        })
    out['collections']['Primitives'] = {'modes': ['Value'], 'variables': uniquify(prims)}

    # ---- spacing: dedupe by breakpoint tuple ------------------------------------------
    spacing = [s for s in tokens['spacing']
               if any(num(v) is not None for v in s['valuesByBreakpoint'].values())]
    space_vars = []
    for vals, rows in dedupe(spacing, 'spacing', order).items():
        nums = [num(v) for v in vals]
        if all(n is None for n in nums):
            continue
        space_vars.append({
            'name': pick_name(rows, 'space'),
            'type': 'FLOAT',
            'valuesByMode': {b: n for b, n in zip(order, nums) if n is not None},
            'codeNames': sorted({r['codeName'] for r in rows if r.get('codeName')})[:6],
            'scopes': ['GAP', 'WIDTH_HEIGHT'],
            'usedBy': len(rows),
            'scales': len(set(n for n in nums if n is not None)) > 1,
        })
    space_vars.sort(key=lambda v: -v['usedBy'])
    out['collections']['Spacing'] = {'modes': order, 'variables': uniquify(space_vars)}

    # ---- type: font-size and line-height, deduped -------------------------------------
    type_vars = []
    for prop, prefix, scopes in (('font-size', 'type/size', ['FONT_SIZE']),
                                 ('line-height', 'type/leading', ['LINE_HEIGHT'])):
        rows = [t for t in tokens['type'] if t['property'] == prop]
        for vals, grp in dedupe(rows, prop, order).items():
            nums = [num(v) for v in vals]
            if all(n is None for n in nums):
                continue
            # CSS line-height is legally either a length (32px) or a unitless RATIO (1.25),
            # and the two cannot share a Figma variable. A ratio bound to lineHeight is
            # interpreted as 1.25 PIXELS, which silently collapses every line of text.
            # Figma has no ratio-typed line-height variable, so these are created without
            # the LINE_HEIGHT scope and named so nobody binds them by accident.
            declared = [n for n in nums if n is not None]
            is_ratio = prop == 'line-height' and declared and max(declared) < 4
            if is_ratio:
                prefix_used, scopes_used = 'type/leading-ratio', []
            else:
                prefix_used, scopes_used = prefix, scopes
            type_vars.append({
                'name': pick_name(grp, prefix_used),
                'type': 'FLOAT',
                'valuesByMode': {b: n for b, n in zip(order, nums) if n is not None},
                'codeNames': sorted({r['codeName'] for r in grp if r.get('codeName')})[:6],
                'scopes': scopes_used, 'usedBy': len(grp),
                'unitlessRatio': bool(is_ratio),
                'note': ('unitless CSS line-height ratio - Figma cannot express this as a '
                         'bindable line-height variable' if is_ratio else None),
                'scales': len(set(n for n in nums if n is not None)) > 1,
            })
    fams = collections.OrderedDict()
    for t in tokens['type']:
        if t['property'] == 'font-family':
            v = list(t['valuesByBreakpoint'].values())[0]
            if isinstance(v, str) and v.strip():
                fams.setdefault(v.strip().strip('"\''), []).append(t)
    unresolved = [f for f in fams if f.startswith('$')]
    for f in unresolved:
        # A Sass variable that the compiled config never resolved. Creating a Figma font
        # family called "$coh-font-serif" would put a name in the file that matches no
        # installed font and no codebase identifier.
        out['warnings'].append({'kind': 'unresolved-font-family', 'value': f,
                                'detail': 'Sass variable never resolved in configuration; '
                                          'no variable created. Resolve from the compiled '
                                          'stylesheet or the theme Sass source.'})
        del fams[f]
    for fam, grp in fams.items():
        type_vars.append({'name': 'type/family/%s' % slug(fam), 'type': 'STRING',
                          'valuesByMode': {b: fam for b in order},
                          'codeNames': sorted({r['codeName'] for r in grp if r.get('codeName')})[:6],
                          'scopes': ['FONT_FAMILY'], 'usedBy': len(grp), 'scales': False})
    type_vars.sort(key=lambda v: -v['usedBy'])

    # Type gets breakpoint modes only if SOME role actually scales. Generalising from one
    # role is the error the AHRI pilot made - see references/tokens-and-variables.md.
    any_scaling = any(v['scales'] for v in type_vars)
    out['collections']['Type'] = {
        'modes': order if any_scaling else ['Value'],
        'modeRationale': ('at least one type role scales across breakpoints'
                          if any_scaling else 'no type role scales; one mode is correct'),
        'variables': uniquify(type_vars)}
    return out


if __name__ == '__main__':
    t = json.load(open(sys.argv[1]))
    p = build(t)
    print(json.dumps(p, indent=2))
    for name, c in p['collections'].items():
        print('%-12s %2d modes  %3d variables' % (name, len(c['modes']), len(c['variables'])),
              file=sys.stderr)
