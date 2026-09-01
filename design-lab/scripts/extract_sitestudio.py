#!/usr/bin/env python3
"""Site Studio (Acquia Cohesion) component extractor -> universal model.

Reads cohesion_elements.cohesion_component.*.yml. The payload is a JSON string inside a
single-quoted YAML scalar, so doubled single quotes must be unescaped before parsing.
No YAML library required, which keeps this runnable without a virtualenv.
"""
import json, re, sys, os, glob, datetime

# Site Studio widget type -> model field kind. Source widget names never leak past here.
KIND = {
    'cohWysiwyg': 'richtext', 'cohTextarea': 'text', 'cohSelect': 'enum',
    'checkboxToggle': 'boolean', 'cohColourPickerOpener': 'color',
    'cohFileBrowser': 'media', 'cohRange': 'number', 'cohTypeahead': 'reference',
    'cohHidden': 'hidden', 'cohHelpText': 'help', 'cohArray': 'array',
    '': 'text', None: 'text',
}
TOKEN_RE = re.compile(r'^coh-style-')
# Which token family an option value belongs to. This is the distinction that matters:
# a SPACING token becomes a bound variable, anything else stays a candidate variant axis.
# Classifying on the coh-style- prefix alone wrongly demotes theme and column choices.
TOKEN_FAMILY = [
    (re.compile(r'^coh-style-(padding|margin|spacing)'), 'spacing'),
    (re.compile(r'^coh-style-color-scheme'), 'color-scheme'),
    (re.compile(r'^coh-style-(multi-column|boxed-width|fluid)'), 'layout'),
    (re.compile(r'^coh-style-text-color'), 'color'),
]

def token_family(values):
    """Return the single family all token values share, or None if mixed/absent."""
    fams = set()
    for v in values:
        for rx, fam in TOKEN_FAMILY:
            if rx.match(str(v)):
                fams.add(fam)
                break
        else:
            fams.add('other')
    fams.discard('other') if len(fams) > 1 else None
    return fams.pop() if len(fams) == 1 else None

def load_json_values(path):
    txt = open(path, errors='ignore').read()
    m = re.search(r"^json_values: '(.*?)'\n[a-z_]+:", txt, re.S | re.M)
    if not m:
        return None, txt
    try:
        return json.loads(m.group(1).replace("''", "'")), txt
    except json.JSONDecodeError:
        return None, txt

def scalar(txt, key):
    m = re.search(r'^%s: (.+)$' % re.escape(key), txt, re.M)
    return m.group(1).strip().strip("'\"") if m else None

def extract_component(path, root):
    jv, txt = load_json_values(path)
    if jv is None:
        return None, {'kind': 'unparseable', 'detail': os.path.relpath(path, root)}

    model = jv.get('model') or {}
    canvas_blob = json.dumps(jv.get('canvas', []))
    fields, defects = [], []
    referenced = set(re.findall(r'\[field\.([0-9a-f-]{36})\]', json.dumps(jv)))
    declared = set()

    for uid, v in model.items():
        if not isinstance(v, dict):
            continue
        s = v.get('settings') or {}
        mn = s.get('machineName')
        if not mn:
            continue
        declared.add(uid)
        wtype = s.get('type')
        opts = [{'value': o.get('value'), 'label': o.get('label')}
                for o in (s.get('options') or []) if isinstance(o, dict) and 'label' in o]
        default = (v.get('model') or {}).get('value')
        if isinstance(default, dict):
            default = default.get('name') or default.get('value')
            if isinstance(default, dict):
                default = default.get('hex')

        # An enum whose values are style classes is a TOKEN, not a visual choice.
        # This distinction is what keeps variant counts sane - see variant-policy.md.
        token_vals = [o['value'] for o in opts if o.get('value') and TOKEN_RE.match(str(o['value']))]
        fam = token_family(token_vals) if token_vals else None

        fields.append({
            'name': mn, 'label': s.get('title'), 'kind': KIND.get(wtype, 'text'),
            'sourceWidget': wtype, 'required': bool(s.get('required')),
            'default': default if default not in ('', {}) else None,
            'options': opts or None, 'showWhen': s.get('showCondition'),
            'tokenFamily': fam, 'uid': uid,
        })

    # Defect: a style or condition references a field uid that is no longer in the form.
    for uid in referenced - declared:
        hist = re.search(r'"uuid":"%s","type":"[^"]*","machineName":"([^"]+)"' % uid,
                         json.dumps(jv))
        defects.append({'kind': 'dangling-field-ref', 'detail':
            'references field %s (%s) which is not in the component form' %
            (uid, hist.group(1) if hist else 'removed'),
            'evidence': 'present in meta.fieldHistory only'})

    # Defect: two conditional fields testing the same tag - a common copy-paste slip.
    by_cond = {}
    for f in fields:
        if f['showWhen'] and f['kind'] == 'hidden':
            by_cond.setdefault(f['showWhen'], []).append(f['name'])
    for cond, names in by_cond.items():
        if len(names) > 1:
            defects.append({'kind': 'duplicate-show-condition',
                'detail': 'fields %s share an identical show condition' % ', '.join(names),
                'evidence': cond[:160]})

    slots = []
    if 'drop-zone' in canvas_blob:
        n = canvas_blob.count('"uid":"component-drop-zone"') or 1
        slots = [{'name': 'content' if n == 1 else 'content-%d' % (i + 1),
                  'label': 'Component drop zone', 'accepts': 'any'} for i in range(n)]

    return {
        'id': scalar(txt, 'id') or os.path.basename(path).split('.')[-2],
        'label': scalar(txt, 'label'),
        'group': scalar(txt, 'category'),
        'sourceRef': os.path.relpath(path, root),
        'fields': fields, 'slots': slots,
        'usage': None,
        'defects': defects,
    }, None

def extract(root, config_dir=None):
    root = os.path.abspath(root)
    if not config_dir:
        for c in ('config/sync', 'config/default', 'config'):
            if os.path.isdir(os.path.join(root, c)):
                config_dir = os.path.join(root, c)
                break
    files = sorted(glob.glob(os.path.join(
        config_dir, 'cohesion_elements.cohesion_component.*.yml')))
    comps, problems = [], []
    for f in files:
        c, err = extract_component(f, root)
        if c:
            comps.append(c)
        if err:
            problems.append(err)
    return {
        'generatedAt': datetime.datetime.now().replace(microsecond=0).isoformat(),
        'source': {'strategy': 'sitestudio', 'root': root, 'configDir': config_dir},
        'components': comps, 'problems': problems,
    }

if __name__ == '__main__':
    print(json.dumps(extract(sys.argv[1] if len(sys.argv) > 1 else '.'), indent=2))
