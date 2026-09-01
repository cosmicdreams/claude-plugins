#!/usr/bin/env python3
"""CSS custom property token extractor -> tokens.json.

`detect.py` has always been able to *recommend* `css-custom-properties`; nothing
implemented it, so on a theme that had moved off Sass the recommended strategy had no
extractor behind it and the pipeline stopped at detection.

This is the best of the three token sources when a project has one, and the reason is
worth stating: custom properties are **authored**. A Sass source map yields whatever
variables the stylesheets happen to declare - `$base-btn-bg`, `$nth`, `$visual-grid` - and
carries no statement of intent. A `:root` block is a design decision someone wrote down,
so `--color-text` and `--color-surface` arrive already carrying the semantic layer that
`plan_variables.py` cannot derive from a Sass name.

Two things it does that a naive parse does not:

* **Only stylesheets the theme actually loads.** The obvious probe finds the wrong file.
  PNCB's real token sheet declares 96 properties, while unloaded scaffolding under
  `components/incoming/` carries 127 Catppuccin and Tailwind names. Importing those gives a
  palette the site never renders, so `*.libraries.yml` is read first and anything it does
  not reference is excluded and reported.
* **Records the selector and media query.** A property redeclared under `@media` or
  `[data-theme]` is a real mode, and it is the only evidence a token source can offer that
  a value scales. Modes are built from that evidence rather than assumed.
"""
import json, os, re, sys, glob, datetime, colorsys

# Matches detect.py. Drupal core's Claro and Olivero ship *.libraries.yml with their own
# :root token blocks; without pruning, `--admin-color-blue-500` outnumbers the real palette.
SKIP = re.compile(r'/(node_modules|vendor|\.git|contrib|core)/')

DECL = re.compile(r'(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)')
BLOCK = re.compile(r'([^{}]*)\{')
VARREF = re.compile(r'var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)')

HEX = re.compile(r'^#[0-9a-fA-F]{3,8}$')
RGB = re.compile(r'^(rgba?|hsla?)\([^)]*\)$', re.I)
LEN = re.compile(r'^-?\d*\.?\d+(px|rem|em|vh|vw|ch|%)$')
TIME = re.compile(r'^-?\d*\.?\d+m?s$')
NUM = re.compile(r'^-?\d*\.?\d+$')
FONTSTACK = re.compile(r'["\'][^"\']+["\']\s*,|,\s*(sans-serif|serif|monospace)\b')

# Name -> family. The authored prefix states intent far more reliably than the value does:
# `--leading-tight: 1.08` and `--weight-light: 300` are both bare numbers.
NAME_FAMILY = [
    (re.compile(r'^--(color|skin|bg|surface|border|text-color|fill|shadow-color)', re.I), 'color'),
    # More specific font-* names first: `--font-size-h1` is a size, not a family.
    (re.compile(r'^--(font-size|text)-', re.I), 'font-size'),
    (re.compile(r'^--(font-weight|weight)-', re.I), 'font-weight'),
    (re.compile(r'^--(font-family|font-sans|font-serif|font-mono|family)', re.I), 'font-family'),
    (re.compile(r'^--(leading|line-height)', re.I), 'line-height'),
    (re.compile(r'^--(tracking|letter-spacing)', re.I), 'letter-spacing'),
    (re.compile(r'^--([a-z0-9-]*-)?(border-)?radius|^--rounded', re.I), 'radius'),
    (re.compile(r'^--(transition|duration|delay|ease)', re.I), 'motion'),
    (re.compile(r'^--(space|gap|gutter|inset|size|width|height|pad|margin)', re.I), 'spacing'),
    (re.compile(r'^--shadow', re.I), 'shadow'),
    (re.compile(r'^--(z|index|layer)-', re.I), 'number'),
]


def value_family(v):
    """Family from the resolved value alone - the fallback when the name says nothing."""
    v = v.strip()
    if HEX.match(v) or RGB.match(v):
        return 'color'
    if FONTSTACK.search(v):
        return 'font-family'
    if TIME.match(v):
        return 'motion'
    if LEN.match(v):
        return 'spacing'
    if NUM.match(v):
        return 'number'
    return 'unknown'


def classify(name, value):
    """Name first, value second. Intent beats shape."""
    for pat, fam in NAME_FAMILY:
        if pat.match(name):
            # A name-derived colour family still has to look like a colour; `--border-width`
            # matches the colour prefix list but is plainly a length.
            if fam == 'color' and value_family(value) in ('spacing', 'number', 'motion'):
                return value_family(value)
            return fam
    return value_family(value)


def theme_stylesheets(root):
    """Absolute paths of every stylesheet referenced by a *.libraries.yml, plus the rest.

    Deliberately a text scan rather than a YAML parse: the plugin ships no YAML dependency
    and library definitions nest css groups (`theme:`, `component:`) under keys whose names
    vary by project. A path ending in `.css` on its own line is unambiguous enough.
    """
    loaded, libs = set(), []
    for dirpath, dirnames, filenames in os.walk(root):
        if SKIP.search(dirpath + os.sep):
            dirnames[:] = []
            continue
        for f in filenames:
            if not f.endswith('.libraries.yml'):
                continue
            lib = os.path.join(dirpath, f)
            libs.append(lib)
            try:
                body = open(lib, errors='ignore').read()
            except OSError:
                continue
            for m in re.finditer(r'^\s*([^\s:#][^:]*\.css)\s*:', body, re.M):
                ref = m.group(1).strip()
                if ref.startswith(('http:', 'https:', '//')):
                    continue
                loaded.add(os.path.normpath(os.path.join(dirpath, ref.lstrip('/'))))
    return loaded, libs


def strip_comments(src):
    return re.sub(r'/\*.*?\*/', '', src, flags=re.S)


def declarations(src):
    """Yield (selector, media, name, raw) for every custom property declaration.

    Tracks the enclosing at-rule stack so a property declared inside `@media (min-width:
    48em)` is distinguishable from the same property at `:root`. `@layer` is recorded but
    is not a mode - it affects cascade order, not value.
    """
    src = strip_comments(src)
    out, stack, i = [], [], 0
    while i < len(src):
        nb = src.find('{', i)
        ne = src.find('}', i)
        if nb == -1 and ne == -1:
            break
        if nb != -1 and (ne == -1 or nb < ne):
            prelude = src[i:nb].strip().replace('\n', ' ')
            prelude = re.sub(r'\s+', ' ', prelude)
            stack.append(prelude)
            # Declarations belong to the innermost non-at-rule prelude.
            body_end = src.find('}', nb)
            inner_open = src.find('{', nb + 1)
            if body_end != -1 and (inner_open == -1 or body_end < inner_open):
                media = ' and '.join(s for s in stack if s.startswith('@media'))
                sel = next((s for s in reversed(stack) if not s.startswith('@')), '')
                for m in DECL.finditer(src[nb + 1:body_end]):
                    out.append((sel, media, m.group(1), m.group(2).strip()))
                stack.pop()
                i = body_end + 1
                continue
            i = nb + 1
        else:
            if stack:
                stack.pop()
            i = ne + 1
    return out


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


def resolve(raw, table, depth=0):
    """Resolve var() chains, honouring the fallback argument. Cycles stop rather than recurse."""
    v = raw.strip()
    if depth > 8 or 'var(' not in v:
        return v

    def sub(m):
        target = table.get(m.group(1))
        if target is not None:
            return resolve(target, table, depth + 1)
        # var(--missing, fallback) is legal and the fallback is what renders.
        return (m.group(2) or m.group(0)).strip()

    out = VARREF.sub(sub, v)
    return resolve(out, table, depth + 1) if out != v else out


def extract(root):
    root = os.path.abspath(root)
    loaded, libs = theme_stylesheets(root)

    sheets, ignored, problems = [], [], []
    for dirpath, dirnames, filenames in os.walk(root):
        if SKIP.search(dirpath + os.sep):
            dirnames[:] = []
            continue
        for f in filenames:
            if not f.endswith('.css') or f.endswith('.min.css'):
                continue
            p = os.path.normpath(os.path.join(dirpath, f))
            try:
                body = open(p, errors='ignore').read()
            except OSError as e:
                problems.append({'kind': 'unreadable-stylesheet',
                                 'ref': os.path.relpath(p, root), 'detail': str(e)[:200]})
                continue
            if not DECL.search(body):
                continue
            (sheets if p in loaded else ignored).append((p, body))

    if not sheets:
        raise SystemExit(
            'no theme-loaded stylesheet declares custom properties under %s - this strategy '
            'does not apply. %d stylesheet(s) declare them but no *.libraries.yml loads them.'
            % (root, len(ignored)))

    # Resolution table spans every loaded sheet: --gutter is routinely defined in the token
    # sheet and referenced from a component sheet.
    table, rows = {}, []
    for p, body in sheets:
        for sel, media, name, raw in declarations(body):
            table.setdefault(name, raw)
    for p, body in sheets:
        decls = declarations(body)
        for sel, media, name, raw in decls:
            resolved = resolve(raw, table)
            rows.append({
                'name': name.lstrip('-'),
                # references/tokens-and-variables.md: for this strategy the codeName is the
                # custom property verbatim. It is the one strategy where the code name is
                # not a reconstruction of anything.
                'codeName': name,
                'raw': raw,
                'value': resolved,
                'family': classify(name, resolved),
                'isAlias': raw != resolved,
                'selector': sel,
                'media': media or None,
                # A property on :root with no media query is the global token layer.
                # Anything scoped to a component selector is a local override.
                'layer': 'base' if (sel in (':root', 'html', ':host') and not media)
                         else 'component',
                'provenance': {'kind': 'config', 'ref': os.path.relpath(p, root)},
            })

    # Modes come from evidence: a name redeclared under different media queries scales.
    medias = sorted({r['media'] for r in rows if r['media']})
    scaling_names = {r['name'] for r in rows if r['media']} & \
                    {r['name'] for r in rows if not r['media']}
    modes = ['Value'] + medias if medias and scaling_names else ['Value']

    # Collapse to one row per name per mode, preferring the base layer.
    by_name = {}
    dupes = []
    for r in rows:
        key = r['name']
        prev = by_name.get(key)
        if prev is None:
            by_name[key] = dict(r, valuesByMode={r['media'] or 'Value': r['value']})
        else:
            prev['valuesByMode'].setdefault(r['media'] or 'Value', r['value'])
            if prev['layer'] != 'base' and r['layer'] == 'base':
                merged = prev['valuesByMode']
                by_name[key] = dict(r, valuesByMode=merged)
                merged[r['media'] or 'Value'] = r['value']
                dupes.append({k: prev[k] for k in ('name', 'value', 'layer', 'provenance')})
            else:
                dupes.append({k: r[k] for k in ('name', 'value', 'layer', 'provenance')})

    kept = sorted(by_name.values(), key=lambda t: (t['layer'] != 'base', t['family'], t['name']))
    fams = {}
    for t in kept:
        fams[t['family']] = fams.get(t['family'], 0) + 1

    type_names = {t['name'] for t in kept if t['family'] in ('font-size', 'line-height')}
    type_scales = bool(type_names & scaling_names)

    return {
        'generatedAt': datetime.datetime.now().replace(microsecond=0).isoformat(),
        'source': {'strategy': 'css-custom-properties', 'root': root,
                   'stylesheets': sorted(os.path.relpath(p, root) for p, _ in sheets),
                   'librariesFiles': sorted(os.path.relpath(p, root) for p in libs),
                   'ignoredNotLoaded': sorted(os.path.relpath(p, root) for p, _ in ignored)},
        'modes': modes,
        'modeRationale': (
            'custom properties are redeclared under %d media quer%s, so those are real modes'
            % (len(medias), 'y' if len(medias) == 1 else 'ies') if len(modes) > 1 else
            'every custom property is declared once at :root with no media-query or theme '
            'override, so a single mode is what the stylesheets support'),
        # Unlike a Sass source map, this source CAN answer the scaling question: a token that
        # scales must be redeclared under a media query, and that is directly observable.
        'typeScaling': {
            'observable': True,
            'noneScale': not type_scales,
            'reason': ('%d font-size/line-height token(s) are redeclared under a media query'
                       % len(type_names & scaling_names) if type_scales else
                       'no font-size or line-height custom property is redeclared under any '
                       'media query, so the token values themselves do not scale'),
            'roleLevelCaveat':
                'This measures the TOKENS. A component rule may still switch which token it '
                'uses at a breakpoint (`font-size: var(--text-2xl)` inside a media query), '
                'which is role-level scaling this source cannot see. Grep the consuming '
                'rules before concluding the type ramp is fixed.',
        },
        'totals': {'tokens': len(kept),
                   'base': sum(1 for t in kept if t['layer'] == 'base'),
                   'component': sum(1 for t in kept if t['layer'] == 'component'),
                   'shadowed': len(dupes), 'byFamily': fams},
        'tokens': kept,
        'shadowed': dupes,
        'problems': problems,
    }


if __name__ == '__main__':
    doc = extract(sys.argv[1] if len(sys.argv) > 1 else '.')
    print(json.dumps(doc, indent=2))
    s = doc['source']
    print('%d token(s) from %d loaded stylesheet(s); %d stylesheet(s) ignored as not loaded'
          % (doc['totals']['tokens'], len(s['stylesheets']), len(s['ignoredNotLoaded'])),
          file=sys.stderr)
    print('families: %s' % doc['totals']['byFamily'], file=sys.stderr)
