"""Read-only phase-three oracle; every output is confined to an absolute /tmp folder."""
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from detect import detect
from artifact_contracts import write_json
from plan import plan_component
from plan_variables import build
from extract_drupal_rendering import extract as render

def main():
    request = json.loads(Path(sys.argv[1]).read_text())
    out = Path(request['output']).resolve()
    if not str(out).startswith('/private/tmp/') and not str(out).startswith('/tmp/'):
        raise ValueError('oracle output must be under /tmp')
    out.mkdir(parents=True, exist_ok=True)
    root = request['root']
    timings = {}
    def save(name, operation):
        started = time.perf_counter()
        result = operation()
        write_json(out / (name + '.json'), result)
        timings[name] = time.perf_counter() - started
        return result
    stage = request.get('stage', 'core')
    if stage == 'core':
        detection = save('detection', lambda: detect(root))
        component_strategy = request['decisions']['componentSource']
        token_strategy = request['decisions']['tokenSource']
        config = request['decisions'].get('sitestudioConfig', (detection.get('siteStudio') or {}).get('configDir'))
        component_modules = {'canvas': 'extract_canvas', 'drupal-authoring': 'extract_drupal_authoring',
                             'paragraphs': 'extract_paragraphs', 'sdc': 'extract_sdc', 'sitestudio': 'extract_sitestudio'}
        token_modules = {'css-custom-properties': 'extract_tokens_cssvars', 'sass-source': 'extract_tokens_sass',
                         'sass-sourcemap': 'extract_tokens_sourcemap', 'sitestudio-styles': 'extract_tokens_sitestudio'}
        c = __import__(component_modules[component_strategy]).extract
        t = __import__(token_modules[token_strategy]).extract
        components = save('components', lambda: c(root, config) if component_strategy == 'sitestudio' else c(root))
        tokens = save('tokens', lambda: t(root, config) if token_strategy == 'sitestudio-styles' else t(root))
        rendering = save('render-evidence', lambda: render(root, components)) if component_strategy == 'drupal-authoring' else {}
        captures = request.get('captures') or {}
        plans = save('plan', lambda: {'standardVersion': request.get('standardVersion', '3.0.0'),
                                     'generatedAt': 'oracle-clock', 'maxVariants': 64,
                                     'plans': [plan_component(c, (rendering.get('items') or {}).get(c['id']),
                                                              captures.get(c['id'])) for c in components['components']]})
        save('variable-plan', lambda: build(tokens))
    elif stage == 'usage':
        components = json.loads((out / 'components.json').read_text())
        rendering = json.loads((out / 'render-evidence.json').read_text()) if (out / 'render-evidence.json').is_file() else None
        if request['decisions']['usageSource'] == 'canvas-db':
            from extract_canvas_usage import extract, merge_canvas_usage as merge
            usage = save('usage', lambda: extract(root, components, request.get('ddevProject')))
        else:
            from extract_drupal_usage import extract, merge_usage as merge
            usage = save('usage', lambda: extract(root, components, request.get('ddevProject'), rendering))
        save('enriched-components', lambda: merge(components, usage))
    elif stage == 'network':
        from published_pages import addresses, fetch_pages, site_config, _main
        from find_rendered_components import scan
        from extract_voice import build_voice
        from extract_compositions import build_compositions
        base = request['baseUrl']
        components = json.loads((out / 'components.json').read_text())
        config_root, name, front = site_config(out)
        paths = save('published-addresses', lambda: {'paths': addresses(config_root, front, 3)})['paths']
        pages = fetch_pages(base, paths)
        # Preserve the live response snapshots as oracle inputs for diagnosing transient page differences.
        save('published-pages', lambda: {'pages': pages})
        write_json(out / 'network-responses.json', {'pages': pages})
        save('rendered-components', lambda: dict(zip(('components', 'source'), scan(base, root, components, 3))))
        save('voice', lambda: build_voice(pages, name, 'oracle-clock', front))
        save('compositions', lambda: build_compositions(pages))
    else:
        raise ValueError('unknown stage ' + stage)
    write_json(out / ('timings-' + stage + '.json'), timings)

if __name__ == '__main__':
    main()
