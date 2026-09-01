#!/usr/bin/env python3
"""Find a verified, anonymously-reachable page address for every component.

The specification file that shipped with the AHRI library listed live example paths, and
they could not be trusted: two were behind login and at least one named a page the
component was not on. So this does not read claimed addresses - it crawls the public site
as an anonymous visitor and records where each component actually rendered.

That the fetch is anonymous is the whole point. A page a designer cannot open is not an
example, so every recorded address carries the status code that proves it.

Placement counts come out of the same pass for free, which is the `usage` plug point of
references/model.md. They are a LOWER BOUND over the pages actually scanned - never
present them as a site total unless the whole sitemap was walked.

    python3 find_examples.py https://www.ahrinet.org --strategy sitestudio --limit 200
    python3 find_examples.py https://www.pncb.org --strategy paragraphs \
        --components components.json --merge > components.enriched.json
"""
import argparse, gzip, json, re, sys, time, urllib.error, urllib.request
from collections import defaultdict
from urllib.parse import urljoin, urlparse

UA = 'design-lab/0.2 (+component library extraction; contact site owner)'

# How a rendered instance names its component in the markup.
#   Site Studio emits  class="coh-ce-cpt_text-280a9f1d"  - machine name, then an
#   instance hash. The machine name itself contains underscores, the hash is hex, so the
#   split has to be anchored on the LAST hyphen group being hex.
#   Drupal's paragraph templates emit  class="paragraph--type--full-width-row"  with
#   underscores in the bundle name converted to hyphens - so the extracted name needs
#   converting back before it will match a bundle machine name.
MARKERS = {
    'sitestudio': re.compile(r'\bcoh-ce-([a-z0-9_]+)-[0-9a-f]{6,}\b'),
    'paragraphs': re.compile(r'\bparagraph--type--([a-z0-9-]+)\b'),
}

# A class attribute, so the two Site Studio markers can be read from the SAME element.
CLASS_ATTR = re.compile(r'class="([^"]*)"')
# The per-placement identifier. This is the one that counts.
INSTANCE = re.compile(r'\bcoh-component-instance-([0-9a-fA-F-]{8,})')


def normalise(strategy, raw):
    """Marker capture -> component machine name as it appears in configuration."""
    return raw.replace('-', '_') if strategy == 'paragraphs' else raw


def canonical(url, base_host):
    """Sitemaps often advertise the hosting origin rather than the public hostname.
    AHRI's sitemap returns ahridrupalhosting.prod.acquia-sites.com, so an address recorded
    straight from it sends a designer to an origin host that may be blocked or may serve a
    different cache. Rewrite onto the host the caller actually asked for."""
    u = urlparse(url)
    if u.netloc and base_host and u.netloc != base_host:
        return u._replace(netloc=base_host).geturl(), 1
    return url, 0


def fetch(url, timeout=20):
    """Anonymous GET. Returns (status, body) - never raises, never sends a cookie."""
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            if r.headers.get('Content-Encoding') == 'gzip' or raw[:2] == b'\x1f\x8b':
                raw = gzip.decompress(raw)
            return r.status, raw.decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception as e:                      # DNS, timeout, TLS, redirect loop
        return 0, str(e)


def sitemap_urls(base, limit, delay):
    """Walk sitemap.xml, following one level of sitemap index. Falls back to the root."""
    seen, queue, out = set(), [urljoin(base, '/sitemap.xml')], []
    while queue and len(out) < limit:
        sm = queue.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        status, body = fetch(sm)
        if status != 200:
            continue
        locs = re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', body)
        # A sitemap index points at more sitemaps; a urlset points at pages.
        if '<sitemapindex' in body:
            queue.extend(locs)
        else:
            out.extend(locs)
        time.sleep(delay)
    if not out:
        out = [base]
        print('no sitemap found at %s - falling back to the base address alone. Pass '
              '--urls to supply a list.' % urljoin(base, '/sitemap.xml'), file=sys.stderr)
    return out[:limit]


def scan_sitestudio(body):
    """Return (presence, placements) for one page.

    Two markers, and conflating them is the trap. Site Studio stamps
    `coh-ce-<name>-<hash>` on EVERY styled element of a component template - the theme's
    cpt_content_card_0 template carries eight different hashes across its root, image,
    text wrapper, heading and paragraph. So the hash identifies an element of the
    definition, not a placement, and counting distinct hashes reports a number that never
    changes no matter how often the component is placed.

    `coh-component-instance-<uuid>` is the per-placement identifier. Pairing the two within
    a single class attribute gives the real count: distinct instance uuids per component.
    """
    presence, instances = set(), defaultdict(set)
    for attr in CLASS_ATTR.finditer(body):
        classes = attr.group(1)
        names = MARKERS['sitestudio'].findall(classes)
        if not names:
            continue
        presence.update(names)
        uuid = INSTANCE.search(classes)
        if uuid:
            # The root element of a placement carries both markers.
            instances[names[0]].add(uuid.group(1))
    return presence, {k: len(v) for k, v in instances.items()}


def scan_paragraphs(body):
    """Drupal emits paragraph--type--<bundle> once per rendered paragraph, so occurrences
    are already placements."""
    presence, counts = set(), defaultdict(int)
    for m in MARKERS['paragraphs'].finditer(body):
        name = normalise('paragraphs', m.group(1))
        presence.add(name)
        counts[name] += 1
    return presence, dict(counts)


def crawl(urls, strategy, delay, base_host):
    scan = scan_sitestudio if strategy == 'sitestudio' else scan_paragraphs
    placements = defaultdict(int)
    examples = defaultdict(list)
    scanned, failed, rehosted = 0, [], 0
    for url in urls:
        url, changed = canonical(url, base_host)
        rehosted += changed
        status, body = fetch(url)
        if status != 200:
            failed.append({'url': url, 'status': status})
            time.sleep(delay)
            continue
        scanned += 1
        presence, counts = scan(body)
        for name in presence:
            n = counts.get(name, 0)
            placements[name] += n
            examples[name].append({
                'url': url,
                'marker': ('coh-ce-%s-' % name) if strategy == 'sitestudio'
                          else 'paragraph--type--%s' % name.replace('_', '-'),
                'instancesOnPage': n,
                'status': 200, 'anonymous': True})
        time.sleep(delay)
    return placements, examples, scanned, failed, rehosted


def tier(n, counts):
    """Coarse usage band. Thirds of the ranked distribution, not absolute thresholds -
    a 43-component site and a 146-component site have very different absolute counts."""
    if not counts:
        return 'unknown'
    ranked = sorted(counts, reverse=True)
    hi = ranked[max(0, len(ranked) // 3 - 1)]
    lo = ranked[max(0, (2 * len(ranked)) // 3 - 1)]
    return 'high' if n >= hi else ('medium' if n >= lo else 'low')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('base', help='site root, e.g. https://www.ahrinet.org')
    ap.add_argument('--strategy', required=True, choices=sorted(MARKERS))
    ap.add_argument('--limit', type=int, default=200, help='max pages to fetch')
    ap.add_argument('--delay', type=float, default=0.5, help='seconds between requests')
    ap.add_argument('--urls', help='file of addresses, one per line; skips the sitemap')
    ap.add_argument('--components', help='components.json, to align ids and report misses')
    ap.add_argument('--merge', action='store_true',
                    help='emit the full components.json with usage merged in')
    ap.add_argument('--examples-per-component', type=int, default=3)
    a = ap.parse_args()

    if a.urls:
        urls = [l.strip() for l in open(a.urls) if l.strip()]
    else:
        urls = sitemap_urls(a.base, a.limit, a.delay)

    base_host = urlparse(a.base).netloc
    placements, examples, scanned, failed, rehosted = crawl(
        urls[:a.limit], a.strategy, a.delay, base_host)
    counts = list(placements.values())

    usage = {}
    for name, n in placements.items():
        best = sorted(examples[name], key=lambda e: -e['instancesOnPage'])
        usage[name] = {'placements': n, 'tier': tier(n, counts),
                       'examples': best[:a.examples_per_component]}

    doc = None
    unseen = []
    if a.components:
        doc = json.load(open(a.components))
        known = {c['id'] for c in doc['components']}
        unseen = sorted(known - set(usage))
        for c in doc['components']:
            u = usage.get(c['id'])
            c['usage'] = u or {'placements': 0, 'tier': 'unobserved', 'examples': [],
                               'note': 'not seen on any of the %d pages scanned - it may be '
                                       'unused, or only on pages behind login' % scanned}

    meta = {'base': a.base, 'strategy': a.strategy, 'pagesScanned': scanned,
            'pagesFailed': failed[:20], 'pagesFailedCount': len(failed),
            'placementsAreLowerBound': True,
            'addressesRehostedOnto': base_host if rehosted else None,
            'addressesRehostedCount': rehosted,
            'componentsSeen': len(usage), 'componentsUnseen': unseen}

    if a.merge and doc:
        doc.setdefault('usageScan', {}).update(meta)
        print(json.dumps(doc, indent=2))
    else:
        print(json.dumps({'usageScan': meta, 'usage': usage}, indent=2))

    print('scanned %d page(s), %d failed; %d component(s) observed' %
          (scanned, len(failed), len(usage)), file=sys.stderr)
    if unseen:
        print('%d component(s) never observed: %s' %
              (len(unseen), ', '.join(unseen[:10]) + (' ...' if len(unseen) > 10 else '')),
              file=sys.stderr)
