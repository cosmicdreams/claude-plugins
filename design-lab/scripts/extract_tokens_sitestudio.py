#!/usr/bin/env python3
"""Site Studio custom styles -> tokens.json.

Reads cohesion_custom_styles.cohesion_custom_style.*.yml. Each entity carries a human
label, the generated class name, and a JSON payload holding per-breakpoint values at
`styles.styles.<breakpoint>.<property>`.

Configuration beats measurement for tokens, and this is why: one entity gives every
breakpoint of a value at once, and it names the palette entry. A single rendered instance
conflates sources - on AHRI a text component rendered 40px horizontal padding that looked
like its padding field but was actually its colour scheme applying padding-equal.

`class_name` is the token's identity in the codebase, so it becomes `codeName` and, through
that, the Figma variable's code syntax. See references/tokens-and-variables.md.

    python3 extract_tokens_sitestudio.py <repo-root> > tokens.json
"""
import json, re, sys, os, glob, datetime

# Site Studio breakpoint keys, widest first. Values cascade DOWNWARD: a breakpoint with no
# declaration inherits the next larger one, so a token declared only at xl applies at every
# size. Reading them as independent produces holes that look like missing tokens.
BREAKPOINTS = ['xxl', 'xl', 'lg', 'md', 'sm', 'xs']

COLOR_PROPS = {'color', 'background-color', 'border-color', 'fill'}
SPACE_PROPS = {'padding', 'margin', 'padding-top', 'padding-bottom', 'padding-left',
               'padding-right', 'margin-top', 'margin-bottom', 'margin-left',
               'margin-right', 'gap', 'row-gap', 'column-gap'}
TYPE_PROPS = {'font-size', 'line-height', 'font-family', 'font-weight', 'letter-spacing',
              'text-transform', 'font-style'}


def load_json_values(path):
    """The payload is a JSON string in a single-quoted YAML scalar, so doubled single
    quotes must be unescaped before parsing. Same trick as extract_sitestudio.py."""
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


def flatten(value):
    """Site Studio wraps values inconsistently: {"value":"24px"} but also
    {"value":{"rgba":"rgba(255,255,255,1)"}} for colours and nested groups for shorthand
    properties. Return a plain scalar or None."""
    if isinstance(value, dict):
        if 'rgba' in value:
            return value['rgba']
        if 'value' in value:
            return flatten(value['value'])
        if 'hex' in value:
            return value['hex']
        return None
    if isinstance(value, (str, int, float)):
        return value
    return None


def rgba_to_hex(v):
    m = re.match(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', str(v))
    if not m:
        return None
    return '#%02X%02X%02X' % tuple(int(g) for g in m.groups())


def walk_props(node, prefix=''):
    """Yield (property-name, scalar-value) from a breakpoint's style tree."""
    if not isinstance(node, dict):
        return
    for k, v in node.items():
        name = ('%s-%s' % (prefix, k)) if prefix else k
        flat = flatten(v)
        if flat is not None and not isinstance(flat, dict):
            yield name, flat
        elif isinstance(v, dict):
            yield from walk_props(v, name)


def cascade(per_bp, order):
    """Fill each breakpoint from the next larger one that declared a value."""
    out, last = {}, None
    for bp in order:
        if bp in per_bp:
            last = per_bp[bp]
        out[bp] = last
    return out


def extract(root):
    cfg = None
    for cand in ('config/sync', 'config/default', 'config'):
        p = os.path.join(root, cand)
        if os.path.isdir(p) and glob.glob(os.path.join(p, 'cohesion_custom_styles.*.yml')):
            cfg = p
            break
    if not cfg:
        print('no cohesion_custom_styles.* found under %s' % root, file=sys.stderr)
        sys.exit(2)

    files = sorted(glob.glob(os.path.join(cfg, 'cohesion_custom_styles.cohesion_custom_style.*.yml')))
    colors, spacing, type_, schemes, unclassified = [], [], [], [], []

    # First pass: which breakpoints does this site declare at all? This has to finish
    # before any entity is converted. Accumulating it during the main loop made the
    # breakpoint list depend on file order, so entities parsed early got a short list and
    # their values appeared not to cascade.
    seen_bps = set()
    parsed = []
    for f in files:
        jv, txt = load_json_values(f)
        if jv:
            seen_bps.update(((jv.get('styles') or {}).get('styles') or {}).keys())
        parsed.append((f, jv, txt))
    order = [b for b in BREAKPOINTS if b in seen_bps] or ['xl']

    for f, jv, txt in parsed:
        jv, txt = load_json_values(f)
        label = scalar(txt, 'label')
        klass = scalar(txt, 'class_name')
        sid = scalar(txt, 'id')
        parent = scalar(txt, 'parent')
        stype = scalar(txt, 'custom_style_type')
        if not jv or not label:
            continue
        styles = (jv.get('styles') or {}).get('styles') or {}

        # property -> {breakpoint: value}
        collected = {}
        for bp, tree in styles.items():
            for prop, val in walk_props(tree):
                collected.setdefault(prop, {})[bp] = val
        if not collected:
            continue

        prov = {'kind': 'config', 'ref': os.path.basename(f), 'id': sid}
        base = {'name': label, 'codeName': klass, 'parent': parent,
                'styleType': stype, 'provenance': prov}

        for prop, per_bp in collected.items():
            root_prop = prop.split('-')[-1] if prop.count('-') > 2 else prop
            filled = cascade(per_bp, order)
            values = [filled[b] for b in order]
            entry = dict(base, property=prop, valuesByBreakpoint=dict(zip(order, values)))

            if prop in COLOR_PROPS or root_prop in COLOR_PROPS:
                hexes = [rgba_to_hex(v) for v in values if v]
                entry['hex'] = next((h for h in hexes if h), None)
                if entry['hex']:
                    colors.append(entry)
                else:
                    unclassified.append(entry)
            elif prop in SPACE_PROPS or prop.split('-')[0] in ('padding', 'margin'):
                spacing.append(entry)
            elif prop in TYPE_PROPS or root_prop in TYPE_PROPS:
                type_.append(entry)
            else:
                unclassified.append(entry)

        if stype == 'generic' and klass and 'color-scheme' in (klass or ''):
            schemes.append(dict(base, properties=sorted(collected)))

    # Whether type scales is a PER-ROLE fact and must not be generalised. The AHRI pilot
    # measured body text (20/32 at every breakpoint), concluded "type does not scale", and
    # built a single-mode type collection. 13 of 43 AHRI font-size tokens do scale -
    # Heading 2 runs 48/48/42/36 - so that collection is under-specified and headings are
    # wrong at tablet and mobile. Report both numbers and let the planner decide.
    sizes = [t for t in type_ if t['property'] == 'font-size']
    scaling = [t for t in sizes
               if len(set(str(v) for v in t['valuesByBreakpoint'].values())) > 1]

    return {
        'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': {'strategy': 'sitestudio-styles', 'root': os.path.abspath(root),
                   'configDir': cfg, 'entities': len(files)},
        'modes': order,
        'typeScaling': {'fontSizeTokens': len(sizes), 'scaling': len(scaling),
                        'scalingNames': sorted(t['name'] for t in scaling),
                        'allScale': bool(sizes) and len(scaling) == len(sizes),
                        'noneScale': not scaling},
        'colors': colors, 'spacing': spacing, 'type': type_,
        'schemes': schemes, 'unclassified': unclassified,
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        sys.exit(2)
    d = extract(sys.argv[1])
    print(json.dumps(d, indent=2))
    print('%d entities -> %d colour, %d spacing, %d type, %d unclassified; modes %s; '
          'font-size scaling: %d of %d' % (d['source']['entities'], len(d['colors']),
                               len(d['spacing']), len(d['type']), len(d['unclassified']),
                               ','.join(d['modes']), d['typeScaling']['scaling'],
                               d['typeScaling']['fontSizeTokens']),
          file=sys.stderr)
