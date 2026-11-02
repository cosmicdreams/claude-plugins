#!/usr/bin/env python3
"""Hold the funnel lock across agent tool turns; accept line-delimited JSON commands."""
import argparse
import datetime as dt
import json
from pathlib import Path
import sys

from runtime import atomic_json, locked, read_json


def transition(vault, index, command):
    action = command['action']
    if action == 'status':
        return index
    record = index['urls'][command['url']]
    if action == 'claim':
        if record['state'] not in ('collected', 'failed'):
            raise ValueError('item is not claimable')
        if not any((vault / p).is_file() and p.startswith('Raw/Inbox/') for p in record['paths']):
            raise ValueError('raw item is missing')
        record.update(state='processing', started_at=dt.datetime.now(dt.timezone.utc).isoformat())
    elif action == 'finish':
        if record['state'] != 'processing':
            raise ValueError('claim before finishing')
        pages = command['pages']
        if not pages or not all(isinstance(p, str) and not Path(p).is_absolute()
                                and '..' not in Path(p).parts and (vault / p).is_file() for p in pages):
            raise ValueError('finish requires existing vault-relative pages')
        manifest_path = vault / 'Raw/.manifest.json'
        manifest = read_json(manifest_path, {'entries': {}})
        for path in record['paths']:
            entry = manifest.setdefault('entries', {}).setdefault(path, {})
            entry.update(ingested_at=dt.datetime.now(dt.timezone.utc).isoformat(), wiki_pages=pages)
        # Manifest first: a crash leaves processing, never a falsely completed item.
        atomic_json(manifest_path, manifest)
        record.update(state='ingested', pages=pages)
    elif action == 'fail':
        if record['state'] != 'processing':
            raise ValueError('claim before failing')
        record.update(state='failed', error=str(command.get('error', 'interrupted'))[:1000])
    else:
        raise ValueError('unknown action')
    atomic_json(vault / 'Raw/.url-index.json', index)
    return record


def session(vault, source=sys.stdin, output=sys.stdout):
    with locked(vault):
        index = read_json(vault / 'Raw/.url-index.json')
        if not index or index.get('version') != 1:
            raise ValueError('migration required')
        for record in index['urls'].values():
            if record['state'] == 'processing':
                record.update(state='failed', error='interrupted; inspect existing pages before retry')
        atomic_json(vault / 'Raw/.url-index.json', index)
        print(json.dumps({'ready': True, 'conflicts': index.get('conflicts', [])}), file=output, flush=True)
        for line in source:
            try:
                command = json.loads(line)
                if command.get('action') == 'quit':
                    break
                result = transition(vault, index, command)
                print(json.dumps({'ok': True, 'result': result}), file=output, flush=True)
            except (ValueError, KeyError, TypeError) as exc:
                print(json.dumps({'ok': False, 'error': str(exc)}), file=output, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault', type=Path, required=True)
    session(parser.parse_args().vault)
