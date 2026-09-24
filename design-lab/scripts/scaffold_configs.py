#!/usr/bin/env python3
"""components.json -> component capture configs, and an honest list of what needs a human.

The configs are the hand-work in this pipeline, and on PNCB the four components with no
config were four components with no measurements and no screenshots — including `table_row`
at 116 placements, the third most placed component on the site. Nothing reported that gap
until `design-lab:verify` counted.

This writes a stub per component and tells you which stubs are guesses. A local site URL
and an observed usage path provide the verification URL for browser capture.

    python3 scaffold_configs.py components.json --out components/ \\
        [--theme-root docroot/themes/custom/<theme>] [--site-url https://site.ddev.site] [--force]

Read the `needsHuman` list it prints. Every entry there is a component that will silently
produce no capture.
"""
import json, os, re, sys, argparse, glob
from urllib.parse import urljoin

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


def sdc_selector(theme_root, machine):
    """Read the root class from a Single Directory Component Twig template."""
    if not theme_root or not os.path.isdir(theme_root):
        return None, None
    paths = glob.glob(os.path.join(theme_root, 'components', '**', machine + '.twig'),
                      recursive=True)
    for path in paths:
        with open(path, errors='ignore') as handle:
            body = handle.read()
        # Macro markup is not the component root; it only renders when called.
        body = re.sub(r'{%\s*macro\b.*?{%\s*endmacro\s*%}', '', body, flags=re.S)
        root = re.search(r'<[a-zA-Z][^>]*>', body)
        if not root:
            continue
        tag = root.group(0)
        match = re.search(r'\bclass\s*=\s*["\']([^"\']+)', tag)
        if not match:
            match = re.search(r'\baddClass\(\s*["\']([^"\']+)', tag)
        if match:
            return '.' + match.group(1).split()[0], 'root class in ' + os.path.basename(path)
    return None, None


def first_example(usage):
    """Use the first non-empty example source, preserving its recorded order."""
    for key in ('examples', 'renderedExamples', 'exampleCandidates'):
        for item in usage.get(key) or []:
            if isinstance(item, str):
                path = item
            elif isinstance(item, dict):
                path = item.get('path')
            else:
                path = None
            if path:
                return item if isinstance(item, dict) else {'path': path}
    return None


def component_selector(component_id, source_strategy):
    if source_strategy in ('sdc', 'canvas') and component_id.startswith('sdc.'):
        parts = component_id.split('.', 2)
        if len(parts) == 3 and parts[1] and parts[2]:
            return '[data-component-id="%s:%s"]' % (parts[1], parts[2])
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('components')
    ap.add_argument('--out', default='components')
    ap.add_argument('--theme-root')
    ap.add_argument('--canonical-base-url', required=True,
                    help='public base URL used for clickable documentation links')
    ap.add_argument('--site-url', help='local site base URL used for browser verification')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()

    with open(a.components, encoding='utf-8') as handle:
        doc = json.load(handle)
    strategy = (doc.get('source') or {}).get('strategy')
    sdc_source = strategy in ('sdc', 'canvas')
    os.makedirs(a.out, exist_ok=True)

    written, skipped, needs_human = [], [], []
    for c in sorted(doc.get('components') or [], key=lambda item: item['id']):
        component_id = c['id']
        machine = c.get('machineName') or component_id.split(':')[-1]
        path = os.path.join(a.out, '%s.json' % component_id.replace(':', '__').replace('/', '__'))
        if os.path.exists(path) and not a.force:
            skipped.append(machine)
            continue

        example = first_example(c.get('usage') or {})
        marker = (example or {}).get('marker')
        marker_kind = (example or {}).get('markerKind')
        sel = component_selector(component_id, strategy)
        why = 'Drupal SDC component id' if sel else None
        if not sel:
            sel = ('.' + marker if marker and marker_kind == 'class' else
                   '#' + marker if marker and marker_kind == 'id' else None)
            why = 'unique rendered usage marker' if sel else None
        if not sel:
            sel, why = (sdc_selector(a.theme_root, machine) if sdc_source else
                        template_selector(a.theme_root, machine))
        display_path = (example or {}).get('path')
        verification_url = (urljoin(a.site_url.rstrip('/') + '/', display_path.lstrip('/'))
                            if a.site_url and display_path else (example or {}).get('url'))
        cfg = {
            'component': c.get('label') or machine,
            'componentId': component_id,
            'machineName': machine,
            'source': {'sourceRef': c.get('sourceRef')},
            'path': display_path,
            'verificationUrl': verification_url,
            'linkUrl': urljoin(a.canonical_base_url.rstrip('/') + '/',
                               (display_path or '').lstrip('/')) if display_path else None,
            'rootSelector': sel,
            'nth': 0,
            'states': [{'name': 'default'}],
        }
        gaps = []
        if not cfg['verificationUrl'] or not cfg['path'] or not cfg['linkUrl']:
            gaps.append('verified example')
        if not sel:
            gaps.append('rootSelector')
            cfg['rootSelector'] = (None if sdc_source else
                                   '.paragraph--type--%s' % clean(machine))
            cfg['_selectorIsAGuess'] = ('No root class could be read from the SDC Twig template.'
                                        if sdc_source else 'The default paragraph wrapper. '
                                        'Verify it: a component with its own template usually '
                                        'emits no bundle class.')
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
        print('\nA missing verified example means this source entity is not eligible for a '
              'visual master. Run design-lab:usage first; do not guess a page.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
