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
import json, os, re, sys, glob, datetime

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
        'generatedAt': datetime.datetime.now().replace(microsecond=0).isoformat(),
        'source': {'strategy': 'sass-sourcemap', 'root': root,
                   'maps': [os.path.relpath(m, root) for m in maps]},
        'totals': {'tokens': len(kept), 'base': sum(1 for t in kept if t['layer'] == 'base'),
                   'component': sum(1 for t in kept if t['layer'] == 'component'),
                   'shadowed': len(dupes), 'byFamily': fams},
        'tokens': kept,
        'shadowed': dupes,
        'sourcesWithVariables': sorted(sources_seen, key=lambda s: -s['variables']),
        'problems': problems,
    }


if __name__ == '__main__':
    print(json.dumps(extract(sys.argv[1] if len(sys.argv) > 1 else '.'), indent=2))
