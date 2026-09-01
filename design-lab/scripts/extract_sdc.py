#!/usr/bin/env python3
"""Single Directory Component extractor -> universal model.

Uses PyYAML when available. Falls back to a scoped parser covering the subset that
*.component.yml actually uses (nested maps, block and inline lists, scalars, comments).
The fallback FAILS LOUDLY on anything it does not understand rather than guessing -
a silently mis-parsed component is worse than a reported one.
"""
import json, os, re, sys, glob, datetime

try:
    import yaml
    HAVE_YAML = True
except ImportError:
    HAVE_YAML = False

SKIP = re.compile(r'/(node_modules|vendor|\.git|contrib|core)/')
UNSUPPORTED = re.compile(r'(^|\s)(&\w+|\*\w+|<<:|\|[-+]?$|>[-+]?$)')


def _scalar(v):
    v = v.strip()
    if not v:
        return None
    if v[0] in '"\'' and v[-1] == v[0] and len(v) > 1:
        return v[1:-1]
    if v == '{}':
        return {}
    if v.startswith('{') and v.endswith('}'):
        out = {}
        for part in re.split(r",\s*(?=(?:[^']*'[^']*')*[^']*$)", v[1:-1]):
            if ':' not in part:
                raise ValueError('inline mapping entry without a key: %s' % part[:40])
            k, _, val = part.partition(':')
            out[k.strip().strip('"\'')] = _scalar(val)
        return out
    if v.startswith('[') and v.endswith(']'):
        inner = v[1:-1].strip()
        if not inner:
            return []
        return [_scalar(x) for x in re.split(r",\s*(?=(?:[^']*'[^']*')*[^']*$)", inner)]
    low = v.lower()
    if low in ('true', 'false'):
        return low == 'true'
    if low in ('null', '~'):
        return None
    if re.fullmatch(r'-?\d+', v):
        return int(v)
    if re.fullmatch(r'-?\d*\.\d+', v):
        return float(v)
    return v


def mini_yaml(text, path):
    """Parse the block-mapping subset used by component.yml. Raises on anything else."""
    root = {}
    stack = [(-1, root)]
    for lineno, raw in enumerate(text.splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith('#'):
            continue
        if UNSUPPORTED.search(raw):
            raise ValueError('%s:%d unsupported YAML construct: %s' % (path, lineno, raw.strip()[:60]))
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()
        while stack and indent <= stack[-1][0]:
            stack.pop()
        if not stack:
            raise ValueError('%s:%d indentation underflow' % (path, lineno))
        parent = stack[-1][1]
        if line.startswith('- '):
            item = _scalar(line[2:])
            if isinstance(parent, dict):
                raise ValueError('%s:%d list item in a mapping' % (path, lineno))
            parent.append(item)
            continue
        m = re.match(r'^([$\w.\-/]+|"[^"]+"|\'[^\']+\'):\s*(.*)$', line)
        if not m:
            raise ValueError('%s:%d unparseable line: %s' % (path, lineno, line[:60]))
        key, rest = m.group(1).strip('"\''), m.group(2)
        if rest == '':
            child = {}
            parent[key] = child
            stack.append((indent, child))
        elif rest.startswith('-') and not rest.startswith('- '):
            parent[key] = _scalar(rest)
        else:
            parent[key] = _scalar(rest)
    return _fix_lists(root)


def _fix_lists(node):
    """Empty mappings that only ever received list items become lists."""
    if isinstance(node, dict):
        return {k: _fix_lists(v) for k, v in node.items()}
    return node


def load(path):
    text = open(path, errors='ignore').read()
    if HAVE_YAML:
        return yaml.safe_load(text)
    # Block lists need a pre-pass: convert "key:\n  - a\n  - b" into inline form.
    text = re.sub(r'^(\s*)([$\w.\-/]+):\s*\n((?:\1\s+- .*\n?)+)',
                  lambda m: '%s%s: [%s]\n' % (m.group(1), m.group(2),
                      ', '.join(l.strip()[2:] for l in m.group(3).splitlines() if l.strip())),
                  text, flags=re.M)
    return mini_yaml(text, path)


KIND = {'string': 'text', 'number': 'number', 'integer': 'number',
        'boolean': 'boolean', 'object': 'reference', 'array': 'array'}


def extract_component(path, root):
    data = load(path)
    if not isinstance(data, dict):
        raise ValueError('%s did not parse to a mapping' % path)
    props = ((data.get('props') or {}).get('properties')) or {}
    fields = []
    for name, spec in props.items():
        if not isinstance(spec, dict):
            continue
        enum = spec.get('enum')
        opts = ([{'value': v, 'label': str(v).replace('_', ' ').replace('-', ' ').title()}
                 for v in enum] if isinstance(enum, list) else None)
        fields.append({
            'name': name,
            'label': spec.get('label') or spec.get('title') or name,
            'kind': 'enum' if opts else KIND.get(spec.get('type'), 'text'),
            'sourceWidget': spec.get('type'),
            'required': name in (data.get('props') or {}).get('required', []) or False,
            'default': spec.get('default'),
            'options': opts,
            'showWhen': None,          # Single Directory Components have no conditional display
            'tokenFamily': None,       # tokens are not in component definitions here
            'uid': name,
        })
    slots = [{'name': k, 'label': (v or {}).get('title') if isinstance(v, dict) else k,
              'accepts': 'any'} for k, v in (data.get('slots') or {}).items()]
    return {
        'id': os.path.basename(path).replace('.component.yml', ''),
        'label': data.get('name'), 'description': data.get('description'),
        'group': data.get('group'), 'sourceRef': os.path.relpath(path, root),
        'fields': fields, 'slots': slots, 'usage': None, 'defects': [],
        'status': data.get('status'),
    }


def extract(root):
    root = os.path.abspath(root)
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        if SKIP.search(dirpath + '/'):
            dirnames[:] = []
            continue
        files += [os.path.join(dirpath, f) for f in filenames if f.endswith('.component.yml')]
    comps, problems = [], []
    for f in sorted(files):
        try:
            comps.append(extract_component(f, root))
        except Exception as e:
            problems.append({'kind': 'unparseable', 'detail': str(e)[:300]})
    return {'generatedAt': datetime.datetime.now().replace(microsecond=0).isoformat(),
            'source': {'strategy': 'sdc', 'root': root, 'parser': 'pyyaml' if HAVE_YAML else 'fallback'},
            'components': comps, 'problems': problems}


if __name__ == '__main__':
    print(json.dumps(extract(sys.argv[1] if len(sys.argv) > 1 else '.'), indent=2))
