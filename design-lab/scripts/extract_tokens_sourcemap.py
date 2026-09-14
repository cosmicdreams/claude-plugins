#!/usr/bin/env python3
"""Sass-source-map token extractor -> tokens.json.

For themes that ship compiled CSS but keep their Sass sources in another repository.
The committed `.css.map` embeds the original stylesheets in `sourcesContent`, so the
authoritative variable declarations are recoverable from the site repository alone -
no build toolchain, no running site, no measurement.

Why this matters: the obvious probe, "does the theme define CSS custom properties",
finds the wrong thing on such a theme. PNCB's active stylesheet declares 12 custom
properties, while an *unloaded* scaffolding file carries 69 Catppuccin and Tailwind
names. Recommending `css-custom-properties` there imports a palette the site never
renders. The source map carries the 39 real ones.

Configuration beats measurement (references/model.md), and a source map is configuration.
"""
import json, os, re, sys, glob, datetime, colorsys

# references/library-standard.md section 10: every artifact states which edition it
# was built to, or nobody can tell whether a library predates a rule.
STANDARD_VERSION = '2.1.0'

SKIP = re.compile(r'/(node_modules|vendor|\.git)/')

# $name: value;  - tolerant of !default / !global, stops at the first semicolon.
VAR = re.compile(r'^\s*\$([a-zA-Z0-9_-]+)\s*:\s*(.+?)\s*;', re.M)
FLAGS = re.compile(r'\s*!(default|global)\b')

HEX = re.compile(r'^#[0-9a-fA-F]{3,8}$')
RGB = re.compile(r'^rgba?\([^)]*\)$', re.I)
LEN = re.compile(r'^-?\d*\.?\d+(px|rem|em|vh|vw|%)$')
NUM = re.compile(r'^-?\d*\.?\d+$')
EMFN = re.compile(r'^em\(\s*(-?\d*\.?\d+)\s*\)$')
FONTSTACK = re.compile(r'["\'][^"\']+["\']\s*,')
# lighten($c, 10) / darken(#abc, 20%) - Sass adjusts HSL lightness by whole percent.
COLORFN = re.compile(r'^(lighten|darken)\(\s*(.+?)\s*,\s*(-?[\d.]+)%?\s*\)$', re.I)


def find_maps(root):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        if SKIP.search(dirpath + '/'):
            dirnames[:] = []
            continue
        out += [os.path.join(dirpath, f) for f in filenames if f.endswith('.css.map')]
    return sorted(out)


def classify(value):
    """Family for a resolved value. Unknown is a real answer, not a default."""
    v = value.strip()
    if HEX.match(v) or RGB.match(v):
        return 'color'
    if EMFN.match(v) or LEN.match(v):
        return 'spacing'
    if FONTSTACK.search(v) or v.lower() in ('serif', 'sans-serif', 'monospace'):
        return 'font-family'
    if v.lower() in ('true', 'false'):
        return 'flag'
    if NUM.match(v):
        return 'number'
    return 'unknown'


def _hex_to_rgb(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    if len(h) < 6:
        return None
    try:
        return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return None


def _rgb_to_hex(r, g, b):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(c * 255))) for c in (r, g, b))


def adjust_lightness(hexv, delta):
    """Sass lighten()/darken(): shift HSL lightness by whole percentage points.

    Without this the theme's hover colours stay as the literal string
    `lighten(#526FDC, 10)` and land in the 'unknown' family, which reads as "this value
    has no provenance" when in fact its provenance is exact. PNCB's `primary-hover`
    #7c92e5 and `primary-link-hover` #a7b6ed are both recovered here.
    """
    rgb = _hex_to_rgb(hexv)
    if rgb is None:
        return None
    h, l, sat = colorsys.rgb_to_hls(*rgb)
    return _rgb_to_hex(*colorsys.hls_to_rgb(h, max(0.0, min(1.0, l + delta / 100.0)), sat))


def resolve(raw, table, depth=0):
    """Resolve $alias chains and em() calls. Cycles stop rather than recurse forever."""
    v = raw.strip()
    if depth > 8:
        return v
    m = re.fullmatch(r'\$([a-zA-Z0-9_-]+)', v)
    if m:
        target = table.get(m.group(1))
        return resolve(target, table, depth + 1) if target is not None else v
    m = EMFN.match(v)
    if m:
        # Bourbon/Neat em() against the 16px default root font size.
        return '%gpx' % (float(m.group(1)))
    m = COLORFN.match(v)
    if m:
        fn, inner, amt = m.group(1).lower(), m.group(2), float(m.group(3))
        base = resolve(inner, table, depth + 1)
        if HEX.match(base.strip()):
            out = adjust_lightness(base.strip(), amt if fn == 'lighten' else -amt)
            if out:
                return out
        return v
    if '$' in v:
        def sub(mo):
            t = table.get(mo.group(1))
            return resolve(t, table, depth + 1) if t is not None else mo.group(0)
        substituted = re.sub(r'\$([a-zA-Z0-9_-]+)', sub, v)
        # Re-enter: substitution can expose a form that is itself resolvable, e.g.
        # em($container-width) -> em(1180) -> 1180px. Without this pass those stay
        # as unresolved function calls and land in the 'unknown' family.
        if substituted != v:
            return resolve(substituted, table, depth + 1)
        return substituted
    return v


def extract(root, base_hint='base/'):
    root = os.path.abspath(root)
    maps = find_maps(root)
    if not maps:
        raise SystemExit('no .css.map found under %s - this strategy does not apply' % root)

    tokens, sources_seen, problems = [], [], []
    for mpath in maps:
        try:
            data = json.load(open(mpath, errors='ignore'))
        except Exception as e:
            problems.append({'kind': 'unreadable-sourcemap',
                             'ref': os.path.relpath(mpath, root), 'detail': str(e)[:200]})
            continue
        srcs = data.get('sources') or []
        contents = data.get('sourcesContent') or []
        if not contents:
            problems.append({'kind': 'sourcemap-without-content',
                             'ref': os.path.relpath(mpath, root),
                             'detail': 'no sourcesContent - original Sass is not recoverable'})
            continue

        # Build the alias table across the whole map first: a variable in _colors.scss is
        # routinely referenced from _buttons.scss, so per-file resolution under-resolves.
        table = {}
        for src, body in zip(srcs, contents):
            if not body or 'node_modules' in src:
                continue
            for name, val in VAR.findall(body):
                table.setdefault(name, FLAGS.sub('', val).strip())

        for src, body in zip(srcs, contents):
            if not body or 'node_modules' in src:
                continue
            found = VAR.findall(body)
            if not found:
                continue
            sources_seen.append({'source': src, 'variables': len(found)})
            for name, val in found:
                raw = FLAGS.sub('', val).strip()
                resolved = resolve(raw, table)
                tokens.append({
                    'name': name,
                    # references/tokens-and-variables.md: for sass-sourcemap the codeName is
                    # the original Sass variable. Emitting it is what lets figma-foundation
                    # set Dev Mode code syntax; without it every variable shows a raw hex.
                    'codeName': '$' + name,
                    'raw': raw,
                    'value': resolved,
                    'family': classify(resolved),
                    'isAlias': raw != resolved,
                    # Variables under base/ are the global token layer; everything else is
                    # a component-local value that happens to be a variable.
                    'layer': 'base' if base_hint in src else 'component',
                    'provenance': {'kind': 'config',
                                   'ref': '%s#%s' % (os.path.relpath(mpath, root), src)},
                })

    # Same name defined in several files: keep the base-layer definition, record the rest.
    by_name, dupes = {}, []
    for t in tokens:
        prev = by_name.get(t['name'])
        if prev is None:
            by_name[t['name']] = t
        elif prev['layer'] != 'base' and t['layer'] == 'base':
            dupes.append(prev)
            by_name[t['name']] = t
        else:
            dupes.append(t)

    kept = sorted(by_name.values(), key=lambda t: (t['layer'] != 'base', t['family'], t['name']))
    fams = {}
    for t in kept:
        fams[t['family']] = fams.get(t['family'], 0) + 1

    return {
        'standardVersion': STANDARD_VERSION,
        'generatedAt': datetime.datetime.now().replace(microsecond=0).isoformat(),
        'source': {'strategy': 'sass-sourcemap', 'root': root,
                   'maps': [os.path.relpath(m, root) for m in maps]},
        'totals': {'tokens': len(kept), 'base': sum(1 for t in kept if t['layer'] == 'base'),
                   'component': sum(1 for t in kept if t['layer'] == 'component'),
                   'shadowed': len(dupes), 'byFamily': fams},
        # figma-foundation reads typeScaling to decide whether the Type collection needs
        # breakpoint modes. A source map records one declaration per variable with no
        # property or media-query context, so scaling is genuinely NOT OBSERVABLE here -
        # which is different from "nothing scales". Saying so explicitly stops the skill
        # from silently building a single-mode Type collection off a missing key.
        'typeScaling': {
            'observable': False,
            'noneScale': None,
            'reason': 'Sass source maps carry variable declarations without the CSS property '
                      'or breakpoint they apply at; per-role scaling cannot be derived. '
                      'Measure the rendered type ramp, or read the theme breakpoints, before '
                      'choosing modes for the Type collection.',
        },
        'tokens': kept,
        'shadowed': dupes,
        'sourcesWithVariables': sorted(sources_seen, key=lambda s: -s['variables']),
        'problems': problems,
    }


if __name__ == '__main__':
    print(json.dumps(extract(sys.argv[1] if len(sys.argv) > 1 else '.'), indent=2))
