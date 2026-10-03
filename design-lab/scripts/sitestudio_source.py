#!/usr/bin/env python3
"""Where a site keeps its Site Studio configuration, and its code-driven custom components.

Site Studio has two sources, and each is found on its own:

- Its configuration export: components, custom styles, base styles, colours, fonts, website
  settings, templates and more, written as `cohesion_*` YAML. Where it lives is a fact about
  the site, declared in settings.php as $settings['site_studio_sync']; without that setting
  Site Studio exports alongside Drupal's own configuration ($settings['config_sync_directory']).
  The folder is read from those settings, never guessed from folder names, and the run records
  it as a decision (`sitestudioConfig`) that a person can override.
- Custom components written by hand in custom modules and themes: `<id>.custom_component.yml`
  anywhere under a `custom_components` folder, with an optional form and a Twig template.
  These exist whether or not the site also has configuration-driven components.

settings.php is read, never run. Only literal strings joined with `.` to `$app_root`,
`DRUPAL_ROOT`, `__DIR__`, `dirname(__FILE__)` and `$site_path` are understood; anything else is
reported as unresolved, so the person can name the folder instead.
"""
import glob
import os
import re

from detect import docroot

ASSIGNMENT = r"""^\s*\$settings\[['"]%s['"]\]\s*=\s*(?P<expr>[^;]+);"""
SETTINGS = {name: re.compile(ASSIGNMENT % name, re.M) for name in ('site_studio_sync', 'config_sync_directory')}
# DDEV mounts the repository at this path inside the web container.
CONTAINER_ROOT = '/var/www/html'
COMPONENT = 'cohesion_elements.cohesion_component.*.yml'
CUSTOM_STYLE = 'cohesion_custom_styles.cohesion_custom_style.*.yml'
# settings files written by tools for one environment: they set defaults the site's own settings
# override, so they never declare where the site keeps its configuration.
GENERATED = re.compile(r'settings\.ddev\.php$')


def _strip_comments(text):
    text = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'), text, flags=re.S)
    return re.sub(r'(^|\s)(//|#).*$', r'\1', text, flags=re.M)


def resolve(expr, web, settings_file, root):
    """The folder a settings expression names, or None when it cannot be read without PHP."""
    site_dir = os.path.dirname(settings_file)
    parts = []
    for token in re.split(r'\s*\.\s*(?=(?:[^\'"]*[\'"][^\'"]*[\'"])*[^\'"]*$)', expr.strip()):
        token = token.strip()
        literal = re.fullmatch(r"'([^']*)'|\"([^\"$]*)\"", token)
        if literal:
            parts.append(literal.group(1) if literal.group(1) is not None else literal.group(2))
        elif token in ('$app_root', 'DRUPAL_ROOT'):
            parts.append(web)
        elif token in ('__DIR__', 'dirname(__FILE__)'):
            parts.append(site_dir)
        elif token == '$site_path':
            parts.append(os.path.relpath(site_dir, web))
        else:
            return None
    path = ''.join(parts)
    if not path:
        return None
    if path == CONTAINER_ROOT or path.startswith(CONTAINER_ROOT + '/'):
        path = root + path[len(CONTAINER_ROOT):]
    # Drupal resolves a relative path from its app root, the docroot.
    return os.path.normpath(path if os.path.isabs(path) else os.path.join(web, path))


def declared(root, name):
    """Every assignment of the setting in the site's settings files, resolved where possible."""
    web = docroot(root)
    found = []
    for settings in sorted(glob.glob(os.path.join(web, 'sites', '*', 'settings*.php'))):
        if GENERATED.search(settings):
            continue
        try:
            with open(settings, encoding='utf-8', errors='replace') as stream:
                text = _strip_comments(stream.read())
        except OSError:
            continue
        for match in SETTINGS[name].finditer(text):
            path = resolve(match.group('expr'), web, settings, root)
            found.append({'file': os.path.relpath(settings, root),
                          'line': text.count('\n', 0, match.start()) + 1,
                          'expression': match.group('expr').strip(),
                          'path': path, 'exists': bool(path and os.path.isdir(path))})
    return found


def families(folder):
    """How many entities of each Site Studio family the export holds."""
    counts = {}
    for path in glob.glob(os.path.join(folder, 'cohesion_*.yml')):
        family = '.'.join(os.path.basename(path).split('.')[:2])
        counts[family] = counts.get(family, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def config_dir(root):
    """Where the site declares its Site Studio configuration export, and how that was decided.

    Returns {'path', 'from', 'declared', 'problem'}; 'path' is None with a 'problem' that says
    what to do when the settings do not name one readable folder.
    """
    root = os.path.abspath(root)
    for name in ('site_studio_sync', 'config_sync_directory'):
        found = declared(root, name)
        usable = sorted({item['path'] for item in found if item['exists']
                         and (name == 'site_studio_sync' or glob.glob(os.path.join(item['path'], 'cohesion_*.yml')))})
        if len(usable) == 1:
            source = next(item for item in found if item['path'] == usable[0])
            return {'path': usable[0], 'from': f"{source['file']}:{source['line']} ({name})",
                    'declared': found, 'problem': None}
        if len(usable) > 1:
            return {'path': None, 'from': None, 'declared': found,
                    'problem': f"the settings name {len(usable)} different {name} folders "
                               f"({', '.join(os.path.relpath(p, root) for p in usable)}); choose one with "
                               "workflow.py select --sitestudio-config <folder>"}
        unreadable = [item for item in found if not item['path']]
        if name == 'site_studio_sync' and unreadable:
            return {'path': None, 'from': None, 'declared': found,
                    'problem': f"$settings['site_studio_sync'] in {unreadable[0]['file']}:{unreadable[0]['line']} "
                               f"is {unreadable[0]['expression']}, which cannot be read without running PHP; "
                               "name the folder with workflow.py select --sitestudio-config <folder>"}
    return {'path': None, 'from': None, 'declared': [],
            'problem': "the site's settings name no Site Studio configuration folder; if the site uses Site "
                       "Studio, name it with workflow.py select --sitestudio-config <folder>"}


def custom_component_files(root):
    """Hand-written Site Studio components in the site's own modules and themes, at any depth
    below a `custom_components` folder, as Site Studio finds them. Contrib and core are not the
    site's own design and are left out."""
    web = docroot(os.path.abspath(root))
    found = set()
    for kind in ('modules', 'themes'):
        base = os.path.join(web, kind, 'custom')
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in ('node_modules', '.git', 'vendor')]
            if 'custom_components' not in dirpath.split(os.sep):
                continue
            found.update(os.path.join(dirpath, name) for name in filenames
                         if name.endswith('.custom_component.yml'))
    return sorted(found)


def custom_component_id(path):
    """Site Studio names a custom component by its definition file."""
    return os.path.basename(path)[:-len('.custom_component.yml')]


def summary(root, folder=None):
    """What detection reports about Site Studio: the export and the custom components, apart."""
    located = config_dir(root) if folder is None else {
        'path': os.path.abspath(folder), 'from': 'given', 'declared': [], 'problem': None}
    path = located['path']
    counts = families(path) if path and os.path.isdir(path) else {}
    custom = custom_component_files(root)
    return {'configDir': path, 'configFrom': located['from'], 'problem': located['problem'],
            'declared': located['declared'], 'families': counts,
            'components': counts.get('cohesion_elements.cohesion_component', 0),
            'customStyles': counts.get('cohesion_custom_styles.cohesion_custom_style', 0),
            'customComponents': [os.path.relpath(p, os.path.abspath(root)) for p in custom]}
