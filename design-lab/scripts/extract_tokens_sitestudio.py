#!/usr/bin/env python3
"""Site Studio -> tokens.json.

Reads FOUR config entity families, and the order matters more than anything else here:

  cohesion_website_settings.cohesion_color.*          the actual colour palette
  cohesion_website_settings.cohesion_font_stack.*     font families, with $coh-font-* resolved
  cohesion_website_settings.cohesion_scss_variable.*  the spacer scale
  cohesion_custom_styles.cohesion_custom_style.*      component-scoped styles

An earlier version of this extractor read ONLY custom styles, and the result was unusable:
Schusterman's 172 custom style entities collapsed to 11 distinct hexes with component-scoped
names like "Card fake link with icon", because a custom style says how one component looks,
not what the palette is. The palette is 43 named colours in cohesion_color - "Brand color",
"Bright Teal" - each carrying its own Sass variable and an inuse flag. Same mistake made the
font families unrecoverable: they read as raw `$coh-font-headline`, which
cohesion_font_stack resolves to "Greta Sans", Helvetica Neue, Helvetica, Arial, sans-serif.

So: website settings are the design system. Custom styles are a component layer on top, and
are emitted separately rather than mixed into the palette.

    python3 extract_tokens_sitestudio.py <repo-root> > tokens.json
"""
import json, re, sys, os, glob, datetime

BREAKPOINTS = ['xxl', 'xl', 'lg', 'md', 'sm', 'xs']
COLOR_PROPS = {'color', 'background-color', 'border-color', 'fill'}
SPACE_PROPS = {'padding', 'margin', 'gap', 'row-gap', 'column-gap'}
TYPE_PROPS = {'font-size', 'line-height', 'font-family', 'font-weight', 'letter-spacing'}


def load_json_values(path):
    """Payload is a JSON string in a single-quoted YAML scalar; doubled quotes unescape."""
    txt = open(path, errors='ignore').read()
    m = re.search(r"^json_values: '(.*?)'\n[a-z_]+:", txt, re.S | re.M)
    if not m:
        return None, txt
    try:
        return json.loads(m.group(1).replace("''", "'")), txt
    except json.JSONDecodeError:
        return None, txt


def scalar(txt, key):
    m = re.search(r'^%s: (.+)$' % re.escape(key), txt, re.M)
    return m.group(1).strip().strip("'\"") if m else None


def config_dir(root):
    best, best_n = None, -1
    for cand in ('config/sync', 'config/default', 'config'):
        p = os.path.join(root, cand)
        if os.path.isdir(p):
            n = len(glob.glob(os.path.join(p, '*.yml')))
            if n > best_n:
                best, best_n = p, n
    return best


def flatten(v):
    if isinstance(v, dict):
        for k in ('rgba', 'hex', 'value'):
            if k in v:
                return flatten(v[k])
        return None
    return v if isinstance(v, (str, int, float)) else None


def rgba_to_hex(v):
    m = re.match(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', str(v))
    return '#%02X%02X%02X' % tuple(int(g) for g in m.groups()) if m else None


def walk_props(node, prefix=''):
    if not isinstance(node, dict):
        return
    for k, v in node.items():
        name = ('%s-%s' % (prefix, k)) if prefix else k
        f = flatten(v)
        if f is not None and not isinstance(f, dict):
            yield name, f
        elif isinstance(v, dict):
            yield from walk_props(v, name)


def cascade(per_bp, order):
    out, last = {}, None
    for bp in order:
        if bp in per_bp:
            last = per_bp[bp]
        out[bp] = last
    return out


def palette(cfg):
    """cohesion_color -> the real colour tokens."""
    out = []
    for f in sorted(glob.glob(os.path.join(cfg, 'cohesion_website_settings.cohesion_color.*.yml'))):
        jv, txt = load_json_values(f)
        if not jv:
            continue
        hexv = flatten((jv.get('value') or {}).get('value') or {})
        hexv = hexv if isinstance(hexv, str) and hexv.startswith('#') else \
            rgba_to_hex(flatten(jv.get('value')))
        out.append({
            'name': jv.get('name') or scalar(txt, 'label'),
            'uid': jv.get('uid'),
            'hex': (hexv or '').upper() or None,
            # The Sass variable IS the code identity on a Site Studio site.
            'codeName': jv.get('variable'),
            'className': jv.get('class'),
            'tags': [t.get('value') for t in (jv.get('tags') or []) if isinstance(t, dict)],
            'inUse': bool(jv.get('inuse')),
            'provenance': {'kind': 'config', 'ref': os.path.basename(f)},
        })
    return out


def font_stacks(cfg):
    out = []
    for f in sorted(glob.glob(os.path.join(cfg, 'cohesion_website_settings.cohesion_font_stack.*.yml'))):
        jv, txt = load_json_values(f)
        if not jv:
            continue
        out.append({
            'name': jv.get('name') or scalar(txt, 'label'),
            'uid': jv.get('uid'),
            'stack': jv.get('fontStack'),
            # First family in the stack is what Figma can actually apply.
            'primaryFamily': (jv.get('fontStack') or '').split(',')[0].strip().strip('"\''),
            'codeName': jv.get('variable'),
            'systemFont': bool(jv.get('systemfont')),
            'inUse': bool(jv.get('inuse')),
            'provenance': {'kind': 'config', 'ref': os.path.basename(f)},
        })
    return out


def scss_variables(cfg):
    out = []
    for f in sorted(glob.glob(os.path.join(cfg, 'cohesion_website_settings.cohesion_scss_variable.*.yml'))):
        jv, txt = load_json_values(f)
        if not jv:
            continue
        out.append({
            'name': jv.get('name') or jv.get('uid') or scalar(txt, 'id'),
            'uid': jv.get('uid') or scalar(txt, 'id'),
            'value': flatten(jv.get('value')),
            'codeName': '$%s' % (jv.get('uid') or scalar(txt, 'id') or ''),
            'inUse': bool(jv.get('inuse')),
            'provenance': {'kind': 'config', 'ref': os.path.basename(f)},
        })
    return out


def custom_styles(cfg):
    """The component layer. Kept separate from the palette on purpose."""
    files = sorted(glob.glob(os.path.join(cfg, 'cohesion_custom_styles.cohesion_custom_style.*.yml')))
    parsed, seen = [], set()
    for f in files:
        jv, txt = load_json_values(f)
        if jv:
            seen.update(((jv.get('styles') or {}).get('styles') or {}).keys())
        parsed.append((f, jv, txt))
    order = [b for b in BREAKPOINTS if b in seen] or ['xl']

    rows = []
    for f, jv, txt in parsed:
        if not jv:
            continue
        label, klass = scalar(txt, 'label'), scalar(txt, 'class_name')
        styles = (jv.get('styles') or {}).get('styles') or {}
        collected = {}
        for bp, tree in styles.items():
            for prop, val in walk_props(tree):
                collected.setdefault(prop, {})[bp] = val
        for prop, per_bp in collected.items():
            root_prop = prop.split('-')[-1] if prop.count('-') > 2 else prop
            fam = ('color' if prop in COLOR_PROPS or root_prop in COLOR_PROPS else
                   'spacing' if prop.split('-')[0] in ('padding', 'margin') or prop in SPACE_PROPS else
                   'type' if prop in TYPE_PROPS or root_prop in TYPE_PROPS else 'other')
            rows.append({'name': label, 'codeName': klass, 'property': prop, 'family': fam,
                         'valuesByBreakpoint': cascade(per_bp, order),
                         'provenance': {'kind': 'config', 'ref': os.path.basename(f)}})
    return order, rows, len(files)


def extract(root):
    cfg = config_dir(root)
    if not cfg:
        sys.exit('no configuration directory under %s' % root)
    cols = palette(cfg)
    fonts = font_stacks(cfg)
    scss = scss_variables(cfg)
    order, styles, n_styles = custom_styles(cfg)

    sizes = [s for s in styles if s['property'] == 'font-size']
    scaling = [s for s in sizes
               if len({str(v) for v in s['valuesByBreakpoint'].values()}) > 1]

    return {
        'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': {'strategy': 'sitestudio-website-settings', 'root': os.path.abspath(root),
                   'configDir': cfg,
                   'entities': {'colors': len(cols), 'fontStacks': len(fonts),
                                'scssVariables': len(scss), 'customStyles': n_styles}},
        'modes': order,
        'colors': cols,
        'fontStacks': fonts,
        'scssVariables': scss,
        'customStyles': styles,
        'typeScaling': {'fontSizeTokens': len(sizes), 'scaling': len(scaling),
                        'noneScale': not scaling},
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('usage: extract_tokens_sitestudio.py <repo-root>')
    d = extract(sys.argv[1])
    print(json.dumps(d, indent=2))
    e = d['source']['entities']
    print('palette %d colours (%d in use), %d font stacks, %d scss variables, '
          '%d custom styles; modes %s; font-size scaling %d of %d'
          % (e['colors'], sum(1 for c in d['colors'] if c['inUse']), e['fontStacks'],
             e['scssVariables'], e['customStyles'], ','.join(d['modes']),
             d['typeScaling']['scaling'], d['typeScaling']['fontSizeTokens']),
          file=sys.stderr)
