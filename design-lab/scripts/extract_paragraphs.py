#!/usr/bin/env python3
"""Paragraphs extractor -> universal model.

The component source for a plain-Drupal site. Three config entity families have to be
joined to recover one component:

    paragraphs.paragraphs_type.<bundle>.yml        the component itself
    field.field.paragraph.<bundle>.<field>.yml     the field instance: label, required
    field.storage.paragraph.<field>.yml            cardinality, and the enum options

Neither file alone is sufficient. Options live on the *storage*, which is shared across
every bundle that reuses the field name, while the label and required flag live on the
*instance*. Reading only one produces components with unlabelled fields or optionless
enums.

Uses PyYAML when available. Otherwise falls back to a parser scoped to the subset that
Drupal's config exporter emits - which, unlike hand-written YAML, is highly regular. The
fallback handles nested sequences of mappings (`allowed_values`), because that is exactly
where a paragraph's enum options live. It FAILS LOUDLY rather than guessing.
"""
import json, os, re, sys, glob, datetime

try:
    import yaml
    HAVE_YAML = True
except ImportError:
    HAVE_YAML = False

UNSUPPORTED = re.compile(r'(^|\s)(&\w+|\*\w+|<<:|\|[-+]?$|>[-+]?$)')


# --------------------------------------------------------------------------- parsing

def _scalar(v):
    v = v.strip()
    if v == '' or v == '~' or v.lower() == 'null':
        return None
    if v[0] in '"\'' and len(v) > 1 and v[-1] == v[0]:
        return v[1:-1]
    if v in ('{}', '{  }'):
        return {}
    if v in ('[]', '[  ]'):
        return []
    low = v.lower()
    if low in ('true', 'false'):
        return low == 'true'
    if re.fullmatch(r'-?\d+', v):
        return int(v)
    if re.fullmatch(r'-?\d*\.\d+', v):
        return float(v)
    return v


def _lines(text, path):
    """Significant lines as (indent, content), comments and blanks dropped."""
    out = []
    for lineno, raw in enumerate(text.splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith('#'):
            continue
        if UNSUPPORTED.search(raw):
            raise ValueError('%s:%d unsupported YAML construct: %s'
                             % (path, lineno, raw.strip()[:60]))
        out.append((len(raw) - len(raw.lstrip()), raw.strip(), lineno))
    return out


def _parse_block(lines, i, indent, path):
    """Parse one block at `indent`. Returns (value, next_index)."""
    if i >= len(lines):
        return None, i
    if lines[i][1].startswith('-'):
        return _parse_seq(lines, i, indent, path)
    return _parse_map(lines, i, indent, path)


def _parse_map(lines, i, indent, path):
    out = {}
    while i < len(lines):
        ind, line, lineno = lines[i]
        if ind < indent:
            break
        if ind > indent:
            raise ValueError('%s:%d unexpected indent in mapping' % (path, lineno))
        if line.startswith('- '):
            break
        m = re.match(r'^([$\w.\-/@]+|"[^"]+"|\'[^\']+\'):\s*(.*)$', line)
        if not m:
            raise ValueError('%s:%d unparseable mapping line: %s' % (path, lineno, line[:70]))
        key, rest = m.group(1).strip('"\''), m.group(2).strip()
        if rest:
            out[key] = _scalar(rest)
            i += 1
            continue
        # Empty value: either a nested block, or an explicit null at end of file.
        if i + 1 < len(lines) and lines[i + 1][0] > ind:
            val, i = _parse_block(lines, i + 1, lines[i + 1][0], path)
            out[key] = val
        else:
            out[key] = None
            i += 1
    return out, i


def _parse_seq(lines, i, indent, path):
    out = []
    while i < len(lines):
        ind, line, lineno = lines[i]
        if ind < indent or not line.startswith('-'):
            break
        if ind > indent:
            raise ValueError('%s:%d unexpected indent in sequence' % (path, lineno))
        if line == '-':
            # Bare dash: the item is the indented block that follows. Drupal emits
            # allowed_values entries exactly this way.
            if i + 1 < len(lines) and lines[i + 1][0] > ind:
                val, i = _parse_block(lines, i + 1, lines[i + 1][0], path)
                out.append(val)
            else:
                out.append(None)
                i += 1
            continue
        inline = line[2:] if line.startswith('- ') else line[1:]
        # "- key: value" starts a mapping item that may continue on following lines.
        m = re.match(r'^([$\w.\-/@]+|"[^"]+"|\'[^\']+\'):\s*(.*)$', inline.strip())
        if m and i + 1 < len(lines) and lines[i + 1][0] > ind:
            sub_indent = ind + (len(line) - len(inline))
            rebuilt = [(sub_indent, inline.strip(), lineno)] + lines[i + 1:]
            val, consumed = _parse_map(rebuilt, 0, sub_indent, path)
            out.append(val)
            i += consumed
            continue
        out.append(_scalar(inline))
        i += 1
    return out, i


def load(path):
    text = open(path, errors='ignore').read()
    if HAVE_YAML:
        return yaml.safe_load(text)
    lines = _lines(text, path)
    if not lines:
        return {}
    val, _ = _parse_block(lines, 0, lines[0][0], path)
    return val


# ----------------------------------------------------------------------- model mapping

# Drupal field type -> the closed set in references/model.md. Anything absent here is
# reported as a defect rather than silently coerced to text.
KIND = {
    'string': 'text',
    'string_long': 'text',
    'list_string': 'enum',
    'text': 'richtext',
    'text_long': 'richtext',
    'text_with_summary': 'richtext',
    'boolean': 'boolean',
    'integer': 'number',
    'decimal': 'number',
    'float': 'number',
    'link': 'reference',
    'image': 'media',
    'file': 'media',
    'entity_reference': 'reference',
    'entity_reference_revisions': 'reference',
    'color_field_type': 'color',
    'viewsreference': 'reference',
}

# Field-name fragments that mark a spacing/colour token rather than a visual choice.
# See references/variant-policy.md - this drives bound-variable vs variant-axis.
TOKEN_FAMILY = [
    (re.compile(r'(padding|margin|spacing|gap)', re.I), 'spacing'),
    (re.compile(r'(background|bg_color|color_scheme|theme|colour)', re.I), 'color-scheme'),
    (re.compile(r'(layout|column|alignment|align|position|width)', re.I), 'layout'),
]


def token_family(field_name, label):
    for rx, fam in TOKEN_FAMILY:
        if rx.search(field_name) or (label and rx.search(label)):
            return fam
    return None


def _index_storage(cfg):
    out = {}
    for f in glob.glob(os.path.join(cfg, 'field.storage.paragraph.*.yml')):
        data = load(f) or {}
        name = data.get('field_name') or os.path.basename(f)[len('field.storage.paragraph.'):-4]
        out[name] = {'data': data, 'path': f}
    return out


def _options(storage_data):
    """Enum options live on the storage, under settings.allowed_values."""
    allowed = ((storage_data.get('settings') or {}).get('allowed_values')) or []
    opts = []
    if isinstance(allowed, list):
        for entry in allowed:
            if isinstance(entry, dict) and 'value' in entry:
                opts.append({'value': entry.get('value'),
                             'label': str(entry.get('label', entry.get('value')))})
    elif isinstance(allowed, dict):
        for k, v in allowed.items():
            opts.append({'value': k, 'label': str(v)})
    return opts


def extract(root, cfg=None):
    root = os.path.abspath(root)
    if cfg is None:
        from detect import config_sync
        cfg = config_sync(root)
    if not cfg:
        raise SystemExit('no configuration directory found under %s' % root)

    storage = _index_storage(cfg)
    types = sorted(glob.glob(os.path.join(cfg, 'paragraphs.paragraphs_type.*.yml')))
    known = {os.path.basename(p)[len('paragraphs.paragraphs_type.'):-4] for p in types}

    comps, problems = [], []
    for tpath in types:
        try:
            tdata = load(tpath) or {}
        except Exception as e:
            problems.append({'kind': 'unparseable', 'ref': os.path.relpath(tpath, root),
                             'detail': str(e)[:300]})
            continue
        bundle = tdata.get('id') or os.path.basename(tpath)[len('paragraphs.paragraphs_type.'):-4]
        fields, slots, defects = [], [], []

        pattern = os.path.join(cfg, 'field.field.paragraph.%s.*.yml' % bundle)
        for fpath in sorted(glob.glob(pattern)):
            try:
                fdata = load(fpath) or {}
            except Exception as e:
                defects.append({'kind': 'unparseable-field', 'detail': str(e)[:200],
                                'evidence': os.path.relpath(fpath, root)})
                continue
            fname = fdata.get('field_name')
            ftype = fdata.get('field_type')
            st = storage.get(fname)
            if st is None:
                defects.append({'kind': 'dangling-storage-ref',
                                'detail': 'field instance %s has no field.storage entity' % fname,
                                'evidence': os.path.relpath(fpath, root)})
                sdata = {}
            else:
                sdata = st['data']
            cardinality = sdata.get('cardinality')
            settings = fdata.get('settings') or {}
            handler = (settings.get('handler_settings') or {})
            targets = handler.get('target_bundles') or {}
            target_list = sorted(targets.keys()) if isinstance(targets, dict) else sorted(targets or [])
            target_type = (sdata.get('settings') or {}).get('target_type')

            # An entity_reference_revisions field pointing at paragraphs is a SLOT, not a
            # field. This is the whole structural backbone of a Paragraphs site: layout
            # components are the ones that own these.
            if ftype == 'entity_reference_revisions' and target_type == 'paragraph':
                for t in target_list:
                    if t not in known:
                        defects.append({'kind': 'dangling-bundle-ref',
                                        'detail': 'target bundle %s does not exist' % t,
                                        'evidence': os.path.relpath(fpath, root)})
                slots.append({
                    'name': fname,
                    'label': fdata.get('label') or fname,
                    'accepts': target_list or 'any',
                    'cardinality': cardinality,
                    'required': bool(fdata.get('required')),
                    'sourceRef': os.path.relpath(fpath, root),
                })
                continue

            kind = KIND.get(ftype)
            if kind is None:
                defects.append({'kind': 'unmapped-field-type',
                                'detail': 'field type %s has no model kind' % ftype,
                                'evidence': os.path.relpath(fpath, root)})
                kind = 'text'
            opts = _options(sdata) if kind == 'enum' else None
            if kind == 'enum' and not opts:
                defects.append({'kind': 'enum-without-options',
                                'detail': 'list_string %s declares no allowed_values' % fname,
                                'evidence': os.path.relpath(fpath, root)})
            if ftype == 'entity_reference' and target_type in ('media', 'file'):
                kind = 'media'

            fields.append({
                'name': fname,
                'label': fdata.get('label') or fname,
                'kind': kind,
                'sourceWidget': ftype,
                'required': bool(fdata.get('required')),
                'default': None,
                'options': opts,
                'showWhen': None,      # Paragraphs has no conditional-display equivalent
                'tokenFamily': token_family(fname or '', fdata.get('label')),
                'cardinality': cardinality,
                'targetType': target_type,
                'targetBundles': target_list or None,
                'description': fdata.get('description') or None,
                'sourceRef': os.path.relpath(fpath, root),
                'uid': fname,
            })

        comps.append({
            'id': bundle,
            'label': tdata.get('label') or bundle,
            'description': tdata.get('description') or None,
            'group': 'layout' if slots else 'content',
            'groupEvidence': ('owns entity_reference_revisions slot(s): %s'
                              % ', '.join(s['name'] for s in slots)) if slots
                             else 'no paragraph-targeting reference field',
            'sourceRef': os.path.relpath(tpath, root),
            'fields': fields,
            'slots': slots,
            'usage': None,             # filled by a usage strategy, never guessed here
            'defects': defects,
            'status': tdata.get('status'),
        })

    # Which components can contain which - the containment graph an author actually
    # navigates. Recorded once at the top rather than recomputed by every renderer.
    contained_by = {c['id']: [] for c in comps}
    for c in comps:
        for s in c['slots']:
            for t in (s['accepts'] if isinstance(s['accepts'], list) else []):
                contained_by.setdefault(t, []).append('%s.%s' % (c['id'], s['name']))

    for c in comps:
        c['containedBy'] = sorted(contained_by.get(c['id'], []))

    # Entry points: host entities that place paragraphs directly. Without these the
    # containment graph is a forest of orphans - the top-level components look unused
    # because nothing in paragraph-space references them.
    entry_points = []
    for fpath in sorted(glob.glob(os.path.join(cfg, 'field.field.*.yml'))):
        base = os.path.basename(fpath)
        parts = base[len('field.field.'):-len('.yml')].split('.')
        if len(parts) != 3 or parts[0] == 'paragraph':
            continue
        try:
            fdata = load(fpath) or {}
        except Exception:
            continue
        if fdata.get('field_type') != 'entity_reference_revisions':
            continue
        fname = fdata.get('field_name')
        sdata = (storage.get(fname) or {}).get('data') or {}
        if (sdata.get('settings') or {}).get('target_type') != 'paragraph':
            # storage for non-paragraph host entities lives under its own entity type
            alt = os.path.join(cfg, 'field.storage.%s.%s.yml' % (parts[0], fname))
            if not os.path.isfile(alt):
                continue
            try:
                sdata = load(alt) or {}
            except Exception:
                continue
            if (sdata.get('settings') or {}).get('target_type') != 'paragraph':
                continue
        targets = ((fdata.get('settings') or {}).get('handler_settings') or {}).get('target_bundles') or {}
        target_list = sorted(targets.keys()) if isinstance(targets, dict) else sorted(targets or [])
        entry_points.append({
            'hostEntityType': parts[0], 'hostBundle': parts[1], 'field': fname,
            'label': fdata.get('label') or fname, 'accepts': target_list or 'any',
            'sourceRef': os.path.relpath(fpath, root),
        })
        for t in target_list:
            if t in contained_by:
                contained_by[t].append('%s:%s.%s' % (parts[0], parts[1], fname))

    for c in comps:
        c['containedBy'] = sorted(contained_by.get(c['id'], []))
        c['isEntryPoint'] = any(c['id'] in (e['accepts'] if isinstance(e['accepts'], list) else [])
                                for e in entry_points)

    return {
        'entryPoints': entry_points,
        'generatedAt': datetime.datetime.now().replace(microsecond=0).isoformat(),
        'source': {'strategy': 'paragraphs', 'root': root, 'configDir': os.path.relpath(cfg, root),
                   'parser': 'pyyaml' if HAVE_YAML else 'fallback'},
        'totals': {'all': len(comps),
                   'layout': sum(1 for c in comps if c['group'] == 'layout'),
                   'content': sum(1 for c in comps if c['group'] == 'content'),
                   'withDefects': sum(1 for c in comps if c['defects'])},
        'components': comps,
        'problems': problems,
    }


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    print(json.dumps(extract(sys.argv[1] if len(sys.argv) > 1 else '.'), indent=2))
