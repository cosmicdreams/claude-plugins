#!/usr/bin/env python3
"""Check a built Figma library against the base expectations -> a pass/fail/waived report.

This exists because a library can be half-built and still look finished. The PNCB file had
four empty Foundations pages, 36 of 43 components missing, every component missing its
documentation link, and sixteen semantic variables whose Dev Mode code syntax named CSS
custom properties that exist nowhere in the codebase. Every individual skill reported
success. Nothing looked at the whole.

The rule this encodes: **an unmet expectation resolves to fixed or waived, never to
silence.** A waiver is a recorded human decision - who, when, why - so "we do not want
that" is a durable answer rather than something re-litigated every run.

    python3 verify.py --state state.json --components components.json \\
        [--tokens tokens.json] [--plan plan.json] [--index index.json] \\
        [--builds <dir>] [--brand PNCB] [--waivers waivers.json] \\
        [--theme-root <dir>] [--shots-dir <dir>] --out verify-report.json [--json]

`state.json` is the dump produced by the read script in `skills/verify/SKILL.md`.
The checks are defined by `references/library-standard.md` section 11.
Exit status is 1 while any expectation is unresolved, so this can gate a pipeline.
"""
import json, os, re, sys, argparse, glob, datetime

SEV = ('blocker', 'major', 'minor')
STANDARD_VERSION = '2.1.0'

# A description only resolves a blank code name if it addresses the blank. An unrelated note
# is not an explanation, however long it is.
EXPLAINS_BLANK = re.compile(
    r'no (css )?(custom propert|code name|equivalent|such propert)|not set here|'
    r'deliberately|no name (for|in) (this|the) (value|codebase)|stale', re.I)


class Report:
    def __init__(self):
        self.findings = []

    def add(self, check, severity, scope, detail, evidence=None):
        self.findings.append({'check': check, 'severity': severity, 'scope': scope,
                              'detail': detail, 'evidence': evidence})


# ------------------------------------------------------------------ codebase lookups

def theme_text(root):
    """Every stylesheet, template and script in the theme, concatenated once."""
    if not root or not os.path.isdir(root):
        return None
    out = []
    for dp, dn, fn in os.walk(root):
        if re.search(r'/(node_modules|vendor|\.git)/', dp + os.sep):
            dn[:] = []
            continue
        for f in fn:
            if f.endswith(('.css', '.scss', '.twig', '.js', '.yml')):
                try:
                    out.append(open(os.path.join(dp, f), errors='ignore').read())
                except OSError:
                    pass
    return '\n'.join(out)


# ------------------------------------------------------------------ the expectations

def check_foundation_before_components(state, rep):
    """A component built before its variables exist hardcodes what it should bind."""
    colls = state.get('collections') or []
    comps = state.get('components') or []
    if comps and not colls:
        rep.add('foundation-exists', 'blocker', 'file',
                '%d component(s) exist but the file has no variable collections at all. '
                'Every visual value in them is hardcoded.' % len(comps))


def check_variable_scopes(state, rep):
    """ALL_SCOPES puts a spacing token in the colour picker."""
    for c in state.get('collections') or []:
        for v in c.get('variables') or []:
            if 'ALL_SCOPES' in (v.get('scopes') or []):
                rep.add('variable-scoped', 'major', '%s::%s' % (c['name'], v['name']),
                        'scope is ALL_SCOPES, so this variable appears in every property picker')


def check_code_syntax_set(state, tokens, rep):
    """A variable with no code syntax shows a raw value in Dev Mode.

    An absent code name is not automatically wrong. Sometimes the codebase genuinely has no
    name for the value - a Figma font style is a string where CSS carries a numeric weight,
    a computed pixel line-height where the token is a unitless ratio. What separates a
    considered blank from an overlooked one is whether somebody wrote down why, so a
    variable whose description *addresses the absence* is treated as resolved in place.

    The description has to actually say why. Any-description-counts was the first version
    and it passed ten PNCB colours whose descriptions were unrelated notes left over from an
    earlier build - a false pass, which is the exact failure this check exists to prevent.
    """
    for c in state.get('collections') or []:
        vars_ = c.get('variables') or []
        blank = [v for v in vars_ if not v.get('web')]
        unexplained = [v['name'] for v in blank
                       if not EXPLAINS_BLANK.search(v.get('description') or '')]
        explained = len(blank) - len(unexplained)
        if unexplained:
            rep.add('code-syntax-set', 'major', 'collection:' + c['name'],
                    '%d of %d variables have no Web code syntax and no description saying '
                    'why; Dev Mode shows a bare value%s'
                    % (len(unexplained), len(vars_),
                       ' (%d more are blank but explained)' % explained if explained else ''),
                    evidence=unexplained[:12])


def has_build_output(root):
    """Whether the theme root contains compiled CSS, not just source.

    Bootstrap-style frameworks emit their custom properties at build time. Grepping a
    repository whose `dist/` is gitignored finds none of them, and every such variable is
    reported as dangling — a blocker-severity false positive. Measured on America's Credit
    Unions: `--bs-body-font-size` and `--bs-heading-color` resolve in the compiled
    `index.css` its own tokens.json cites, and that file is not committed.
    """
    if not root or not os.path.isdir(root):
        return False
    for dp, dn, fn in os.walk(root):
        if re.search(r'/(node_modules|vendor|\.git)/', dp + os.sep):
            dn[:] = []
            continue
        if re.search(r'/(dist|build|compiled)(/|$)', dp) and any(f.endswith('.css') for f in fn):
            return True
        if any(f.endswith(('.min.css', 'index.css')) for f in fn):
            return True
    return False


def check_code_syntax_resolves(state, theme, rep, built=True):
    """The check that matters most, and the one nothing was doing.

    A code syntax naming a custom property that does not exist is worse than none: a
    developer copies it out of Dev Mode, searches the codebase, and finds nothing. On PNCB
    this was true of all sixteen semantic variables.
    """
    if theme is None:
        rep.add('code-syntax-resolves', 'minor', 'file',
                'not checked - pass --theme-root to verify code syntax against the codebase')
        return
    for c in state.get('collections') or []:
        dangling = []
        for v in c.get('variables') or []:
            web = (v.get('web') or '').strip()
            if not web:
                continue
            m = re.search(r'--[A-Za-z0-9_-]+', web)
            if m:                                   # a CSS custom property
                name = m.group(0)
                if not re.search(re.escape(name) + r'(?![A-Za-z0-9_-])', theme):
                    dangling.append('%s -> %s' % (v['name'], name))
            elif web.startswith('$'):               # a Sass variable
                if not re.search(re.escape(web) + r'(?![A-Za-z0-9_-])', theme):
                    dangling.append('%s -> %s' % (v['name'], web))
            elif re.fullmatch(r'#[0-9a-fA-F]{3,8}', web):
                dangling.append('%s -> %s (a hex is the value repeated, not a code name)'
                                % (v['name'], web))
        if dangling:
            rep.add('code-syntax-resolves', 'blocker' if built else 'minor',
                    'collection:' + c['name'],
                    '%d code syntax value(s) name something that does not exist in the '
                    'codebase%s' % (len(dangling),
                        '' if built else ' — but this theme root has no compiled CSS, so a '
                        'framework-emitted property cannot be confirmed either way. Build '
                        'the theme and re-run before treating these as wrong.'),
                    evidence=dangling[:16])


def check_modes_earn_themselves(state, rep):
    """A collection with modes whose values never differ is three copies of one number."""
    for c in state.get('collections') or []:
        modes = c.get('modes') or []
        if len(modes) < 2:
            continue
        vars_ = c.get('variables') or []
        varying = [v['name'] for v in vars_
                   if len({json.dumps(x, sort_keys=True)
                           for x in (v.get('valuesByMode') or {}).values()}) > 1]
        if not varying:
            rep.add('modes-earn-themselves', 'major', 'collection:' + c['name'],
                    'has %d modes but not one variable differs between them' % len(modes))
        elif len(varying) < len(vars_) / 2:
            rep.add('modes-earn-themselves', 'minor', 'collection:' + c['name'],
                    'only %d of %d variables differ across %d modes; the rest are one value '
                    'wearing %d hats' % (len(varying), len(vars_), len(modes), len(modes)),
                    evidence=varying)


def built_keys(state):
    """Every identifier by which a component in the file can be recognised.

    One builder, used by both `components-built` and `completeness`. They used to disagree:
    completeness also matched on the human label, so a file whose components were named
    `Text Editor` rather than `text_editor — Text Editor` reported 100% built while
    `components-built` reported the same component missing. The headline coverage figure is
    the number put in front of a human, so it must never be the more generous of the two.
    """
    built = set()
    for c in state.get('components') or []:
        name = c.get('name') or ''
        # The raw name only. Never `_norm(name)`: normalisation strips the underscore, so
        # `Text Editor` and `text_editor` collapse to one string and a wrongly-named
        # component matches its own inventory entry — which is how completeness reported
        # 100% built on a file where nothing was named correctly.
        built.add(name)
        m = re.match(r'^([a-z0-9_]+)\s+—\s+', name)
        if m:
            built.update((m.group(1), _norm(m.group(1))))
        for d in (c.get('description') or '').splitlines():
            mm = re.match(r'\s*Machine name:\s*([a-z0-9_]+)', d)
            if mm:
                built.update((mm.group(1), _norm(mm.group(1))))
    return built


def component_keys(c):
    """The identifiers an inventory entry may legitimately be found under. Not the label."""
    keys = {c.get('id'), c.get('machineName')}
    if c.get('id'):
        keys.add(str(c['id']).split(':')[-1])
    keys.discard(None)
    return keys | {_norm(k) for k in keys}


def check_components_built(state, components, plan, rep):
    """Every component the plan said to build should be in the file."""
    want = set()
    entries = None
    if plan:
        # `plans` is the key plan.py actually writes; `components`/`plan` are read for the
        # hand-authored plans that predate it. Reading only the latter two silently emptied
        # `want` on every plugin-generated plan, and an empty `want` returns before adding a
        # finding — so passing --plan turned this blocker off. Measured on America's Credit
        # Unions: 0 of 69 components built, `components-built` reported PASS.
        entries = (plan.get('plans') or plan.get('components') or plan.get('plan') or [])
        for e in entries:
            # `verdict` is plan.py's field name; `decision`/`action` are the older ones.
            if (e.get('verdict') or e.get('decision') or e.get('action')) in (None, 'build'):
                want.add(e.get('id') or e.get('machineName'))
    elif components:
        want = {c['id'] for c in components.get('components') or []}
    want.discard(None)
    if not want:
        # A plan that parsed to nothing is a broken input, not a clean library. Falling
        # through to `return` here is what made the vacuous pass invisible.
        if plan and not entries:
            rep.add('components-built', 'blocker', 'file',
                    'the plan file carries no recognisable entries, so completeness could '
                    'not be checked at all; expected a `plans`, `components` or `plan` key',
                    evidence=sorted(plan.keys()))
        return
    built = built_keys(state)
    missing = sorted(w for w in want
                     if not ({w, str(w).split(':')[-1], _norm(w)} & built))
    if missing:
        rep.add('components-built', 'blocker', 'file',
                '%d of %d planned components are not in the file' % (len(missing), len(want)),
                evidence=missing[:20])


def completeness(state, components, plan):
    """Expected targets versus what is actually in the file, broken down by usage tier.

    Printed on every run, passing or failing. A library that is 11 of 44 built is not a
    library with one open finding; it is a quarter of a library, and the number belongs in
    front of whoever is about to sign it off.
    """
    comps = (components or {}).get('components') or []
    built = built_keys(state)
    tiers = {}
    for c in comps:
        t = ((c.get('usage') or {}).get('tier')) or 'untiered'
        ok = bool(component_keys(c) & built)
        tiers.setdefault(t, [0, 0, []])
        tiers[t][1] += 1
        if ok:
            tiers[t][0] += 1
        else:
            tiers[t][2].append(c['id'])
    total_built = sum(v[0] for v in tiers.values())
    return {'built': total_built, 'expected': len(comps), 'byTier': tiers}


def check_documentation_links(state, rep):
    missing = [c['name'] for c in state.get('components') or [] if not c.get('docLinks')]
    if missing:
        rep.add('documentation-links', 'blocker', 'file',
                '%d component(s) have no documentationLinks, so nothing in the Assets panel '
                'leads to their documentation' % len(missing), evidence=missing[:20])


def _norm(s):
    return re.sub(r'[^a-z0-9]+', '', str(s).lower())


def check_documentation_cards(state, components, rep):
    """Every component in the inventory needs a card, built or not.

    Match on the machine name AND the human label. A card is titled the way a designer
    reads it - "Frequently Asked Questions", never "faq" - so a machine-name-only match
    reports missing cards that are sitting right there.
    """
    cards = state.get('cards') or []
    # A card is named per references/findability.md: `<machine_name> — <Human Label> —
    # documentation`, and older cards are just `<Human Label> — documentation`. Index every
    # em-dash-separated part so either form matches.
    have = set()
    for c in cards:
        stem = re.sub(r'\s+—\s+documentation$', '', c.get('name', ''))
        have.add(_norm(stem))
        for part in re.split(r'\s+—\s+', stem):
            if part.strip():
                have.add(_norm(part))
    comps = (components or {}).get('components') or []
    if not comps:
        return
    missing = []
    for c in comps:
        keys = {_norm(c['id']), _norm(c.get('label') or ''),
                _norm(str(c['id']).replace('_', ' '))}
        if not (keys & have):
            missing.append(c['id'])
    if missing:
        rep.add('documentation-cards', 'major', 'file',
                '%d of %d components have no documentation card' % (len(missing), len(comps)),
                evidence=missing[:20])

    # Two cards with one name means one component is documented twice and another not at
    # all, and the Assets panel cannot tell them apart.
    seen, dupes = set(), set()
    for c in cards:
        n = c.get('name', '')
        if n in seen:
            dupes.add(n)
        seen.add(n)
    if dupes:
        rep.add('documentation-cards-unique', 'major', 'file',
                '%d card name(s) appear more than once' % len(dupes), evidence=sorted(dupes))


def check_pages_populated(state, rep):
    # `children` absent means the page was never made current, so its size is unknown. Figma
    # reports 0 children for an unloaded page regardless of what it holds, and treating that
    # as empty fired this check on nearly every page of every file. Unmeasured is not zero.
    pages = state.get('pages') or []
    unmeasured = [p['name'] for p in pages if p.get('children') is None]
    if unmeasured:
        rep.add('pages-populated', 'minor', 'file',
                '%d page(s) were never loaded, so whether they are empty is unknown. Make '
                'each page current before counting its children.' % len(unmeasured),
                evidence=unmeasured[:20])
    empty = [p['name'] for p in pages if p.get('children') == 0]
    if empty:
        rep.add('pages-populated', 'major', 'file',
                '%d page(s) are empty. An empty page in a published library reads as a '
                'section that exists and has nothing in it.' % len(empty), evidence=empty)


def check_breakpoint_frames(state, rep):
    """shot: must hold an image; a card's breakpoints must share one scale."""
    frames = state.get('breakpointFrames') or []
    fake = [f['name'] for f in frames
            if f['name'].startswith('shot:') and not f.get('hasImage')]
    if fake:
        rep.add('shot-frames-have-images', 'major', 'file',
                '%d frame(s) named shot: hold no image, so they claim a capture they do not '
                'have' % len(fake), evidence=fake[:20])

    by_comp = {}
    for f in frames:
        parts = f['name'].split(':')
        if len(parts) == 3:
            by_comp.setdefault(parts[1], []).append(f)
    for comp, fs in by_comp.items():
        ratios = [f['width'] / f['labelWidth'] for f in fs
                  if f.get('labelWidth') and f.get('width')]
        if len(ratios) < 2:
            continue
        # Frame widths are whole pixels, so one shared scale still yields ratios that
        # differ in the third decimal. Compare the spread, not exact equality: anything
        # inside 5% is rounding, anything outside it is a second scale.
        spread = max(ratios) / min(ratios)
        if spread > 1.05:
            rep.add('breakpoints-share-scale', 'major', 'component:' + comp,
                    'breakpoint frames differ in scale by %.0f%%, so their widths cannot be '
                    'compared' % ((spread - 1) * 100),
                    evidence=[round(r, 3) for r in sorted(ratios)])


def check_captures_unique(shots_dir, rep):
    """Two components with the same picture means a selector matched the same element."""
    if not shots_dir or not os.path.isdir(shots_dir):
        return
    import hashlib
    by_hash = {}
    for p in glob.glob(os.path.join(shots_dir, '*.png')):
        h = hashlib.md5(open(p, 'rb').read()).hexdigest()
        by_hash.setdefault(h, []).append(os.path.basename(p))
    for h, files in by_hash.items():
        if len(files) < 2:
            continue
        stems = {f.split('__')[0] for f in files}
        if len(stems) > 1:
            rep.add('captures-unique', 'major', 'capture:' + ','.join(sorted(stems)),
                    'these components produced byte-identical captures, so their root '
                    'selectors resolve to the same element', evidence=sorted(files))


# ---------------------------------------------------- library-standard.md v1 additions

COMPONENT_NAME = re.compile(r'^[a-z0-9_]+\s+—\s+\S')
# Figma's own placeholders, bare or numbered. A layer still carrying one was never named,
# and Find searches layer names, so it is invisible to the file's own index.
DEFAULT_LAYER = re.compile(
    r'^(Frame|Group|Rectangle|Ellipse|Text|Vector|Line|Polygon|Star|Component|Slice)'
    r'(\s+\d+)?$')
DEFAULT_MODE = re.compile(r'^(Mode\s*\d*|Default|Value \d+)$', re.I)
# A divider page is typographic furniture: unnavigable, noise in Find, lost on rename.
DIVIDER_PAGE = re.compile(r'^[\s—\-=_·•]+[A-Z\s]*[\s—\-=_·•]+$')
SCRATCH_PAGE = re.compile(
    r'internal only|scratch|draft|wip|work in progress|sandbox|test|temp|'
    r'components\s*—\s*built|untitled', re.I)
# Domains that mean the same thing. Two collections for one domain split the concept across
# two pickers and guarantee the wrong one gets bound.
DOMAIN_ALIASES = {'typography': 'type', 'colour': 'color', 'colors': 'color',
                  'spacings': 'spacing', 'radii': 'radius', 'shadow': 'elevation',
                  'shadows': 'elevation', 'motions': 'motion'}


def check_component_naming(state, rep):
    """`machine_name — Human Label`, because two audiences search two different words."""
    bad = [c['name'] for c in state.get('components') or []
           if not COMPONENT_NAME.match(c['name'] or '')]
    if bad:
        rep.add('component-naming', 'blocker', 'file',
                '%d component(s) are not named `machine_name — Human Label`. A machine-name-'
                'only name matches nothing a designer types; a label-only name matches '
                'nothing a developer traces.' % len(bad), evidence=bad[:20])


def check_component_description(state, rep):
    """The description is the Assets panel's search payload, so an empty one is unfindable.

    Checked for the three elements that can be recognised without reading English: the
    machine name, a source path, and a usage figure. A description missing all three is not
    a payload, whatever else it says.
    """
    thin = []
    for c in state.get('components') or []:
        d = c.get('description') or ''
        if not d.strip():
            thin.append('%s (empty)' % c['name'])
            continue
        missing = []
        if not re.search(r'machine name\s*:', d, re.I):
            missing.append('machine name')
        if not re.search(r'\b[\w./-]+\.(yml|yaml|json|twig|php|jsx?|tsx?|s?css)\b', d):
            missing.append('source path')
        if not re.search(r'\d', d):
            missing.append('usage figure')
        if missing:
            thin.append('%s (no %s)' % (c['name'], ', '.join(missing)))
    if thin:
        rep.add('component-description', 'blocker', 'file',
                '%d component description(s) do not carry the searchable payload from '
                'library-standard.md section 4.2' % len(thin), evidence=thin[:20])


def check_documentation_adjacent(state, rep):
    """A card on another page means every question costs a page change, and the two drift."""
    card_page = {}
    for c in state.get('cards') or []:
        stem = re.sub(r'\s+—\s+documentation$', '', c.get('name', ''))
        for part in re.split(r'\s+—\s+', stem):
            if part.strip():
                card_page.setdefault(_norm(part), c.get('pageId'))
    apart = []
    for c in state.get('components') or []:
        m = re.match(r'^([a-z0-9_]+)\s+—\s+(.*)$', c.get('name') or '')
        keys = [_norm(m.group(1)), _norm(m.group(2))] if m else [_norm(c.get('name') or '')]
        for k in keys:
            if k in card_page and card_page[k] and c.get('pageId') \
                    and card_page[k] != c['pageId']:
                apart.append(c['name'])
                break
    if apart:
        rep.add('documentation-adjacent', 'blocker', 'file',
                '%d component(s) have their documentation card on a different page. '
                'Segregating cards from components is how the two drift apart.' % len(apart),
                evidence=apart[:20])


def check_layers_named(state, rep):
    """Find searches layer names, so a layer named `Frame` is invisible to the file itself."""
    offenders = []
    for c in state.get('cards') or []:
        n = c.get('defaultNamedLayers')
        if n:
            offenders.append('%s (%d)' % (c.get('name', '?'), n))
    if offenders:
        rep.add('layers-named', 'blocker', 'file',
                '%d card(s) contain layers still carrying a Figma default name such as '
                '`Frame`' % len(offenders), evidence=offenders[:20])


def check_mode_naming(state, rep):
    """`Mode 1` means nobody named the mode; the reader cannot tell what it holds."""
    bad = []
    for c in state.get('collections') or []:
        for m in c.get('modes') or []:
            name = m if isinstance(m, str) else (m.get('name') or '')
            if DEFAULT_MODE.match(name.strip()):
                bad.append('%s::%s' % (c['name'], name))
    if bad:
        rep.add('mode-naming', 'blocker', 'file',
                '%d mode(s) still carry a Figma placeholder name. A mode name states what '
                'the mode holds — `Desktop 1440px`, not `Mode 1`.' % len(bad),
                evidence=bad[:20])


def check_no_scratch_pages(state, rep):
    """Working surfaces and typographic dividers do not ship."""
    bad = []
    for p in state.get('pages') or []:
        n = (p.get('name') or '').strip()
        if DIVIDER_PAGE.match(n) or SCRATCH_PAGE.search(n):
            bad.append(n)
    if bad:
        rep.add('no-scratch-pages', 'blocker', 'file',
                '%d page(s) are working surfaces or typographic dividers' % len(bad),
                evidence=bad)


def check_collection_naming(state, brand, rep):
    """Unprefixed collections collide the moment a file subscribes to a second library."""
    colls = state.get('collections') or []
    if brand:
        unprefixed = [c['name'] for c in colls
                      if not _norm(c['name']).startswith(_norm(brand))]
        if unprefixed:
            rep.add('collection-naming', 'major', 'file',
                    '%d collection(s) are not prefixed `%s <Domain>`, so they collide with '
                    'every other library in the picker' % (len(unprefixed), brand),
                    evidence=unprefixed)
    domains = {}
    for c in colls:
        # The whole remaining phrase, not its last word. Keying on the last word made
        # `PNCB Letter Spacing` collide with `PNCB Spacing`, which are two real domains.
        phrase = re.sub(r'^%s\s*' % re.escape(brand or ''), '', c['name'], flags=re.I).strip()
        key = _norm(phrase) or _norm(c['name'])
        domains.setdefault(DOMAIN_ALIASES.get(key, key), []).append(c['name'])
    dupes = {d: names for d, names in domains.items() if len(names) > 1}
    if dupes:
        rep.add('collection-naming', 'major', 'file',
                '%d domain(s) are split across more than one collection, so the same concept '
                'lives in two pickers' % len(dupes),
                evidence=['%s: %s' % (d, ', '.join(n)) for d, n in sorted(dupes.items())])


def check_fields_are_tables(state, rep):
    """Glyphs standing in for structure cannot be scanned, restyled, or aligned."""
    faked = [c.get('name', '?') for c in state.get('cards') or []
             if c.get('hasFields') and not c.get('hasFieldsTable')]
    if faked:
        rep.add('fields-are-tables', 'major', 'file',
                '%d card(s) render their field list as preformatted text rather than a '
                'table' % len(faked), evidence=faked[:20])


def check_two_usage_numbers(components, rep):
    """One number marks load-bearing components as dead and deletes working sliders."""
    comps = (components or {}).get('components') or []
    withusage = [c for c in comps if c.get('usage')]
    if not withusage:
        return
    collapsed = [c['id'] for c in withusage
                 if all((c['usage'] or {}).get(k) is None
                        for k in ('structuralRefs', 'structuralReferences'))]
    if collapsed:
        rep.add('two-usage-numbers', 'major', 'file',
                '%d of %d components record placements but no structuralReferences. '
                'Collapsed into one number, a component with zero placements and dozens of '
                'structural references reads as dead.' % (len(collapsed), len(withusage)),
                evidence=collapsed[:20])


def check_tier_thresholds_stated(index, state, rep):
    """An unexplained threshold cannot be compared against another library."""
    if not index:
        return
    th = index.get('thresholds') or {}
    if th.get('default', True):
        return
    text = (state.get('gettingStarted') or {}).get('thresholdsText') or ''
    if not re.search(r'\b%d\b' % th.get('high', -1), text) or \
            not re.search(r'because|reason|since|so that|distribution', text, re.I):
        rep.add('tier-thresholds-stated', 'major', 'file',
                'tier thresholds are overridden (High >= %s, Medium >= %s) but Getting '
                'Started does not state them together with the reason'
                % (th.get('high'), th.get('medium')))


def check_known_gaps_current(state, open_findings, rep):
    """Known gaps that predates the findings tells the reader the library is cleaner."""
    gs = state.get('gettingStarted') or {}
    text = gs.get('knownGapsText')
    if text is None:
        rep.add('known-gaps-current', 'major', 'file',
                'the Getting Started page has no Known gaps section, so nothing in the file '
                'tells a reader what is unresolved')
        return
    unlisted = sorted({f['check'] for f in open_findings
                       if f['check'] not in ('known-gaps-current',)
                       and f['check'] not in text})
    if unlisted:
        rep.add('known-gaps-current', 'major', 'file',
                '%d open finding(s) are not named in Known gaps, so the page understates '
                'what is unresolved' % len(unlisted), evidence=unlisted[:20])


def check_standard_version_stamped(components, tokens, builds_dir, rep):
    """Without a stamp, nobody can tell which edition a library was built to."""
    missing = []
    for name, doc in (('components.json', components), ('tokens.json', tokens)):
        if doc is not None and not doc.get('standardVersion'):
            missing.append(name)
    if builds_dir and os.path.isdir(builds_dir):
        unstamped = []
        for p in sorted(glob.glob(os.path.join(builds_dir, '*.json'))):
            try:
                if not (json.load(open(p)) or {}).get('standardVersion'):
                    unstamped.append(os.path.basename(p))
            except (ValueError, IOError):
                unstamped.append(os.path.basename(p) + ' (unreadable)')
        if unstamped:
            missing.append('%d build record(s): %s' % (len(unstamped),
                                                       ', '.join(unstamped[:6])))
    if missing:
        rep.add('standard-version-stamped', 'blocker', 'file',
                'no standardVersion recorded in %s' % '; '.join(missing))


def check_index_complete(index, components, state, rep):
    """The summative page has to cover everything discovered, or it is not summative.

    Two ways it can be wrong and only one of them is visible on screen: the generated index
    can omit a component, or the page rendered into Figma can be stale relative to the index
    it was generated from. Both are checked, because a reader trusts the page, not the JSON.
    """
    comps = (components or {}).get('components') or []
    if not comps:
        return
    if not index:
        rep.add('index-complete', 'minor', 'file',
                'not checked - pass --index (index_rows.py output) to confirm the Getting '
                'Started index covers every component')
        return
    rows = index.get('rows') or []
    listed = {r.get('id') for r in rows}
    missing = sorted(c['id'] for c in comps if c['id'] not in listed)
    if missing:
        rep.add('index-complete', 'blocker', 'file',
                '%d of %d components have no row in the index, so the one page that claims to '
                'list the library does not' % (len(missing), len(comps)), evidence=missing[:20])
    rendered = (state.get('gettingStarted') or {}).get('indexRowCount')
    if rendered is None:
        rep.add('index-complete', 'minor', 'file',
                'the rendered index was not counted, so the page in Figma could be stale '
                'against index_rows.py and nothing would say so')
    elif rendered != len(rows):
        rep.add('index-complete', 'blocker', 'file',
                'the Getting Started page renders %d index rows but the inventory produces '
                '%d. The page is stale - re-run design-lab:figma-index.'
                % (rendered, len(rows)))


def check_index_links_resolve(index, rep):
    """A built component the index cannot jump to is a component nobody finds."""
    if not index:
        return
    rows = index.get('rows') or []
    if not rows:
        return
    broken = [r['machineName'] for r in rows if r.get('built') and not r.get('linkTarget')]
    if broken:
        rep.add('index-links-resolve', 'blocker', 'file',
                '%d built component(s) have an index row with nothing to link to. Record '
                'figma.documentationCardId in the build record.' % len(broken),
                evidence=broken[:20])


def check_variants_are_sets(state, plan, rep):
    """Eight loose components side by side are not a variant set.

    Figma only offers the variant picker, and only lets you compare states against each
    other, when the variants are combined into a COMPONENT_SET. Loose siblings look almost
    identical on the canvas and behave nothing alike on an instance, which is why this is
    worth checking rather than assuming `combineAsVariants` did its job.
    """
    comps = state.get('components') or []
    if not comps:
        return
    types = {c['name']: c.get('type') for c in comps}
    if not any(t for t in types.values()):
        rep.add('variants-are-sets', 'minor', 'file',
                'not checked - the state dump recorded no node type, so a loose component '
                'cannot be told from a component set')
        return
    want = {}
    for e in ((plan or {}).get('plans') or (plan or {}).get('components') or []):
        n = e.get('variants')
        if n and n > 1:
            want[e.get('id') or e.get('machineName')] = n
    loose = []
    for c in comps:
        if c.get('type') == 'COMPONENT_SET':
            continue
        stem = (c.get('name') or '').split(' — ')[0]
        if stem in want:
            loose.append('%s: plan says %d variants, the file has a loose COMPONENT'
                         % (stem, want[stem]))
    # Without a plan, fall back to the shape the mistake actually takes on the canvas:
    # several loose components sharing one machine-name stem.
    if not want:
        stems = {}
        for c in comps:
            if c.get('type') == 'COMPONENT_SET':
                continue
            stems.setdefault((c.get('name') or '').split(' — ')[0], []).append(c['name'])
        loose = ['%s: %d loose components share this machine name and are not combined into '
                 'a set' % (s, len(names)) for s, names in sorted(stems.items())
                 if len(names) > 1]
    if loose:
        rep.add('variants-are-sets', 'blocker', 'file',
                '%d component(s) have variants that were never combined into a COMPONENT_SET, '
                'so Figma offers no variant picker and no comparison' % len(loose),
                evidence=loose[:20])


def check_bindings_match_source(state, measurements, rep):
    """Figma must bind exactly where the code binds — no more, no less.

    Not "is it maximally bound". A component that binds a variable the source hardcodes is a
    different component from the one on the site: the defect a designer was best placed to
    notice has been erased, and the next sync compares two things that were never the same.
    See references/library-standard.md section 1.

    Compared at the component level, not the node level. Mapping a CSS node path onto a Figma
    node identifier is a real problem this does not pretend to solve, so the claim made here
    is deliberately weaker than per-property: it catches a component the source tokenises and
    Figma hardcodes, or the reverse, and says nothing about which node.
    """
    if not measurements:
        rep.add('bindings-match-source', 'minor', 'file',
                'not checked - pass --measurements (design-lab:capture output) so the '
                "source's declared values can be compared against the Figma bindings")
        return
    comps = {c['name']: c for c in state.get('components') or []}
    if not comps:
        return
    mismatched = []
    for mid, m in (measurements or {}).items():
        nodes = m.get('nodes') or []
        src_binds = any('var(--' in str(v)
                        for n in nodes for v in (n.get('declared') or {}).values())
        fig = next((c for name, c in comps.items()
                    if name.split(' — ')[0] == mid or name == mid), None)
        if fig is None:
            continue
        fig_binds = bool(fig.get('boundVariableCount'))
        if src_binds and not fig_binds:
            mismatched.append('%s: source resolves through custom properties, the Figma '
                              'component binds nothing' % mid)
        elif fig_binds and not src_binds:
            mismatched.append('%s: the Figma component binds variables, the source hardcodes '
                              'every value - the defect has been tidied away' % mid)
    if mismatched:
        rep.add('bindings-match-source', 'blocker', 'file',
                '%d component(s) do not mirror the source\'s binding state' % len(mismatched),
                evidence=mismatched[:20])


def check_verify_report_exists(out_path, rep):
    """A verify run that keeps no receipt cannot be cited, diffed, or trusted later."""
    if not out_path:
        rep.add('verify-report-exists', 'blocker', 'file',
                'this run was not given --out, so it leaves no verify report. A library that '
                'has never produced one is not a finished library.')


CHECKS = """foundation-exists variable-scoped code-syntax-set code-syntax-resolves
modes-earn-themselves components-built component-naming component-description
documentation-links documentation-cards documentation-cards-unique documentation-adjacent
layers-named mode-naming no-scratch-pages collection-naming fields-are-tables
two-usage-numbers tier-thresholds-stated known-gaps-current standard-version-stamped
verify-report-exists bindings-match-source index-complete index-links-resolve
variants-are-sets pages-populated shot-frames-have-images breakpoints-share-scale
captures-unique""".split()


# ------------------------------------------------------------------ waivers

def load_waivers(path):
    if not path or not os.path.exists(path):
        return []
    return (json.load(open(path)) or {}).get('waivers') or []


def waived(f, waivers):
    for w in waivers:
        if w.get('check') != f['check']:
            continue
        sc = w.get('scope')
        if sc in (None, '*', f['scope']):
            return w
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--state', required=True)
    ap.add_argument('--components')
    ap.add_argument('--tokens')
    ap.add_argument('--plan')
    ap.add_argument('--waivers')
    ap.add_argument('--theme-root')
    ap.add_argument('--shots-dir')
    ap.add_argument('--index', help='output of index_rows.py')
    ap.add_argument('--builds', help='directory of build records')
    ap.add_argument('--brand', help='collection name prefix, e.g. PNCB')
    ap.add_argument('--measurements', help='design-lab:capture measurement JSON, keyed by '
                                           'component; supplies the declared values')
    ap.add_argument('--out', help='write the verify report here; required by '
                                  'verify-report-exists')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()

    state = json.load(open(a.state))
    components = json.load(open(a.components)) if a.components else None
    tokens = json.load(open(a.tokens)) if a.tokens else None
    plan = json.load(open(a.plan)) if a.plan else None
    index = json.load(open(a.index)) if a.index else None
    measurements = json.load(open(a.measurements)) if a.measurements else None
    waivers = load_waivers(a.waivers)
    theme = theme_text(a.theme_root)

    rep = Report()
    check_foundation_before_components(state, rep)
    check_variable_scopes(state, rep)
    check_code_syntax_set(state, tokens, rep)
    check_code_syntax_resolves(state, theme, rep, has_build_output(a.theme_root))
    check_modes_earn_themselves(state, rep)
    check_components_built(state, components, plan, rep)
    check_component_naming(state, rep)
    check_component_description(state, rep)
    check_documentation_links(state, rep)
    check_documentation_cards(state, components, rep)
    check_documentation_adjacent(state, rep)
    check_layers_named(state, rep)
    check_mode_naming(state, rep)
    check_no_scratch_pages(state, rep)
    check_collection_naming(state, a.brand, rep)
    check_fields_are_tables(state, rep)
    check_two_usage_numbers(components, rep)
    check_tier_thresholds_stated(index, state, rep)
    check_standard_version_stamped(components, tokens, a.builds, rep)
    check_index_complete(index, components, state, rep)
    check_index_links_resolve(index, rep)
    check_variants_are_sets(state, plan, rep)
    check_bindings_match_source(state, measurements, rep)
    check_verify_report_exists(a.out, rep)
    check_pages_populated(state, rep)
    check_breakpoint_frames(state, rep)
    check_captures_unique(a.shots_dir, rep)
    # Last: it compares Known gaps against everything the run has already found.
    check_known_gaps_current(state, list(rep.findings), rep)

    open_, waived_ = [], []
    for f in rep.findings:
        w = waived(f, waivers)
        (waived_ if w else open_).append(dict(f, waiver=w) if w else f)

    # A check with nothing to examine did not pass — it did not run. Reporting it as a pass
    # is the same error as reporting an unrun check as passing, and it is worse here: a file
    # with zero components scored 17 of 26 passing on America's Credit Unions, because five
    # component checks and three card checks had no subject to fail on.
    subjects = {'component': len(state.get('components') or []),
                'card': len(state.get('cards') or []),
                'shot': len(state.get('breakpointFrames') or []),
                'collection': len(state.get('collections') or [])}
    NEEDS = {'component-naming': 'component', 'component-description': 'component',
             'documentation-links': 'component', 'documentation-adjacent': 'component',
             'layers-named': 'card', 'fields-are-tables': 'card',
             'documentation-cards-unique': 'card',
             'shot-frames-have-images': 'shot', 'breakpoints-share-scale': 'shot',
             'variable-scoped': 'collection', 'code-syntax-set': 'collection',
             'modes-earn-themselves': 'collection', 'mode-naming': 'collection',
             'collection-naming': 'collection',
             'variants-are-sets': 'component', 'bindings-match-source': 'component'}
    inapplicable = sorted(c for c, need in NEEDS.items()
                          if not subjects[need]
                          and not any(f['check'] == c for f in rep.findings))
    passed = [c for c in CHECKS
              if c not in inapplicable and not any(f['check'] == c for f in rep.findings)]
    cover = completeness(state, components, plan)
    report = {'standardVersion': STANDARD_VERSION,
              'generatedAt': datetime.datetime.now(datetime.timezone.utc)
                                     .replace(microsecond=0).isoformat().replace('+00:00', 'Z'),
              'open': open_, 'waived': waived_, 'passed': passed,
              'inapplicable': inapplicable, 'completeness': cover}

    if a.out:
        # The receipt. Known gaps on Getting Started is regenerated from this file, so it is
        # written whether the run passed or failed.
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, 'w') as fh:
            json.dump(report, fh, indent=2)

    if a.json:
        print(json.dumps(report, indent=2))
    else:
        pct = (100.0 * cover['built'] / cover['expected']) if cover['expected'] else 0
        print('COMPLETENESS  %d of %d components built (%.0f%%)'
              % (cover['built'], cover['expected'], pct))
        for tier, (ok, tot, miss) in sorted(cover['byTier'].items()):
            print('    %-14s %2d of %2d%s' % (tier, ok, tot,
                  '   missing: ' + ', '.join(miss[:6]) + ('…' if len(miss) > 6 else '')
                  if miss else ''))
        print()
        for c in passed:
            print('PASS   %s' % c)
        for c in inapplicable:
            print('N/A    %s — nothing in the file for this check to examine' % c)
        for f in waived_:
            print('WAIVED %s [%s] — %s' % (f['check'], f['scope'],
                                           (f['waiver'] or {}).get('reason', '')))
        for f in sorted(open_, key=lambda x: SEV.index(x['severity'])):
            print('FAIL   %s [%s] %s\n         %s' % (f['check'], f['severity'], f['scope'],
                                                      f['detail']))
            if f.get('evidence'):
                print('         evidence: %s' % ', '.join(map(str, f['evidence']))[:400])
        print('\n%d passed, %d not applicable, %d waived, %d open'
              % (len(passed), len(inapplicable), len(waived_), len(open_)))
        if open_:
            print('\nEvery open item must end as a fix or a recorded waiver. Ask the user '
                  'before waiving; a waiver is their decision, not yours.')
        if cover['expected'] and cover['built'] < cover['expected']:
            print('\nCOMPLETENESS IS NOT SELF-RESOLVING. %d component(s) are absent. Put the '
                  'number above in front of a human and get an explicit answer before calling '
                  'this library done — partial coverage is the one defect that looks like '
                  'success from the outside.' % (cover['expected'] - cover['built']))
    return 1 if open_ else 0


if __name__ == '__main__':
    sys.exit(main())
