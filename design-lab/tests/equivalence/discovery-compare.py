"""Strict parsed-JSON comparison, with Python integers retaining all their digits."""
import json
import sys
from pathlib import Path

IGNORED = ['/generatedAt', '/components/*/usage/measuredAt',
           '/usage/*/examples/*/verifiedAt', '/components/*/usage/examples/*/verifiedAt']

def normalize(value, path=()):
    if isinstance(value, list):
        return [normalize(item, path + (str(i),)) for i, item in enumerate(value)]
    if isinstance(value, dict):
        def keep(key):
            if not path and key == 'generatedAt':
                return False
            if len(path) == 3 and path[0] == 'components' and path[2] == 'usage' and key == 'measuredAt':
                return False
            if key == 'verifiedAt' and ((len(path) == 4 and path[0] == 'usage' and path[2] == 'examples') or
                                        (len(path) == 5 and path[0] == 'components' and path[2:4] == ('usage', 'examples'))):
                return False
            return True
        return {key: normalize(item, path + (key,)) for key, item in value.items() if keep(key)}
    return value

def differences(a, b, path=''):
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for key in sorted(set(a) | set(b)):
            if key not in a or key not in b:
                out.append(path + '/' + key + ': missing key')
            else:
                out.extend(differences(a[key], b[key], path + '/' + key))
        return out
    if isinstance(a, list) and isinstance(b, list):
        out = [] if len(a) == len(b) else [path + ': array lengths differ']
        for i, (aa, bb) in enumerate(zip(a, b)):
            out.extend(differences(aa, bb, path + '/' + str(i)))
        return out
    return [] if a == b else [path + ': %r != %r' % (a, b)]

def main():
    root = Path(sys.argv[1]).resolve()
    if not str(root).startswith(('/tmp/', '/private/tmp/')):
        raise ValueError('only scratch runs under /tmp may be compared')
    manifest_path = Path(sys.argv[sys.argv.index('--manifest') + 1]) if '--manifest' in sys.argv else Path(__file__).with_name('discovery-artifacts.json')
    manifests = json.loads(manifest_path.read_text())
    manifest = manifests['live' if '--live' in sys.argv else 'core']
    if not manifest or any(not artifacts for artifacts in manifest.values()):
        raise ValueError('expected-artifact manifest must be non-empty')
    results = []
    for site, artifacts in sorted(manifest.items()):
        folder = root / site
        for artifact in artifacts:
            paths = [folder / arm / (artifact + '.json') for arm in ('python', 'ts')]
            missing = [str(path.relative_to(root)) for path in paths if not path.is_file()]
            if missing:
                results.append({'site': site, 'artifact': artifact, 'status': 'mismatch', 'differences': ['missing required artifact: ' + path for path in missing]})
                continue
            try:
                a, b = [normalize(json.loads(path.read_text())) for path in paths]
                diff = differences(a, b)
            except Exception as error:
                diff = ['invalid artifact: ' + str(error)]
            results.append({'site': site, 'artifact': artifact,
                            'status': 'mismatch' if diff else 'match', 'differences': diff[:50]})
    result = {'ignoredFields': IGNORED, 'comparisons': len(results), 'results': results}
    target = root / ('strict-live-summary.json' if '--live' in sys.argv else 'strict-summary.json')
    target.write_text(json.dumps(result, indent=2) + '\n')
    print('%d comparisons, %d mismatches' % (len(results), sum(row['status'] == 'mismatch' for row in results)))
    return int(any(row['status'] == 'mismatch' for row in results))

if __name__ == '__main__':
    sys.exit(main())
