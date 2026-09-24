#!/usr/bin/env python3
"""Probe a repository and report which design-lab strategies apply.

Three independent axes: component source, token source, usage source.
Prints JSON. Never guesses a single winner when several are present -
a site can legitimately combine them.
"""
import json, os, re, sys, glob

SKIP = re.compile(r'/(node_modules|vendor|\.git|\.design-lab|contrib|core)/')
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

# Directories and files that mean "somebody has already done this work". references/
# prior-art.md is emphatic that skipping this produces a second, contradictory design
# system - but the probe lived only in the skill prose, so running detect.py directly
# skipped it entirely, and its `ls build/ analysis-reports/` never looked in `reports/`,
# which is where this project keeps every artifact it has.
PRIOR_ART_DIRS = ('build', 'reports', 'analysis-reports', 'docs', 'design', '.storybook')
PRIOR_ART_NAME = re.compile(r'(component[-_ ]?librar|design[-_ ]?system|figma|design[-_ ]?token)',
                            re.I)


def prior_art(root):
    """Existing Figma files, generated artifacts and pipelines, before any extraction.

    The active `.design-lab` workspace is deliberately excluded. `workflow init` creates it
    before detection, so treating its own empty `figma-batches` directory as prior art creates
    a false reconciliation task on every clean run.
    """
    hits = []
    for base in PRIOR_ART_DIRS:
        d = os.path.join(root, base)
        if not os.path.isdir(d):
            continue
        for dirpath, dirnames, filenames in os.walk(d):
            if dirpath[len(root):].count(os.sep) > 3:
                dirnames[:] = []
                continue
            for n in list(dirnames) + filenames:
                if PRIOR_ART_NAME.search(n):
                    hits.append({'path': os.path.relpath(os.path.join(dirpath, n), root),
                                 'kind': 'directory' if n in dirnames else 'file'})
    # Pipelines live in scripts/ and src/ as often as in the artifact directories.
    for dirpath, dirnames, filenames in os.walk(root):
        if SKIP.search(dirpath + os.sep) or dirpath[len(root):].count(os.sep) > 3:
            dirnames[:] = []
            continue
        for n in dirnames:
            if PRIOR_ART_NAME.search(n):
                hits.append({'path': os.path.relpath(os.path.join(dirpath, n), root),
                             'kind': 'directory'})
    seen, out = set(), []
    for h in sorted(hits, key=lambda h: h['path']):
        if h['path'] not in seen:
            seen.add(h['path'])
            out.append(h)
    return out[:40]


def detect(root):
    root = os.path.abspath(root)
    web = docroot(root)
    cfg = config_sync(root)
    out = {'root': root, 'docroot': web, 'configSync': cfg,
           'configCandidates': config_dirs(root),
           'componentSources': [], 'tokenSources': [], 'usageSources': [], 'notes': []}

    # Step zero, per references/prior-art.md - reported before any strategy, because the
    # code is authoritative on values but existing work is authoritative on organisation
    # and naming.
    out['priorArt'] = prior_art(root)
    if out['priorArt']:
        out['notes'].insert(0,
            'PRIOR ART: %d existing design-system artifact(s) found, starting with %s. '
            'Read references/prior-art.md and reconcile against them BEFORE extracting - '
            'the code is authoritative on values, existing work on organisation and naming.'
            % (len(out['priorArt']), ', '.join(h['path'] for h in out['priorArt'][:4])))

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
        blocks = glob.glob(os.path.join(cfg, 'block_content.type.*.yml'))
        if blocks and para:
            out['componentSources'].append({
                'strategy': 'drupal-authoring',
                'count': len(blocks) + len(para),
                'blocks': len(blocks),
                'paragraphs': len(para),
                'evidence': ('editor-facing block_content and paragraph bundle entities; '
                             'treat SDCs as their rendering layer')})
        if len(para) > 2:
            out['componentSources'].append(
                {'strategy': 'paragraphs', 'count': len(para), 'evidence': 'paragraphs_type config entities'})
        elif para:
            out['notes'].append(f'{len(para)} paragraph type(s) present - too few to treat as the component source')

    sdc = [f for f in _walk(web, '*.component.yml')]
    if sdc:
        bodies = []
        for path in sdc:
            try:
                with open(path, errors='ignore') as handle:
                    bodies.append(handle.read())
            except OSError:
                bodies.append('')
        enums = sum('enum:' in body for body in bodies)
        slots = sum(bool(re.search(r'^slots:', body, re.M)) for body in bodies)
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
    library_files = _walk(web, '*.libraries.yml')
    theme_libraries = [path for path in library_files
                       if re.search(r'/themes(?:/|$)', path.replace(os.sep, '/'))]
    loaded = set()
    for lib in theme_libraries or library_files:
        try:
            with open(lib, errors='ignore') as handle:
                body = handle.read()
        except OSError:
            continue
        for match in re.findall(r'^\s*([^\s:#][^:]*\.css)\s*:', body, re.M):
            if match.startswith(('http:', 'https:', '//')):
                continue
            loaded.add(os.path.normpath(os.path.join(os.path.dirname(lib),
                                                     match.strip().lstrip('/'))))
    css_vars, css_vars_loaded, css_values_loaded, unloaded = 0, 0, 0, []
    for f in [c for c in _walk(web, '*.css') if not GENERATED.search(c)][:400]:
        try:
            with open(f, errors='ignore') as handle:
                n = len(set(re.findall(r'(--[a-zA-Z0-9_-]+)\s*:', handle.read(60000))))
        except OSError:
            continue
        if not n:
            continue
        css_vars += 1
        if not loaded or os.path.normpath(f) in loaded:
            css_vars_loaded += 1
            css_values_loaded += n
        elif n >= 20:
            unloaded.append({'ref': os.path.relpath(f, root), 'customProperties': n})
    if css_vars:
        out['tokenSources'].append({'strategy': 'css-custom-properties',
                                    'filesWithVars': css_vars,
                                    'filesLoadedByTheme': css_vars_loaded,
                                    'variablesLoadedByTheme': css_values_loaded})
    if unloaded:
        out['notes'].append(
            'Ignoring %d stylesheet(s) with many custom properties that no *.libraries.yml '
            'loads - likely scaffolding, not the design system: %s'
            % (len(unloaded), ', '.join('%s (%d)' % (u['ref'], u['customProperties'])
                                        for u in unloaded[:3])))

    # Source Sass is configuration, too. Some repositories intentionally omit compiled
    # dist/ assets, so libraries.yml points at files that do not exist in a clean checkout.
    # In that case a one-token module stylesheet must not outrank the authored theme maps.
    sass_files, sass_values = 0, 0
    for f in _walk(web, '*.scss'):
        try:
            with open(f, errors='ignore') as handle:
                body = handle.read()
        except OSError:
            continue
        count = len(re.findall(r'^\s*\$[a-zA-Z0-9_-]+\s*:', body, re.M))
        if count:
            sass_files += 1
            sass_values += count
    if sass_values:
        out['tokenSources'].append({'strategy': 'sass-source', 'files': sass_files,
                                    'variables': sass_values,
                                    'evidence': 'source-authored Sass declarations'})

    if cfg:
        out['usageSources'].append({'strategy': 'drupal-db',
            'evidence': 'requires a running database; counts real placements'})

    # Authoring vocabularies outrank rendering primitives. Raw count is not a semantic
    # signal: ACU has 109 SDCs but its editors place 36 block types and 33 paragraph types.
    COMPONENT_RANK = {'drupal-authoring': 0, 'sitestudio': 1, 'paragraphs': 2, 'sdc': 3}
    comp = min(out['componentSources'],
               key=lambda c: (COMPONENT_RANK.get(c['strategy'], 9),
                              -c.get('count', 0)), default=None)
    # Source-authored Sass is the strongest available intent signal when it exists: it
    # carries palette, type, spacing, breakpoint, and shape families before compilation
    # flattens or re-scopes them. Loaded custom properties remain the best runtime fallback.
    def token_rank(source):
        strategy = source['strategy']
        if strategy == 'sitestudio-styles':
            return (0, 0)
        if strategy == 'sass-source':
            return (1, -source.get('variables', 0))
        if strategy == 'css-custom-properties' and source.get('variablesLoadedByTheme', 0) >= 20:
            return (2, -source.get('variablesLoadedByTheme', 0))
        if strategy == 'sass-sourcemap':
            return (3, -source.get('variables', 0))
        if strategy == 'tailwind':
            return (4, 0)
        if strategy == 'css-custom-properties':
            return (5, -source.get('variablesLoadedByTheme', 0))
        return (9, 0)
    tok = min(out['tokenSources'], key=token_rank, default=None)
    usage_rank = {'drupal-db': 0, 'storybook': 1}
    usage = min(out['usageSources'],
                key=lambda source: usage_rank.get(source['strategy'], 9), default=None)
    out['recommended'] = {
        'component': comp['strategy'] if comp else None,
        'token': tok['strategy'] if tok else None,
        'usage': usage['strategy'] if usage else None,
    }
    if len(out['componentSources']) > 1:
        listed = ', '.join('%s (%s)' % (c['strategy'], c.get('count', '?'))
                           for c in out['componentSources'])
        out['notes'].append(
            'Multiple component sources present - %s. Recommending %s because authoring '
            'vocabularies outrank rendering primitives; confirm only when repository '
            'evidence contradicts that relationship.'
            % (listed, out['recommended']['component']))
    return out

if __name__ == '__main__':
    print(json.dumps(detect(sys.argv[1] if len(sys.argv) > 1 else '.'), indent=2))
