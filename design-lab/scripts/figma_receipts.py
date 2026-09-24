#!/usr/bin/env python3
"""Turn recorded deterministic Figma steps into durable manifest receipts."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

from artifact_contracts import (load_json, missing_nested, sha256, slot_accepts, tool_version,
                                validate, write_json)
import figma_build
import index_rows

STANDARD_VERSION = '4.0.0'
BREAKPOINTS = ('mobile', 'tablet', 'desktop')


def safe(step: str) -> str:
    return re.sub(r'[^A-Za-z0-9_.-]+', '_', step)


def surrogate_crops(build: dict) -> list[str]:
    """Image rectangles cut from a capture that cover most of the master: a screenshot
    standing in for the component rather than an icon glyph inside it."""
    area = float(build.get('width') or 0) * float(build.get('height') or 0)
    out = []
    for img in build.get('images') or []:
        src = str(img.get('src') or '')
        if not src.startswith('capture:') or not area:
            continue
        _, _, box = src.split(':', 2)
        _, _, w, h = (float(v) for v in box.split(','))
        if w * h >= 0.9 * area:
            out.append(src)
    return out


def native_component(build: dict, block: dict, fields: list[dict], relationships: list[dict],
                     slots: list[dict]) -> dict:
    """The build record's native-component section, from what the block step measured on
    the canvas. A block result without measurements (a run from before they existed) fails
    closed: nothing is claimed that was not observed."""
    measured = block.get('native') or {}
    node_type = measured.get('nodeType')
    root_image = measured.get('rootHasImageFill')
    nested = [item for item in measured.get('nestedInstances') or [] if isinstance(item, dict)]
    by_source: dict[str, list[str]] = {}
    for item in nested:
        by_source.setdefault(item.get('sourceId') or '', []).append(item.get('instanceId'))
    nested_instances = [{'sourceId': source or None, 'instanceNodeIds': ids}
                        for source, ids in sorted(by_source.items())]
    drawn = measured.get('documentedFields')
    expected = [f['field'] for f in fields] + [r['field'] for r in relationships]
    return {
        'nodeType': node_type,
        'rootHasImageFill': root_image,
        'componentProperties': [],
        'nestedInstances': nested_instances,
        'validation': {
            'nativeNode': (node_type in ('COMPONENT', 'COMPONENT_SET') and
                           block.get('setId') == build.get('componentId')),
            'noScreenshotSurrogate': root_image is False and not surrogate_crops(build),
            'authoringCoverage': isinstance(drawn, list) and sorted(drawn) == sorted(expected),
            'relationshipCoverage': bool(measured) and not missing_nested(
                slots, relationships, [item.get('sourceId') for item in nested]),
        },
    }


def generate(project: Path) -> list[tuple[str, Path, str, str | None]]:
    project = project.resolve()
    state = load_json(project / 'figma/state.json')
    if state.get('standardVersion') != STANDARD_VERSION:
        raise ValueError('Figma state is not standard 4.0.0')
    def result(step: str) -> dict:
        return load_json(project / 'figma/results' / (safe(step) + '.json'))
    pages = result('pages')['pages']
    variables = result('variables')
    components = {c['id']: c for c in load_json(project / 'components.json')['components']}
    plans = {p['id']: p for p in load_json(project / 'plan.json').get('plans', [])}
    captures = load_json(project / 'capture-evidence.json')['captures']
    repo_value = load_json(project / 'project.json')['repository']
    repo = Path(repo_value['root'] if isinstance(repo_value, dict) else repo_value)
    foundation = {
        'standardVersion': STANDARD_VERSION, 'toolVersion': tool_version(),
        'figmaFileKey': state['fileKey'], 'pages': pages,
        'collections': variables.get('collections') or {},
        'validation': {'errors': [*variables.get('unplanned', []), *variables.get('aliasMisses', [])]},
    }
    outputs = [('foundation', project / 'foundation.json', 'foundation', 'foundation')]
    write_json(outputs[0][1], foundation)
    for cid in state['built']:
        comp = components[cid]
        plan = plans.get(cid, {})
        tree = load_json(project / 'figma/trees' / (cid + '.json'))
        build = result(f'build:{cid}')
        block = result(f'block:{cid}')
        upload = result(f'evidence:{cid}')
        images_upload = result(f'images:{cid}')
        ev = captures.get(cid) or {}
        images = {i.get('viewport', '').lower(): i for i in ev.get('images', [])
                  if (i.get('state') or 'default') == 'default'}
        # A partial capture is recorded as a failing assertion naming the missing widths;
        # the record then fails its contract and is reported rather than registered.
        missing_breakpoints = [bp for bp in BREAKPOINTS if bp not in images]
        bp_evidence = {bp: {'captureFile': images[bp]['file'],
                            'viewportWidth': images[bp].get('width'),
                            'state': 'default'} for bp in BREAKPOINTS if bp in images}
        ids = block.get('evidenceIds') or []
        # The block drew one capture rectangle per column that has a capture, in column
        # order; each rectangle's name says its width, so a missing column shifts nothing.
        shown = [re.search(r'\b(mobile|tablet|desktop)\b', str(box.get('label', '')), re.I)
                 for box in (block.get('geometry') or {}).get('captures') or []]
        shots = {m.group(1).lower(): node for m, node in zip(shown, ids) if m}
        statuses = upload.get('statuses') or []
        comparison_path = project / 'figma/results' / (safe(f'compare:{cid}') + '.json')
        if comparison_path.exists():
            raw = load_json(comparison_path)
            if 'pairs' in raw:
                outcomes = {}
                for index, pair in enumerate(raw['pairs']):
                    match = re.search(r'\b(mobile|tablet|desktop)\b',
                                      str(pair.get('label', '')), re.I)
                    bp = match.group(1).lower() if match else (
                        BREAKPOINTS[index] if index < len(BREAKPOINTS) else None)
                    if bp:
                        outcomes[bp] = 'pass' if pair.get('pass') else 'fail'
                comparison = {'verdict': 'pass' if raw.get('pass') and
                              all(outcomes.get(bp) == 'pass' for bp in BREAKPOINTS) else 'fail',
                              'breakpoints': {
                                  bp: outcomes.get(bp, 'not-run') for bp in BREAKPOINTS},
                              'metrics': raw}
            else:
                comparison = {'verdict': 'not-run',
                              'breakpoints': {bp: 'not-run' for bp in BREAKPOINTS},
                              'metrics': raw}
        else:
            comparison = {'verdict': 'not-run',
                          'breakpoints': {bp: 'not-run' for bp in BREAKPOINTS}}
        fields = [{'field': f['name'], 'kind': f['kind'], 'required': bool(f.get('required')),
                   'default': f.get('default'), 'options': f.get('options'),
                   'figmaTreatment': next((p.get('treatment', 'as rendered') for p in plan.get('properties', [])
                                           if p.get('field') == f['name']), 'as rendered')}
                  for f in comp.get('fields') or []]
        relationships = [{'field': s['name'], 'accepts': slot_accepts(s.get('accepts')),
                          'cardinality': s.get('cardinality') or 0, 'required': bool(s.get('required')),
                          'rendered': True} for s in comp.get('slots') or []]
        anatomy = {'fields': fields, 'relationships': relationships}
        if not fields and not relationships:
            anatomy['emptyReason'] = 'No authored fields or relationships in the source.'
        source = repo / (comp.get('sourceRef') or '')
        source_hash = sha256(source) if source.is_file() else 'sha256:' + hashlib.sha256(
            json.dumps(comp, sort_keys=True).encode()).hexdigest()
        hash_basis = 'sourceRef' if source.is_file() else 'components.json entry'
        page_name = figma_build.component_page(comp)
        bound = build.get('bound', 0)
        literal = build.get('literal', 0)
        fell_back = build.get('fellBack') or []
        variable_count = build.get('variables', 0)
        responsive = bool(tree.get('variables'))
        image_statuses = images_upload.get('statuses') or []
        image_count = len(build.get('images') or [])
        manifest_path = project / 'figma/images' / cid.split('.')[-1] / 'images.json'
        image_failures = ([{'src': m['src'], 'error': m['error']}
                           for m in json.loads(manifest_path.read_text()) if m.get('error')]
                          if manifest_path.exists() else [])
        image_pass = (len(image_statuses) == image_count and
                      all(status == 200 for status in image_statuses))
        geometry = block.get('geometry') or {}
        specimen_boxes = geometry.get('variants') or []
        capture_boxes = geometry.get('captures') or []
        block_pass = (block.get('setId') == build.get('componentId') and
                      bool(block.get('specimenId')) and len(specimen_boxes) == 3 and
                      len(capture_boxes) == 3)
        record = {
            'standardVersion': STANDARD_VERSION, 'toolVersion': tool_version(), 'id': cid,
            'figma': {'fileKey': state['fileKey'], 'pageId': pages[page_name], 'pageName': page_name,
                      'documentationCardId': block['docId'], 'blockId': block['blockId'],
                      'componentId': build['componentId']},
            'built': {'variables': variable_count, 'created': build.get('created', 0),
                      'bindings': bound, 'literals': literal, 'fellBack': fell_back,
                      'collectionId': build.get('collectionId'),
                      'fonts': build.get('fonts') or {}, 'images': build.get('images') or [],
                      'svgFailures': build.get('svgFailures') or []},
            'documentation': {'anatomy': anatomy, 'breakpointScreenshots': shots},
            'nativeComponent': native_component(build, block, fields, relationships,
                                                comp.get('slots') or []),
            'visualEvidence': {'path': ev.get('path'),
                'captureFiles': [images[bp]['file'] for bp in BREAKPOINTS if bp in images],
                'states': ['default'], 'breakpoints': bp_evidence, 'comparison': comparison},
            'assertions': {
                'component': {'verdict': 'pass' if build.get('componentId') and block_pass else 'fail',
                              'componentId': build.get('componentId'), 'geometry': geometry},
                'variables': {'verdict': 'pass' if variable_count == len(tree.get('variables') or {}) and
                              (not responsive or (bound > 0 and build.get('collectionId'))) else 'fail',
                              'count': variable_count, 'collectionId': build.get('collectionId')},
                'bindings': {'verdict': 'fail' if fell_back else 'pass',
                             'bound': bound, 'literal': literal, 'fellBack': fell_back},
                'image-upload': {'verdict': 'pass' if image_pass else 'fail',
                                 'statuses': image_statuses, 'expected': image_count,
                                 'failed': image_failures},
                'breakpoint-evidence': {'verdict': 'fail' if missing_breakpoints else 'pass',
                                        'missing': missing_breakpoints},
                'evidence-upload': {'verdict': 'pass' if len(statuses) == len(ids) == 3 and
                                    all(s == 200 for s in statuses) else 'fail', 'statuses': statuses},
                'visual-comparison': {'verdict': comparison.get('verdict', 'not-run'),
                                      'breakpoints': comparison.get('breakpoints', {})}},
            'sourceRef': comp.get('sourceRef'), 'sourceHash': source_hash,
            'sourceHashBasis': hash_basis,
        }
        path = project / 'builds' / (cid.replace(':', '__').replace('/', '_') + '.json')
        write_json(path, record)
        outputs.append(('build:' + cid, path, 'build-record', 'components'))
    index = index_rows.build_index(list(components.values()), str(project / 'builds'), 50, 10, plans)
    index['standardVersion'] = STANDARD_VERSION
    index_path = project / 'index.json'
    write_json(index_path, index)
    outputs.append(('index', index_path, 'index', 'index'))
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    args = parser.parse_args()
    project = Path(args.project).resolve()
    outputs = generate(project)
    registered, invalid = [], {}
    for name, path, kind, phase in outputs:
        errors = validate(load_json(path), kind, str(path))
        if errors:
            # One component's gap (a missing breakpoint, an unmeasured master) must not hide
            # every other receipt: report it, register the rest, and exit non-zero.
            invalid[name] = errors
            continue
        cmd = [sys.executable, str(Path(__file__).with_name('workflow.py')), 'register',
               '--project', str(project), '--name', name, '--path', str(path), '--kind', kind]
        if phase:
            cmd += ['--phase', phase]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
        registered.append(name)
    print(json.dumps({'registered': registered, 'invalid': invalid}, indent=1))
    return 1 if invalid else 0


if __name__ == '__main__':
    raise SystemExit(main())
