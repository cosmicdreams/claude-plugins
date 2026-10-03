#!/usr/bin/env python3
"""Where a site keeps its Site Studio configuration, and its code-driven custom components.

Site Studio has two sources, and each is found on its own:

- Its configuration export: components, custom styles, base styles, colours, fonts, website
  settings, templates and more, written as `cohesion_*` YAML. Where it lives is a fact about
  the site, declared in settings.php as $settings['site_studio_sync']; only when that setting is
  absent does Site Studio export alongside Drupal's own configuration
  ($settings['config_sync_directory']). The folder is read from those settings, never guessed
  from folder names, and the run records it as a decision (`sitestudioConfig`) that a person can
  override.
- Custom components written by hand: `<name>.custom_component.yml` in the `custom_components`
  folder of the site's own active modules and themes (or of the Drupal root), found the way Site
  Studio's CustomComponentDiscovery finds them. These exist whether or not the site also has
  configuration-driven components.

settings.php is read, never run. Only literal strings joined with `.` to `$app_root`,
`DRUPAL_ROOT`, `__DIR__`, `dirname(__FILE__)` and `$site_path` are understood; anything else is
reported as unresolved, so the person can name the folder instead.
"""
import glob
import os
import re

from detect import docroot

SITE_STUDIO = 'site_studio_sync'
DRUPAL = 'config_sync_directory'
ASSIGNMENT = re.compile(r"""\$settings\s*\[\s*(['"])(%s|%s)\1\s*\]\s*=(?!=)""" % (SITE_STUDIO, DRUPAL))
# DDEV mounts the repository at this path inside the web container.
CONTAINER_ROOT = '/var/www/html'
# Written by tools for one environment, setting defaults the site's own settings override.
GENERATED = re.compile(r'settings\.ddev\.php$')
# Site Studio's CustomComponentDiscovery: the folder, the file suffix, the machine-name rule
# (PHP_FUNCT_PATTERN), the keys a definition must have, and the folders it never descends into
# (RecursiveComponentFilterIterator, with test folders excluded as Site Studio does by default).
CUSTOM_DIR = 'custom_components'
CUSTOM_SUFFIX = '.custom_component.yml'
MACHINE_NAME = re.compile(r'^[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*$')
REQUIRED_KEYS = ('name', 'category')
BLOCKED = {'src', 'lib', 'vendor', 'assets', 'css', 'files', 'images', 'js', 'misc', 'templates',
           'includes', 'fixtures', 'Drupal', 'node_modules', 'bower_components', 'tests'}


def php_code(text):
    """The source with comments blanked (newlines kept, so line numbers hold) and strings left
    exactly as written. A small scanner, because a path may contain `#`, `//` or `/*`."""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c in "'\"":
            j = i + 1
            while j < n and text[j] != c:
                j += 2 if text[j] == '\\' else 1
            out.append(text[i:j + 1])
            i = j + 1
        elif text.startswith('/*', i):
            j = text.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r'[^\n]', ' ', text[i:j]))
            i = j
        elif c == '#' or text.startswith('//', i):
            j = text.find('\n', i)
            j = n if j < 0 else j
            out.append(' ' * (j - i))
            i = j
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def expression_tokens(expr):
    """Split a PHP expression on `.` outside strings; None when it holds anything unbalanced."""
    tokens, current, i, n = [], [], 0, len(expr)
    while i < n:
        c = expr[i]
        if c in "'\"":
            j = i + 1
            while j < n and expr[j] != c:
                j += 2 if expr[j] == '\\' else 1
            if j >= n:
                return None
            current.append(expr[i:j + 1])
            i = j + 1
        elif c == '.':
            tokens.append(''.join(current).strip())
            current = []
            i += 1
        else:
            current.append(c)
            i += 1
    tokens.append(''.join(current).strip())
    return tokens


def literal(token):
    """A PHP string literal's value, or None when it is not one (or interpolates variables)."""
    if len(token) >= 2 and token[0] == token[-1] == "'":
        return re.sub(r"\\([\\'])", r'\1', token[1:-1])
    if len(token) >= 2 and token[0] == token[-1] == '"' and '$' not in token:
        return re.sub(r'\\(.)', r'\1', token[1:-1])
    return None


def resolve(expr, web, settings_file, root):
    """The folder a settings expression names, or None when it cannot be read without PHP."""
    site_dir = os.path.dirname(settings_file)
    tokens = expression_tokens(expr)
    if not tokens or any(not t for t in tokens):
        return None
    parts = []
    for token in tokens:
        value = literal(token)
        if value is not None:
            parts.append(value)
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


def statement_end(code, start):
    """Where the statement starting at `start` ends: the next `;` outside a string."""
    i, n = start, len(code)
    while i < n:
        c = code[i]
        if c in "'\"":
            j = i + 1
            while j < n and code[j] != c:
                j += 2 if code[j] == '\\' else 1
            i = j + 1
        elif c == ';':
            return i
        else:
            i += 1
    return n


def declared(root, name):
    """Every assignment of the setting in the site's settings files, resolved where possible."""
    web = docroot(root)
    found = []
    for settings in sorted(glob.glob(os.path.join(web, 'sites', '*', 'settings*.php'))):
        if GENERATED.search(settings):
            continue
        try:
            with open(settings, encoding='utf-8', errors='replace') as stream:
                code = php_code(stream.read())
        except OSError:
            continue
        for match in ASSIGNMENT.finditer(code):
            if match.group(2) != name:
                continue
            expr = code[match.end():statement_end(code, match.end())].strip()
            path = resolve(expr, web, settings, root)
            found.append({'file': os.path.relpath(settings, root),
                          'line': code.count('\n', 0, match.start()) + 1,
                          'expression': expr, 'path': path,
                          'exists': bool(path and os.path.isdir(path))})
    return found


def families(folder):
    """How many entities of each Site Studio family the export holds."""
    counts = {}
    for path in glob.glob(os.path.join(folder, 'cohesion_*.yml')):
        family = '.'.join(os.path.basename(path).split('.')[:2])
        counts[family] = counts.get(family, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def _where(item):
    return f"{item['file']}:{item['line']}"


def config_dir(root):
    """Where the site declares its Site Studio configuration export, and how that was decided.

    Returns {'path', 'from', 'declared', 'problem'}. 'path' is None, with a 'problem' saying what
    to do, whenever the settings do not name exactly one folder that exists: a setting that
    cannot be read without PHP, settings that disagree (several settings files or sites), or a
    declared folder that is missing. Drupal's configuration folder stands in only when the Site
    Studio setting is absent altogether, as it does for Site Studio itself.
    """
    root = os.path.abspath(root)
    override = 'name the folder with workflow.py select --sitestudio-config <folder>'
    for name in (SITE_STUDIO, DRUPAL):
        found = declared(root, name)
        if not found:
            continue
        unreadable = [item for item in found if not item['path']]
        if unreadable:
            item = unreadable[0]
            return {'path': None, 'from': None, 'declared': found,
                    'problem': f"$settings['{name}'] at {_where(item)} is {item['expression']}, which cannot be "
                               f"read without running PHP; {override}"}
        paths = sorted({item['path'] for item in found})
        if len(paths) > 1:
            return {'path': None, 'from': None, 'declared': found,
                    'problem': f"the settings give $settings['{name}'] {len(paths)} different values "
                               f"({', '.join(os.path.relpath(p, root) for p in paths)}), and which applies depends "
                               f"on the site and environment; {override}"}
        item = found[0]
        if not item['exists']:
            return {'path': None, 'from': None, 'declared': found,
                    'problem': f"$settings['{name}'] at {_where(item)} names {os.path.relpath(item['path'], root)}, "
                               f"which does not exist in this repository; {override}"}
        if name == DRUPAL and not glob.glob(os.path.join(item['path'], 'cohesion_*.yml')):
            return {'path': None, 'from': None, 'declared': found,
                    'problem': f"the site's settings name no Site Studio folder, and its Drupal configuration "
                               f"({os.path.relpath(item['path'], root)}) holds no Site Studio entities; {override}"}
        return {'path': item['path'], 'from': f"{_where(item)} ({name})", 'declared': found, 'problem': None}
    return {'path': None, 'from': None, 'declared': [],
            'problem': f"the site's settings name no Site Studio configuration folder; {override}"}


def extension_roots(web):
    """The site's own modules and themes ({name: folder}), from their info files."""
    roots = {}
    for kind in ('modules', 'themes'):
        base = os.path.join(web, kind, 'custom')
        for dirpath, dirnames, filenames in os.walk(base, followlinks=True):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith('.') and d not in BLOCKED)
            for filename in filenames:
                if filename.endswith('.info.yml'):
                    roots.setdefault(filename[:-len('.info.yml')], dirpath)
    return roots


def active_extensions(root):
    """Enabled modules and themes from core.extension.yml in Drupal's configuration, or None when
    that cannot be read (then every extension is treated as active, and the summary says so)."""
    located = declared(os.path.abspath(root), DRUPAL)
    paths = {item['path'] for item in located if item['exists']}
    if len(paths) != 1:
        return None
    try:
        with open(os.path.join(paths.pop(), 'core.extension.yml'), encoding='utf-8') as stream:
            text = stream.read()
    except OSError:
        return None
    return set(re.findall(r'^  ([a-z0-9_]+): ', text, re.M))


def _scan(folder):
    """Custom component files below one custom_components folder, keyed by name, as Site Studio
    scans it: symlinks followed (each real folder once), blocked and hidden folders skipped."""
    files, seen = {}, set()
    for dirpath, dirnames, filenames in os.walk(folder, followlinks=True):
        real = os.path.realpath(dirpath)
        if real in seen:
            dirnames[:] = []
            continue
        seen.add(real)
        dirnames[:] = sorted(d for d in dirnames if not d.startswith('.') and d not in BLOCKED)
        for filename in sorted(filenames):
            name = filename[:-len(CUSTOM_SUFFIX)] if filename.endswith(CUSTOM_SUFFIX) else None
            if name and MACHINE_NAME.match(name):
                files[name] = os.path.join(dirpath, filename)
    return files


def custom_components(root):
    """The custom components Site Studio would offer, and why any were left out.

    Search folders are `custom_components` at the top of each of the site's own active modules
    and themes, then the Drupal root's. A name already found keeps its first definition, as in
    Site Studio; a definition missing `name` or `category` is one Site Studio refuses."""
    root = os.path.abspath(root)
    web = docroot(root)
    active = active_extensions(root)
    folders = [os.path.join(path, CUSTOM_DIR) for ext, path in sorted(extension_roots(web).items())
               if active is None or ext in active]
    folders.append(os.path.join(web, CUSTOM_DIR))
    chosen, problems = {}, []
    for folder in folders:
        if not os.path.isdir(folder):
            continue
        for name, path in _scan(folder).items():
            with open(path, encoding='utf-8', errors='replace') as stream:
                text = stream.read()
            missing = [key for key in REQUIRED_KEYS if not re.search(r'^%s:' % key, text, re.M)]
            if missing:
                problems.append({'kind': 'invalid-custom-component', 'detail':
                                 f"{os.path.relpath(path, root)}: missing {', '.join(missing)}, so Site Studio refuses it"})
            elif name in chosen:
                problems.append({'kind': 'duplicate-custom-component', 'detail':
                                 f"{os.path.relpath(path, root)} is hidden by {os.path.relpath(chosen[name], root)}, "
                                 f"which Site Studio finds first for the name {name}"})
            else:
                chosen[name] = path
    return [chosen[name] for name in sorted(chosen)], problems, active is not None


def custom_component_files(root):
    return custom_components(root)[0]


def custom_component_id(path):
    """Site Studio names a custom component by its definition file."""
    return os.path.basename(path)[:-len(CUSTOM_SUFFIX)]


def summary(root, folder=None):
    """What detection reports about Site Studio: the export and the custom components, apart."""
    root = os.path.abspath(root)
    located = config_dir(root) if folder is None else {
        'path': os.path.abspath(folder), 'from': 'given', 'declared': [], 'problem': None}
    path = located['path']
    counts = families(path) if path and os.path.isdir(path) else {}
    custom, problems, activity_known = custom_components(root)
    return {'configDir': path, 'configFrom': located['from'], 'problem': located['problem'],
            'declared': located['declared'], 'families': counts,
            'components': counts.get('cohesion_elements.cohesion_component', 0),
            'customStyles': counts.get('cohesion_custom_styles.cohesion_custom_style', 0),
            'customComponents': [os.path.relpath(p, root) for p in custom],
            'customComponentProblems': problems,
            'customComponentsFromActiveExtensionsOnly': activity_known}
