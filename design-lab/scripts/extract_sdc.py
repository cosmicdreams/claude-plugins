#!/usr/bin/env python3
"""Single Directory Component extractor -> universal model.

Uses PyYAML when available. Falls back to a scoped parser covering the subset that
*.component.yml actually uses (nested maps, block and inline lists, scalars, comments).
The fallback FAILS LOUDLY on anything it does not understand rather than guessing -
a silently mis-parsed component is worse than a reported one.
"""
import json, os, re, sys, glob, datetime
from artifact_contracts import tool_version

# references/library-standard.md section 10: every artifact states which edition it
# was built to, or nobody can tell whether a library predates a rule.
STANDARD_VERSION = '3.0.0'

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
    if re.fullmatch(r'\{\s*\}', v):
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


KEY = re.compile(r'^([$\w.\-/]+|"[^"]+"|\'[^\']+\'):\s*(.*)$')


def mini_yaml(text, path):
    """Parse the scoped block mapping/list subset used by SDC and Canvas config."""
    lines = []
    for number, raw in enumerate(text.splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith('#') or raw.strip() == '---':
            continue
        if '\t' in raw[:len(raw) - len(raw.lstrip())] or UNSUPPORTED.search(raw):
            raise ValueError('%s:%d unsupported YAML construct' % (path, number))
        lines.append((len(raw) - len(raw.lstrip()), raw.strip(), number))

    def block(index, indent):
        is_list = lines[index][1] == '-' or lines[index][1].startswith('- ')
        result = [] if is_list else {}
        while index < len(lines) and lines[index][0] == indent:
            _, line, number = lines[index]
            if is_list != (line == '-' or line.startswith('- ')):
                break
            if is_list:
                if not (line == '-' or line.startswith('- ')):
                    raise ValueError('%s:%d mixed list and mapping' % (path, number))
                rest = line[1:].strip()
                index += 1
                if rest:
                    match = KEY.match(rest)
                    if match:
                        item = {match[1].strip('"\''): _scalar(match[2])}
                        if index < len(lines) and lines[index][0] > indent:
                            extra, index = block(index, lines[index][0])
                            if not isinstance(extra, dict):
                                raise ValueError('%s:%d list mapping expected' % (path, number))
                            item.update(extra)
                        result.append(item)
                    else:
                        result.append(_scalar(rest))
                elif index < len(lines) and lines[index][0] > indent:
                    item, index = block(index, lines[index][0])
                    result.append(item)
                else:
                    result.append(None)
            else:
                match = KEY.match(line)
                if not match:
                    raise ValueError('%s:%d unparseable line: %s' % (path, number, line[:60]))
                key, rest = match[1].strip('"\''), match[2]
                index += 1
                if not rest and index < len(lines) and (lines[index][0] > indent or
                        (lines[index][0] == indent and
                         (lines[index][1] == '-' or lines[index][1].startswith('- ')))):
                    result[key], index = block(index, lines[index][0])
                else:
                    result[key] = _scalar(rest)
        return result, index

    if not lines:
        return {}
    result, end = block(0, lines[0][0])
    if end != len(lines):
        raise ValueError('%s:%d inconsistent indentation' % (path, lines[end][2]))
    return result


def load(path):
    with open(path, errors='ignore') as handle:
        text = handle.read()
    if HAVE_YAML:
        return yaml.safe_load(text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
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
    # A Single Directory Component slot takes any renderable; `["*"]` is the model's "any".
    slots = [{'name': k, 'label': (v or {}).get('title') if isinstance(v, dict) else k,
              'accepts': ['*']} for k, v in (data.get('slots') or {}).items()]
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
    return {'standardVersion': STANDARD_VERSION,
            'toolVersion': tool_version(),
            'generatedAt': datetime.datetime.now().replace(microsecond=0).isoformat(),
            'source': {'strategy': 'sdc', 'root': root, 'parser': 'pyyaml' if HAVE_YAML else 'fallback'},
            'components': comps, 'problems': problems}


if __name__ == '__main__':
    print(json.dumps(extract(sys.argv[1] if len(sys.argv) > 1 else '.'), indent=2))
