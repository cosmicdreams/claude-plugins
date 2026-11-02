#!/usr/bin/env python3
"""Read-only adventure schema and exact-source collision checks."""
import argparse
import datetime
import json
from pathlib import Path
import yaml
from runtime import canonical


def frontmatter(path):
    text = path.read_text()
    if not text.startswith('---\n'):
        return {}
    return yaml.safe_load(text.split('---', 2)[1]) or {}


def identity(source):
    return canonical(source) if source.startswith(('http://', 'https://')) else source


def matches(vault, source):
    key = identity(source)
    return [p.name for p in sorted((vault / 'Next-Adventures').glob('*.md'))
            if p.name != 'README.md' and isinstance(frontmatter(p).get('source'), str)
            and identity(frontmatter(p)['source']) == key]


def check(vault):
    issues, sources = [], {}
    for path in sorted((vault / 'Next-Adventures').glob('*.md')):
        if path.name == 'README.md':
            continue
        try:
            data = frontmatter(path)
            errors = []
            for field in ('type', 'title', 'summary', 'date', 'status', 'source', 'tags'):
                if not data.get(field):
                    errors.append('missing ' + field)
            if data.get('type') != 'adventure':
                errors.append('legacy or invalid type')
            status = data.get('status')
            if status not in ('idea','shaped','ready','running','done','parked','killed'):
                errors.append('legacy or invalid status')
            for field in ('payoff', 'tier'):
                if field in data and (type(data[field]) is not int or not 1 <= data[field] <= 5):
                    errors.append('invalid ' + field)
            if 'cost' in data and data['cost'] not in ('S','M','L'):
                errors.append('invalid cost')
            if status in ('shaped','ready'):
                for field in ('payoff','cost','first_step'):
                    if not data.get(field):errors.append('missing ' + field)
            if status == 'parked' and not data.get('revisit_when'):
                errors.append('missing revisit_when')
            if data.get('date'):
                datetime.date.fromisoformat(str(data['date']))
            if data.get('tags') and not isinstance(data['tags'], list):
                errors.append('tags must be a list')
            source = data.get('source')
            if isinstance(source, str):
                sources.setdefault(identity(source), []).append(path.name)
            issues.extend({'file': path.name, 'warning': error} for error in errors)
        except (ValueError, AttributeError, TypeError, yaml.YAMLError) as exc:
            issues.append({'file':path.name, 'warning':str(exc)})
    collisions = {u:p for u,p in sources.items() if len(p) > 1}
    return {'issues':issues, 'exact_source_collisions':collisions}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault', type=Path, required=True)
    parser.add_argument('--source', help='Find exact canonical URL or string-exact non-URL source matches')
    args = parser.parse_args()
    if args.source is not None:
        print(json.dumps({'matches': matches(args.vault, args.source)}, indent=2))
        raise SystemExit(0)
    result = check(args.vault)
    print(json.dumps(result, indent=2))
    raise SystemExit(bool(result['issues'] or result['exact_source_collisions']))
