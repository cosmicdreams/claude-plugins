#!/usr/bin/env python3
"""Probe a repository and report which design-lab strategies apply.

Three independent axes: component source, token source, usage source.
Prints JSON. Never guesses a single winner when several are present -
a site can legitimately combine them.
"""
import json, os, re, sys, glob

SKIP = re.compile(r'/(node_modules|vendor|\.git|contrib|core)/')
# Drupal's public files directory holds aggregated CSS the optimiser generated. It is
# compiled output, not source, and scanning it reports Drupal's own aggregates as if
# they were the client's design tokens.
GENERATED = re.compile(r'/sites/[^/]+/files/')

def _walk(root, filename_glob, skip_contrib=True):
    hits = []
    for dirpath, dirnames, filenames in os.walk(root):
        if skip_contrib and SKIP.search(dirpath + '/'):
            dirnames[:] = []
            continue
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            if glob.fnmatch.fnmatch(fn, filename_glob):
                hits.append(full)
    return hits

def docroot(root):
    """Drupal web root varies: Acquia uses docroot/, most others web/."""
    for cand in ('docroot', 'web', ''):
        p = os.path.join(root, cand) if cand else root
        if os.path.isdir(os.path.join(p, 'modules')) or os.path.isdir(os.path.join(p, 'themes')):
            return p
    return root

def config_dirs(root):
    """Every candidate Drupal configuration directory, with how much config each holds.

    Existence is not evidence. Some builds ship a scaffolded but empty config/sync
    beside the directory that actually carries configuration - PNCB has an empty
    config/sync and keeps 1,087 config entities in config/default. Returning the first
    directory that merely exists misfiles the whole site: every paragraphs_type lookup
    comes back empty and the detector falls through to whatever else it can find.
    """
    out = []
    for cand in ('config/sync', 'config/default', 'config'):
        p = os.path.join(root, cand)
        if os.path.isdir(p):
            out.append({'path': p, 'entityCount': len(glob.glob(os.path.join(p, '*.yml')))})
    return out


def config_sync(root):
    """The configuration directory that actually holds configuration, or None."""
    cands = config_dirs(root)
    if not cands:
        return None
    best = max(cands, key=lambda c: c['entityCount'])
    return best['path'] if best['entityCount'] else cands[0]['path']

def detect(root):
    root = os.path.abspath(root)
    web = docroot(root)
    cfg = config_sync(root)
    out = {'root': root, 'docroot': web, 'configSync': cfg,
           'configCandidates': config_dirs(root),
           'componentSources': [], 'tokenSources': [], 'usageSources': [], 'notes': []}

    empty = [c['path'] for c in out['configCandidates'] if not c['entityCount']]
    if empty and cfg:
        out['notes'].append(
            'Empty configuration director%s ignored: %s. Using %s.'
            % ('ies' if len(empty) > 1 else 'y', ', '.join(empty), cfg))

    if cfg:
        ss = glob.glob(os.path.join(cfg, 'cohesion_elements.cohesion_component.*.yml'))
        if ss:
            out['componentSources'].append(
                {'strategy': 'sitestudio', 'count': len(ss), 'evidence': 'cohesion_component config entities'})
        cs = glob.glob(os.path.join(cfg, 'cohesion_custom_styles.cohesion_custom_style.*.yml'))
        if cs:
            out['tokenSources'].append(
                {'strategy': 'sitestudio-styles', 'count': len(cs), 'evidence': 'cohesion_custom_style config entities'})
        para = glob.glob(os.path.join(cfg, 'paragraphs.paragraphs_type.*.yml'))
        if len(para) > 2:
            out['componentSources'].append(
                {'strategy': 'paragraphs', 'count': len(para), 'evidence': 'paragraphs_type config entities'})
        elif para:
            out['notes'].append(f'{len(para)} paragraph type(s) present - too few to treat as the component source')

    sdc = [f for f in _walk(web, '*.component.yml')]
    if sdc:
        enums = sum(1 for f in sdc if 'enum:' in open(f, errors='ignore').read())
        slots = sum(1 for f in sdc if re.search(r'^slots:', open(f, errors='ignore').read(), re.M))
        out['componentSources'].append({'strategy': 'sdc', 'count': len(sdc),
            'evidence': 'Single Directory Component definitions',
            'withEnumProps': enums, 'withSlots': slots})

    stories = _walk(web, '*.stories.*')
    if stories:
        out['notes'].append(f'{len(stories)} Storybook stor(ies) found - usable as a usage signal')
        out['usageSources'].append({'strategy': 'storybook', 'count': len(stories)})

    for name in ('tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs'):
        for f in _walk(root, name):
            out['tokenSources'].append({'strategy': 'tailwind', 'evidence': os.path.relpath(f, root)})
            break

    # Sass source maps. A theme that ships only compiled CSS still carries its original
    # $variables when sourcesContent is present - configuration-grade provenance that
    # beats both custom properties and measurement.
    maps = []
    for f in [c for c in _walk(web, '*.css.map') if not GENERATED.search(c)]:
        try:
            data = json.load(open(f, errors='ignore'))
        except (OSError, ValueError):
            continue
        contents = data.get('sourcesContent') or []
        sass_vars = sum(len(re.findall(r'^\s*\$[a-zA-Z0-9_-]+\s*:', c or '', re.M))
                        for c in contents)
        if sass_vars:
            maps.append({'ref': os.path.relpath(f, root), 'variables': sass_vars,
                         'sources': len(data.get('sources') or [])})
    if maps:
        out['tokenSources'].append({
            'strategy': 'sass-sourcemap',
            'variables': sum(m['variables'] for m in maps), 'maps': maps})

    # Custom properties are only tokens if the theme actually loads the stylesheet. The
    # biggest pile in a repository is regularly scaffolding from an unrelated experiment.
    loaded = set()
    for lib in _walk(web, '*.libraries.yml'):
        try:
            body = open(lib, errors='ignore').read()
        except OSError:
            continue
        loaded.update(os.path.basename(m) for m in re.findall(r'([\w./-]+\.css):', body))
    css_vars, css_vars_loaded, unloaded = 0, 0, []
    for f in [c for c in _walk(web, '*.css') if not GENERATED.search(c)][:400]:
        try:
            n = len(set(re.findall(r'(--[a-zA-Z0-9_-]+)\s*:', open(f, errors='ignore').read(60000))))
        except OSError:
            continue
        if not n:
            continue
        css_vars += 1
        if not loaded or os.path.basename(f) in loaded:
            css_vars_loaded += 1
        elif n >= 20:
            unloaded.append({'ref': os.path.relpath(f, root), 'customProperties': n})
    if css_vars:
        out['tokenSources'].append({'strategy': 'css-custom-properties',
                                    'filesWithVars': css_vars,
                                    'filesLoadedByTheme': css_vars_loaded})
    if unloaded:
        out['notes'].append(
            'Ignoring %d stylesheet(s) with many custom properties that no *.libraries.yml '
            'loads - likely scaffolding, not the design system: %s'
            % (len(unloaded), ', '.join('%s (%d)' % (u['ref'], u['customProperties'])
                                        for u in unloaded[:3])))

    if cfg:
        out['usageSources'].append({'strategy': 'drupal-db',
            'evidence': 'requires a running database; counts real placements'})

    # Rank by how many components the source actually contributes, not by the order the
    # probes happen to run in. A site with 43 paragraph types and 13 Single Directory
    # Components has its authoring vocabulary in the paragraph types; the Single Directory
    # Components are the rendering primitives those paragraph templates call.
    comp = max(out['componentSources'], key=lambda c: c.get('count', 0), default=None)
    # Configuration beats measurement (references/model.md), so rank explicitly rather
    # than trusting probe order: config entities, then recovered Sass, then a declarative
    # scale, and custom properties last because they are the easiest to mis-attribute.
    TOKEN_RANK = {'sitestudio-styles': 0, 'sass-sourcemap': 1, 'tailwind': 2,
                  'css-custom-properties': 3}
    tok = min(out['tokenSources'],
              key=lambda t: TOKEN_RANK.get(t['strategy'], 9), default=None)
    out['recommended'] = {
        'component': comp['strategy'] if comp else None,
        'token': tok['strategy'] if tok else None,
    }
    if len(out['componentSources']) > 1:
        listed = ', '.join('%s (%s)' % (c['strategy'], c.get('count', '?'))
                           for c in out['componentSources'])
        out['notes'].append(
            'Multiple component sources present - %s. Recommending %s on count alone; '
            'confirm which one authors actually place before extracting.'
            % (listed, out['recommended']['component']))
    return out

if __name__ == '__main__':
    print(json.dumps(detect(sys.argv[1] if len(sys.argv) > 1 else '.'), indent=2))
