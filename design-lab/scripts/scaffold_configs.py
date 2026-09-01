#!/usr/bin/env python3
"""components.json -> component capture configs, and an honest list of what needs a human.

The configs are the hand-work in this pipeline, and on PNCB the four components with no
config were four components with no measurements and no screenshots — including `table_row`
at 116 placements, the third most placed component on the site. Nothing reported that gap
until `design-lab:verify` counted.

This writes a stub per component and tells you which stubs are guesses. It does not pretend
to finish the job: a `url` cannot be derived from configuration at all, and a root selector
is only derivable when the component renders through Drupal's default paragraph wrapper.

    python3 scaffold_configs.py components.json --out components/ \\
        [--theme-root docroot/themes/custom/<theme>] [--force]

Read the `needsHuman` list it prints. Every entry there is a component that will silently
produce no capture.
"""
import json, os, re, sys, argparse, glob

# Drupal's clean_class turns underscores into hyphens.
clean = lambda m: m.replace('_', '-')


def template_selector(theme_root, machine):
    """Best-effort root selector read from the component's own Twig template.

    `.paragraph--type--NAME` only works for components routed through
    `paragraph--component.html.twig`; the generic `paragraph.html.twig` never prints
    `{{ attributes }}`, so a component with its own template emits no bundle class at all.
    On PNCB that is true of most of them, which is why this reads the template rather than
    assuming the class.
    """
    if not theme_root or not os.path.isdir(theme_root):
        return None, None
    pats = [f'templates/**/paragraph--{clean(machine)}.html.twig',
            f'templates/**/paragraph--component--{clean(machine)}.html.twig',
            f'templates/**/{clean(machine)}.html.twig']
    for pat in pats:
        for path in glob.glob(os.path.join(theme_root, pat), recursive=True):
            try:
                body = open(path, errors='ignore').read()
            except OSError:
                continue
            if '{{ attributes' in body or '{{attributes' in body:
                return '.paragraph--type--%s' % clean(machine), 'attributes printed'
            # The ROOT element only. Taking the first class anywhere in the file picks an
            # inner node: PNCB's table_row template opens with a classless <tr> and the
            # first class in the file is `.c-table__text`, a cell two levels down.
            block = body
            mb = re.search(r'{%\s*block\s+content\s*%}(.*?){%\s*endblock', body, re.S)
            if mb:
                block = mb.group(1)
            mroot = re.search(r'<(\w+)([^>]*)>', block)
            if mroot:
                attrs = mroot.group(2)
                mc = re.search(r'\bclass\s*=\s*"([^"{}]+)"', attrs)
                if mc:
                    return '.' + mc.group(1).split()[0], ('root class in %s'
                                                          % os.path.basename(path))
                # A classless root is a real answer and a useful one: it means no selector
                # can be derived and a structural one has to be written by hand.
                return None, ('root <%s> in %s carries no class; needs a structural selector'
                              % (mroot.group(1), os.path.basename(path)))
            m = re.search(r"{%\s*embed\s+'([\w.-]+):([\w-]+)'", body)
            if m:
                return '.c-%s' % m.group(2), 'single directory component embed'
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('components')
    ap.add_argument('--out', default='components')
    ap.add_argument('--theme-root')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()

    doc = json.load(open(a.components))
    os.makedirs(a.out, exist_ok=True)

    written, skipped, needs_human = [], [], []
    for c in doc.get('components') or []:
        machine = c['id']
        path = os.path.join(a.out, '%s.json' % machine)
        if os.path.exists(path) and not a.force:
            skipped.append(machine)
            continue

        sel, why = template_selector(a.theme_root, machine)
        cfg = {
            'component': c.get('label') or machine,
            'machineName': machine,
            'source': {'paragraphType': machine, 'sourceRef': c.get('sourceRef')},
            # Not derivable: which page renders this component is a content fact, not a
            # configuration one. design-lab:usage finds real addresses; otherwise fill it in.
            'url': None,
            'rootSelector': sel,
            'states': [{'name': 'default'}],
        }
        gaps = []
        if not cfg['url']:
            gaps.append('url')
        if not sel:
            gaps.append('rootSelector')
            cfg['rootSelector'] = '.paragraph--type--%s' % clean(machine)
            cfg['_selectorIsAGuess'] = ('The default paragraph wrapper. Verify it: a '
                                        'component with its own template usually emits no '
                                        'bundle class.')
        elif why:
            cfg['_selectorFrom'] = why
        if sel is None and why:
            cfg['_selectorNote'] = why
        with open(path, 'w') as f:
            json.dump(cfg, f, indent=2)
        written.append(machine)
        if gaps:
            needs_human.append({'machine': machine, 'missing': gaps,
                                'placements': (c.get('usage') or {}).get('placements')})

    print('wrote %d config(s), skipped %d that already existed' % (len(written), len(skipped)))
    if needs_human:
        needs_human.sort(key=lambda x: -(x['placements'] or 0))
        print('\n%d config(s) will produce NOTHING until a human fills them in:'
              % len(needs_human))
        for n in needs_human:
            p = '' if n['placements'] is None else ' (%s placements)' % n['placements']
            print('   %-34s missing: %s%s' % (n['machine'], ', '.join(n['missing']), p))
        print('\nA missing url means no capture and no measurement, silently. Run '
              'design-lab:usage first if you want real addresses rather than guessed ones.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
