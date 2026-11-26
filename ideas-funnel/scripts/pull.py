#!/usr/bin/env python3
"""Bounded feed collection. Migration is a dry-run unless --apply is explicit."""
import argparse
import datetime as dt
import hashlib
import html
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request
from urllib.parse import urljoin, urlsplit
import xml.etree.ElementTree as ET

from runtime import atomic_json, canonical, hub, hubs, locked, read_json, require_idle

LIMIT = 2 * 1024 * 1024
EXCERPT_LIMIT = 3000
URL = re.compile(r'https?://[^\s<>"\]\)]+')
HTML_TAG = re.compile(r'<[^>]+>')
WHITESPACE = re.compile(r'\s+')
CONTENT_NS = '{http://purl.org/rss/1.0/modules/content/}'
ATOM_NS = '{http://www.w3.org/2005/Atom}'


def clean_excerpt(raw, limit=EXCERPT_LIMIT):
    if not raw or not isinstance(raw, str):
        return ''
    text = HTML_TAG.sub(' ', html.unescape(raw))
    text = WHITESPACE.sub(' ', text).strip()
    if len(text) > limit:
        text = text[:limit].rstrip() + '...'
    return text


def is_opaque_redirect(url):
    p = urlsplit(url)
    host = (p.hostname or '').lower()
    return host == 'news.google.com' and p.path.startswith('/rss/articles/')


def urls(path, extra=()):
    # Only identity fields or a bare URL line before untrusted feed excerpts:
    # article/excerpt links are not identities. Hubs never identify a source.
    result = set()
    in_fence = False
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if stripped == '## Feed excerpt (untrusted)':
            break
        if stripped.startswith('```'):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if re.match(r'^(?:url|source|origin):[ \t]*', line) or line.startswith(('http://', 'https://')):
            for value in URL.findall(line):
                try:
                    key = canonical(value.strip("'"))
                except ValueError:
                    continue
                if not hub(key, extra):
                    result.add(key)
    return result


def migrate(vault):
    index = {'version': 1, 'urls': {}, 'items': {}, 'conflicts': []}
    extra = hubs(vault)
    for folder in ('Raw/Inbox', 'Archive/Raw', 'Sources'):
        for path in sorted((vault / folder).rglob('*.md')):
            identities = urls(path, extra)
            relative = str(path.relative_to(vault))
            if folder != 'Sources' and path.name.lower() != 'readme.md':
                index['items'][relative] = {'urls': sorted(identities),
                    'state': 'ingested' if folder == 'Archive/Raw' else 'collected'}
            for url in identities:
                entry = index['urls'].setdefault(url, {'state': 'collected', 'paths': []})
                entry['paths'].append(str(path.relative_to(vault)))
                if folder in ('Archive/Raw', 'Sources'):
                    entry['state'] = 'ingested'
    manifest = read_json(vault / 'Raw/.manifest.json', {})
    for key, entry in manifest.get('entries', {}).items():
        if isinstance(entry, dict):
            for field in ('url', 'source', 'origin'):
                value = entry.get(field)
                if isinstance(value, str) and value.startswith(('http://', 'https://')):
                    url = canonical(value)
                    if hub(url, extra):
                        continue
                    record = index['urls'].setdefault(url, {'state': 'collected', 'paths': []})
                    if key not in record['paths']:
                        record['paths'].append(key)
                    if entry.get('ingested_at'):
                        record['state'] = 'ingested'
    for path, record in index['items'].items():
        if manifest.get('entries', {}).get(path, {}).get('ingested_at'):
            record['state'] = 'ingested'
        elif record['urls'] and all(index['urls'][u]['state'] == 'ingested' for u in record['urls']):
            record['state'] = 'ingested'
    for url, entry in index['urls'].items():
        sources = [p for p in entry['paths'] if p.startswith('Sources/')]
        if len(sources) > 1:
            index['conflicts'].append({'url': url, 'sources': sources})
    return index


def prune_hubs(index, extra=()):
    """Remove hub URLs from an existing index without touching any run state."""
    removed = sorted(u for u in index['urls'] if hub(u, extra))
    gone = set(removed)
    for url in removed:
        del index['urls'][url]
    for record in index['items'].values():
        record['urls'] = [u for u in record['urls'] if u not in gone]
    before = len(index.get('conflicts', []))
    index['conflicts'] = [c for c in index.get('conflicts', []) if c['url'] not in gone]
    return {'removed_urls': removed, 'conflicts_cleared': before - len(index['conflicts']),
            'conflicts_remaining': len(index['conflicts'])}


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        canonical(newurl)  # reject non-http redirects and credentials
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url):
    canonical(url)
    headers = {
        'User-Agent': 'ideas-funnel/3.0',
        'Accept': 'application/rss+xml, application/atom+xml, application/json, text/xml;q=0.9, */*;q=0.8',
    }
    for attempt in range(2):
        try:
            with urllib.request.build_opener(Redirects()).open(
                    urllib.request.Request(url, headers=headers), timeout=15) as response:
                deadline = time.monotonic() + 30
                chunks, size = [], 0
                while size <= LIMIT:
                    if time.monotonic() >= deadline:
                        raise TimeoutError('feed deadline exceeded')
                    chunk = response.read1(min(65536, LIMIT + 1 - size))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    size += len(chunk)
                data = b''.join(chunks)
                if len(data) > LIMIT:
                    raise ValueError('feed exceeds 2 MiB')
                return data
        except (OSError, urllib.error.URLError):
            if attempt:
                raise
            time.sleep(1.0)


def parse_items(data, feed):
    if urlsplit(feed).hostname == 'hn.algolia.com':
        items = []
        for h in json.loads(data)['hits'][:100]:
            hn_url = 'https://news.ycombinator.com/item?id=' + str(h['objectID'])
            target = h.get('url') or hn_url
            title = h.get('title') or h.get('story_title') or ''
            parts = []
            if h.get('story_text'):
                parts.append(clean_excerpt(h['story_text']))
            meta = []
            if h.get('points') is not None:
                meta.append(f"points: {h['points']}")
            if h.get('num_comments') is not None:
                meta.append(f"comments: {h['num_comments']}")
            if h.get('url'):
                meta.append(f"discussion: {hn_url}")
            if meta:
                parts.append(' | '.join(meta))
            items.append((target, title, '\n\n'.join(p for p in parts if p)))
        return items
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('XML declarations are unsupported')
    root = ET.fromstring(data)
    result = []
    for item in list(root.findall('.//item')) + list(root.findall(f'{ATOM_NS}entry')):
        title = item.findtext('title') or item.findtext(f'{ATOM_NS}title') or ''
        link = item.findtext('link')
        if not link:
            link = next((n.get('href') for n in item.findall(f'{ATOM_NS}link')
                         if n.get('rel', 'alternate') == 'alternate'), None)
        raw_excerpt = (
            item.findtext(f'{CONTENT_NS}encoded')
            or item.findtext('description')
            or item.findtext(f'{ATOM_NS}content')
            or item.findtext(f'{ATOM_NS}summary')
            or ''
        )
        if link:
            result.append((urljoin(feed, link), title, clean_excerpt(raw_excerpt)))
    return result[:100]


def parse(data, feed):
    return [(url, title) for url, title, _ in parse_items(data, feed)]


def collect(vault, config, getter=fetch):
    index_path = vault / 'Raw/.url-index.json'
    index = read_json(index_path)
    if not index or index.get('version') != 1 or 'items' not in index:
        raise ValueError('review and apply migration before pulling')
    extra = hubs(vault)
    try:
        import yaml
    except ImportError:
        raise ValueError('use the configured virtual-environment Python; install requirements.txt') from None
    reports = []
    for domain in sorted(config.glob('*.yaml')):
        report = {'domain': domain.stem, 'created': 0, 'duplicates': 0, 'hubs': 0, 'redirects_skipped': 0, 'errors': []}
        reports.append(report)
        try:
            conf = yaml.safe_load(domain.read_text()) or {}
            if conf.get('active') is False:
                continue
            slug = conf['slug']
            if not isinstance(slug, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug):
                raise ValueError('unsafe domain slug')
            report['domain'] = slug
            feeds = conf.get('feeds') or {}
            rss, api = feeds.get('rss') or [], feeds.get('api') or []
            positive, negative = feeds.get('keywords') or [], feeds.get('exclude_keywords') or []
            if not all(isinstance(v, list) and all(isinstance(x, str) for x in v) for v in (rss, api, positive, negative)):
                raise ValueError('feed/keyword fields must be lists of strings')
            cap = min(100, max(0, int((conf.get('pull') or {}).get('max_items', 15))))
            if feeds.get('web_search'):
                report['errors'].append('web_search unsupported: configure an explicit RSS search feed; no provider credentials inferred')
            configured = rss + api
            if len(configured) > 20:
                report['errors'].append('feed cap: only first 20 endpoints attempted')
        except (OSError, ValueError, KeyError, TypeError, AttributeError, yaml.YAMLError) as exc:
            report['errors'].append('domain configuration: ' + str(exc))
            continue
        for feed in configured[:20]:
            try:
                if feed in api and urlsplit(feed).hostname != 'hn.algolia.com':
                    raise ValueError('unsupported API provider')
                for url, title, excerpt in parse_items(getter(feed), feed):
                    try:
                        key = canonical(url)
                    except (ValueError, TypeError) as exc:
                        report['errors'].append('item URL: ' + str(exc))
                        continue
                    if is_opaque_redirect(key):
                        report['redirects_skipped'] += 1
                        continue
                    if hub(key, extra):
                        report['hubs'] += 1
                        continue
                    if key in index['urls']:
                        report['duplicates'] += 1
                        continue
                    if any(str(w).lower() in title.lower() for w in negative):
                        continue
                    if positive and not any(str(w).lower() in title.lower() for w in positive):
                        continue
                    if report['created'] >= cap:
                        break
                    path = vault / 'Raw/Inbox' / slug / (hashlib.sha256(key.encode()).hexdigest() + '.md')
                    path.parent.mkdir(parents=True, exist_ok=True)
                    # Exclusive creation makes a crash between raw write and index save retryable.
                    if not path.exists():
                        body = ('---\nurl: ' + json.dumps(key) + '\nstatus: collected\n---\n\n'
                                + '# Untrusted feed data\n\n' + json.dumps(title) + '\n')
                        if excerpt:
                            safe_excerpt = re.sub(r'`{4,}', '```', excerpt)
                            body += '\n## Feed excerpt (untrusted)\n\n````text\n' + safe_excerpt + '\n````\n'
                        with path.open('x') as stream:
                            stream.write(body)
                    index.setdefault('items', {})[str(path.relative_to(vault))] = {'urls': [key], 'state': 'collected'}
                    index['urls'][key] = {'state': 'collected', 'paths': [str(path.relative_to(vault))]}
                    atomic_json(index_path, index)
                    report['created'] += 1
            except (OSError, ValueError, KeyError, TypeError, ET.ParseError) as exc:
                report['errors'].append(f'{feed}: {exc}')
    atomic_json(vault / '_meta/ideas-funnel-pull.json', {'domains': reports, 'at': dt.datetime.now(dt.timezone.utc).isoformat()})
    return reports


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--vault', type=Path, required=True)
    p.add_argument('--config', type=Path, default=Path.home() / '.config/ideas-funnel/domains')
    p.add_argument('--migrate', action='store_true')
    p.add_argument('--prune-hubs', action='store_true',
                   help='remove hub URLs from the existing index; dry-run unless --apply')
    p.add_argument('--apply', action='store_true')
    a = p.parse_args()
    if a.migrate and a.prune_hubs:
        p.error('choose --migrate or --prune-hubs')
    if not a.vault.is_dir() or not a.config.is_dir():
        p.error('vault and config must exist')
    with locked(a.vault):
        require_idle(a.vault)
        if a.migrate:
            result = migrate(a.vault)
            if a.apply:
                if (a.vault / 'Raw/.url-index.json').exists():
                    p.error('index already exists; do not overwrite run states')
                atomic_json(a.vault / 'Raw/.url-index.json', result)
        elif a.prune_hubs:
            index = read_json(a.vault / 'Raw/.url-index.json')
            if not index or index.get('version') != 1 or 'items' not in index:
                p.error('no migrated index to prune')
            result = prune_hubs(index, hubs(a.vault))
            if a.apply:
                atomic_json(a.vault / 'Raw/.url-index.json', index)
            result['applied'] = a.apply
        else:
            if a.apply:
                p.error('--apply is only for migration or --prune-hubs')
            result = collect(a.vault, a.config)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
