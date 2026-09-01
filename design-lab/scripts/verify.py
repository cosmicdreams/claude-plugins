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
        [--tokens tokens.json] [--plan plan.json] [--waivers waivers.json] \\
        [--theme-root <dir>] [--json]

`state.json` is the dump produced by the read script in `skills/verify/SKILL.md`.
Exit status is 1 while any expectation is unresolved, so this can gate a pipeline.
"""
import json, os, re, sys, argparse, glob

SEV = ('blocker', 'major', 'minor')

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


def check_code_syntax_resolves(state, theme, rep):
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
            rep.add('code-syntax-resolves', 'blocker', 'collection:' + c['name'],
                    '%d code syntax value(s) name something that does not exist in the '
                    'codebase' % len(dangling), evidence=dangling[:16])


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


def check_components_built(state, components, plan, rep):
    """Every component the plan said to build should be in the file."""
    want = set()
    if plan:
        for e in (plan.get('components') or plan.get('plan') or []):
            if (e.get('decision') or e.get('action')) in (None, 'build'):
                want.add(e.get('id') or e.get('machineName'))
    elif components:
        want = {c['id'] for c in components.get('components') or []}
    want.discard(None)
    if not want:
        return
    built = set()
    for c in state.get('components') or []:
        built.add(c['name'])
        m = re.match(r'^([a-z0-9_]+)\s+—\s+', c['name'])
        if m:
            built.add(m.group(1))
        for d in (c.get('description') or '').splitlines():
            mm = re.match(r'\s*Machine name:\s*([a-z0-9_]+)', d)
            if mm:
                built.add(mm.group(1))
    missing = sorted(want - built)
    if missing:
        rep.add('components-built', 'blocker', 'file',
                '%d of %d planned components are not in the file' % (len(missing), len(want)),
                evidence=missing[:20])


def check_documentation_links(state, rep):
    missing = [c['name'] for c in state.get('components') or [] if not c.get('docLinks')]
    if missing:
        rep.add('documentation-links', 'major', 'file',
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
    empty = [p['name'] for p in state.get('pages') or [] if not p.get('children')]
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


CHECKS = """foundation-exists variable-scoped code-syntax-set code-syntax-resolves
modes-earn-themselves components-built documentation-links documentation-cards documentation-cards-unique
pages-populated shot-frames-have-images breakpoints-share-scale captures-unique""".split()


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
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()

    state = json.load(open(a.state))
    components = json.load(open(a.components)) if a.components else None
    tokens = json.load(open(a.tokens)) if a.tokens else None
    plan = json.load(open(a.plan)) if a.plan else None
    waivers = load_waivers(a.waivers)
    theme = theme_text(a.theme_root)

    rep = Report()
    check_foundation_before_components(state, rep)
    check_variable_scopes(state, rep)
    check_code_syntax_set(state, tokens, rep)
    check_code_syntax_resolves(state, theme, rep)
    check_modes_earn_themselves(state, rep)
    check_components_built(state, components, plan, rep)
    check_documentation_links(state, rep)
    check_documentation_cards(state, components, rep)
    check_pages_populated(state, rep)
    check_breakpoint_frames(state, rep)
    check_captures_unique(a.shots_dir, rep)

    open_, waived_ = [], []
    for f in rep.findings:
        w = waived(f, waivers)
        (waived_ if w else open_).append(dict(f, waiver=w) if w else f)

    passed = [c for c in CHECKS if not any(f['check'] == c for f in rep.findings)]

    if a.json:
        print(json.dumps({'open': open_, 'waived': waived_, 'passed': passed}, indent=2))
    else:
        for c in passed:
            print('PASS   %s' % c)
        for f in waived_:
            print('WAIVED %s [%s] — %s' % (f['check'], f['scope'],
                                           (f['waiver'] or {}).get('reason', '')))
        for f in sorted(open_, key=lambda x: SEV.index(x['severity'])):
            print('FAIL   %s [%s] %s\n         %s' % (f['check'], f['severity'], f['scope'],
                                                      f['detail']))
            if f.get('evidence'):
                print('         evidence: %s' % ', '.join(map(str, f['evidence']))[:400])
        print('\n%d passed, %d waived, %d open' % (len(passed), len(waived_), len(open_)))
        if open_:
            print('\nEvery open item must end as a fix or a recorded waiver. Ask the user '
                  'before waiving; a waiver is their decision, not yours.')
    return 1 if open_ else 0


if __name__ == '__main__':
    sys.exit(main())
