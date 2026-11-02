#!/usr/bin/env python3
"""Durable run ownership and one-shot transitions, independent of host stdin."""
import argparse
import datetime as dt
import json
from pathlib import Path
import time
import uuid

from runtime import atomic_json, locked, read_json


def run(vault, action, owner=None, item=None, pages=None, error=None):
    lease_path = vault / '_meta/ideas-funnel-owner.json'
    with locked(vault):
        lease = read_json(lease_path, {})
        if action == 'acquire':
            current = read_json(vault / 'Raw/.url-index.json', {})
            if current.get('version') != 1 or 'items' not in current:
                raise ValueError('file-index migration required')
            if lease.get('owner'):
                raise ValueError('run already owned; verify prior writer stopped before explicit recovery')
            owner = uuid.uuid4().hex
            lease = {'owner': owner, 'started_at': time.time(), 'heartbeat': time.time()}
            atomic_json(lease_path, lease)
            return lease
        if not owner or lease.get('owner') != owner:
            raise ValueError('wrong or missing run owner')
        if action == 'recover':
            # No automatic expiry: a paused model can still resume. An explicit
            # recovery requires the operator to have stopped its run/delegates.
            index = read_json(vault / 'Raw/.url-index.json', {})
            for record in index.get('items', {}).values():
                if record['state'] == 'processing':
                    record.update(state='failed', error='interrupted; inspect existing pages before retry')
            atomic_json(vault / 'Raw/.url-index.json', index)
            atomic_json(lease_path, {})
            return {'recovered': True}
        lease['heartbeat'] = time.time()
        atomic_json(lease_path, lease)
        index_path = vault / 'Raw/.url-index.json'
        index = read_json(index_path)
        if not index or index.get('version') != 1 or 'items' not in index:
            raise ValueError('file-index migration required')
        if action == 'status':
            return {'lease': lease, 'index': index}
        if action == 'close':
            if any(r['state'] == 'processing' for r in index['items'].values()):
                raise ValueError('release or finish claims before closing')
            atomic_json(lease_path, {})
            return {'closed': True}
        if action == 'index':
            if not isinstance(item, str) or not item.startswith('Raw/Inbox/') or '..' in Path(item).parts:
                raise ValueError('index requires a vault-relative inbox file')
            path = vault / item
            if not path.is_file() or path.name.lower() == 'readme.md':
                raise ValueError('raw item is missing or is a placeholder')
            if item not in index['items']:
                from pull import urls
                identities = sorted(urls(path))
                index['items'][item] = {'urls': identities, 'state': 'collected'}
                for url in identities:
                    entry = index['urls'].setdefault(url, {'state': 'collected', 'paths': []})
                    if item not in entry['paths']:
                        entry['paths'].append(item)
                atomic_json(index_path, index)
            return index['items'][item]
        record = index['items'][item]
        if action == 'claim':
            if record['state'] not in ('collected', 'failed'):
                raise ValueError('item is not claimable')
            if any(c['url'] in record['urls'] for c in index.get('conflicts', [])):
                raise ValueError('resolve conflicting source identities before claiming')
            path = vault / item
            if not item.startswith('Raw/Inbox/') or '..' in Path(item).parts or not path.is_file():
                raise ValueError('raw item is missing')
            record.update(state='processing', prior_state=record['state'], started_at=dt.datetime.now(dt.timezone.utc).isoformat())
        else:
            if record['state'] != 'processing':
                raise ValueError('claim before transition')
            if action == 'finish':
                if not pages or not all(isinstance(p, str) and not Path(p).is_absolute()
                                        and '..' not in Path(p).parts and (vault / p).is_file() for p in pages):
                    raise ValueError('finish requires existing vault-relative pages')
                manifest_path = vault / 'Raw/.manifest.json'
                manifest = read_json(manifest_path, {'entries': {}})
                entry = manifest.setdefault('entries', {}).setdefault(item, {})
                entry.update(ingested_at=dt.datetime.now(dt.timezone.utc).isoformat(), wiki_pages=pages)
                atomic_json(manifest_path, manifest)
                record.update(state='ingested', pages=pages)
                for url in record['urls']:
                    index['urls'][url]['state'] = 'ingested'
            elif action == 'release':
                record['state'] = record.pop('prior_state', 'collected')
            elif action == 'fail':
                record.update(state='failed', error=str(error or 'item failed')[:1000])
            else:
                raise ValueError('unknown action')
        atomic_json(index_path, index)
        return record


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault', type=Path, required=True)
    parser.add_argument('action', choices=['acquire','status','index','claim','finish','fail','release','close','recover'])
    parser.add_argument('--owner')
    parser.add_argument('--item')
    parser.add_argument('--pages', nargs='+')
    parser.add_argument('--error')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.vault, args.action, args.owner, args.item, args.pages, args.error), indent=2))
    except (ValueError, KeyError, TypeError, OSError, RuntimeError) as exc:
        parser.exit(1, str(exc) + '\n')
