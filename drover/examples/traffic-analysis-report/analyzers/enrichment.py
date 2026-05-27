#!/usr/bin/env python3
"""
Enrichment analyzer — captures data classes the original analyzers did not
preserve, so they can be surfaced in the HTML report:

  1. AWS scraper URL profile (where it goes beyond /search)
  2. Search burn by named bot User-Agent (bingbot vs Googlebot vs scraper vs ...)
  3. Status-code cross-tab per hostname (is the origin.acmecorp.example.com restriction
     doing anything? What share of bypass traffic gets 200 vs 403 vs 404?)
  4. Bytes served by actor (bandwidth cost)
  5. Top 404-returning URLs (attack-scanner attack surface)

Writes enrichment.json next to this script.
"""
import gzip, glob, json, re, os
from collections import defaultdict, Counter

HERE = os.path.dirname(__file__)
LOGS = sorted(glob.glob(os.path.join(HERE, "..", "..", "<year>", "<month>", "*.prod.apache-access.log.gz")))

SCAN_PREFIXES = ("192.0.2.250",)

SCRAPER_UA = re.compile(r"X11; Linux x86_64.*Chrome/12[0-9]\.")

# Named-bot detection — return human-friendly name
NAMED_BOTS = [
    ("Bingbot",            re.compile(r"bingbot", re.I)),
    ("Googlebot",          re.compile(r"googlebot", re.I)),
    ("Facebook/Meta",      re.compile(r"facebookexternalhit|meta-externalagent", re.I)),
    ("Bytespider",         re.compile(r"bytespider", re.I)),
    ("AhrefsBot",          re.compile(r"ahrefsbot", re.I)),
    ("SemrushBot",         re.compile(r"semrush", re.I)),
    ("MJ12bot",            re.compile(r"mj12bot", re.I)),
    ("DotBot",             re.compile(r"dotbot", re.I)),
    ("PetalBot",           re.compile(r"petalbot", re.I)),
    ("GPTBot",             re.compile(r"gptbot", re.I)),
    ("ClaudeBot",          re.compile(r"claudebot", re.I)),
    ("CCBot",              re.compile(r"ccbot", re.I)),
    ("Amazonbot",          re.compile(r"amazonbot", re.I)),
    ("Applebot",           re.compile(r"applebot", re.I)),
    ("Yandex",             re.compile(r"yandex", re.I)),
    ("Baidu",              re.compile(r"baiduspider", re.I)),
    ("DuckDuckBot",        re.compile(r"duckduckbot", re.I)),
    ("Slurp (Yahoo)",      re.compile(r"slurp", re.I)),
    ("Other declared bot", re.compile(r"crawler|spider|bot/", re.I)),
]
SCRAPER_NAME = "AWS-scraper (X11 Linux Chrome/12x)"

AREA_SEARCH = re.compile(
    r"^/(north-terminal|south-terminal|east-station|west-station|"
    r"central-hub|transit)?/?search(/|\?|$)")
API_SEARCH = re.compile(r"^/api/v\d+/search/(?!manifest)")
FACET_Q = re.compile(r"[?&](f%5B|f\[)")

LINE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<ts>[^\]]+)\] '
    r'"(?P<method>\S+) (?P<path>\S+) [^"]*" (?P<status>\d{3}) (?P<bytes>\S+) '
    r'"[^"]*" "(?P<ua>[^"]*)"')
HOST_RX = re.compile(r' host=(\S+)')
FWD_RX = re.compile(r'forwarded_for="([^"]*)"')


def classify_named(ua, ip):
    """Return (actor_class, named_label)."""
    if any(ip.startswith(p) for p in SCAN_PREFIXES):
        return "scan", "monthly security scan"
    if SCRAPER_UA.search(ua):
        return "suspected_scraper", SCRAPER_NAME
    for name, rx in NAMED_BOTS:
        if rx.search(ua):
            return "declared_bot", name
    if not ua or ua == "-":
        return "no_ua", "(no UA)"
    return "human", "human"


def is_search(path):
    if AREA_SEARCH.match(path) or API_SEARCH.match(path):
        return True
    if FACET_Q.search(path):
        return True
    return False


def url_bucket(path):
    """Coarse URL bucket — first path segment, with a few exceptions broken out."""
    p = path.split("?", 1)[0]
    # specific high-value paths called out separately
    if p == "/" or p == "":
        return "/ (homepage)"
    if p.startswith("/_fragment"):
        return "/_fragment (BigPipe — uncacheable)"
    if p.startswith("/user"):
        return "/user (uncacheable user pages)"
    if p.startswith("/search"):
        return "/search"
    if AREA_SEARCH.match(path):
        m = AREA_SEARCH.match(path)
        area = m.group(1) or ""
        return f"/{area}/search" if area else "/search"
    if API_SEARCH.match(p):
        return "/api/v*/search/ (Solr)"
    if p.startswith("/api/v"):
        return "/api/v*/ (other JSON APIs)"
    if p.startswith("/sites/default/files") or p.startswith("/sites/all/files"):
        return "/sites/.../files (media)"
    if p.startswith("/sites/"):
        return "/sites/... (other)"
    if p.startswith("/themes/") or p.startswith("/core/") or p.startswith("/modules/"):
        return "/themes|core|modules (assets)"
    if p.startswith("/node/"):
        return "/node/* (legacy node URLs)"
    if p.startswith("/admin"):
        return "/admin/* (admin)"
    # fall back: top-level section
    segs = p.split("/")
    if len(segs) > 1 and segs[1]:
        return f"/{segs[1]}"
    return p or "(empty)"


# --- aggregations ---
scraper_url_counts = Counter()        # url-bucket -> count for the AWS scraper
scraper_url_bytes = Counter()         # url-bucket -> bytes for the AWS scraper
search_by_named_bot = Counter()        # name -> search hits
total_by_named_bot = Counter()         # name -> total hits
bytes_by_actor = Counter()             # actor -> bytes
hits_by_actor = Counter()              # actor -> hits
status_by_host = defaultdict(Counter)  # host -> {status -> n}
status_by_host_actor = defaultdict(lambda: defaultdict(Counter))  # host -> actor -> {status -> n}
fourohfour_urls = Counter()            # url-bucket -> 404 count
fourohfour_actors = Counter()          # actor -> 404 count

for fn in LOGS:
    with gzip.open(fn, "rt", errors="replace") as fh:
        for line in fh:
            m = LINE.match(line)
            if not m:
                continue
            d = m.groupdict()
            hm = HOST_RX.search(line)
            host = hm.group(1) if hm else "(missing)"
            fw = FWD_RX.search(line)
            ip = fw.group(1).split(",")[0].strip() if (fw and fw.group(1).strip()) else d["ip"]
            ua = d["ua"]
            path = d["path"]
            status = d["status"]
            try:
                bytes_ = int(d["bytes"]) if d["bytes"] != "-" else 0
            except ValueError:
                bytes_ = 0

            actor, name = classify_named(ua, ip)
            bucket = url_bucket(path)

            # 1. scraper URL profile
            if actor == "suspected_scraper":
                scraper_url_counts[bucket] += 1
                scraper_url_bytes[bucket] += bytes_

            # 2. named-bot breakdowns (include scraper for the comparison view)
            if actor in ("declared_bot", "suspected_scraper", "scan", "human"):
                total_by_named_bot[name] += 1
                if is_search(path):
                    search_by_named_bot[name] += 1

            # 3. status code cross-tabs
            status_by_host[host][status] += 1
            status_by_host_actor[host][actor][status] += 1

            # 4. bytes by actor
            bytes_by_actor[actor] += bytes_
            hits_by_actor[actor] += 1

            # 5. 404 attack surface
            if status == "404":
                fourohfour_urls[bucket] += 1
                fourohfour_actors[actor] += 1


out = {
    "window": "<YYYY-MM-DD>..<YYYY-MM-DD>",
    "scraper_url_profile": [
        {"bucket": b, "hits": n, "bytes": scraper_url_bytes[b]}
        for b, n in scraper_url_counts.most_common(25)
    ],
    "scraper_total_hits": sum(scraper_url_counts.values()),
    "scraper_total_bytes": sum(scraper_url_bytes.values()),
    "search_burn_by_named_bot": [
        {"name": n, "search_hits": c, "total_hits": total_by_named_bot[n]}
        for n, c in search_by_named_bot.most_common(20)
        if c > 0
    ],
    "bytes_by_actor_gb": {
        a: round(b / 1024 / 1024 / 1024, 2)
        for a, b in bytes_by_actor.most_common()
    },
    "hits_by_actor": dict(hits_by_actor.most_common()),
    "status_by_host": {
        h: dict(s.most_common())
        for h, s in status_by_host.items() if sum(s.values()) > 100
    },
    "fourohfour_top_urls": [
        {"bucket": b, "hits": n} for b, n in fourohfour_urls.most_common(15)
    ],
    "fourohfour_by_actor": dict(fourohfour_actors.most_common()),
    "fourohfour_total": sum(fourohfour_urls.values()),
}

with open(os.path.join(HERE, "enrichment.json"), "w") as f:
    json.dump(out, f, indent=2)


# --- console summaries ---
print("=" * 80)
print("AWS scraper — top URL buckets")
print("=" * 80)
print(f"{'Bucket':<55}{'Hits':>10}{'Bytes (MB)':>15}")
print("-" * 80)
total_h, total_b = 0, 0
for r in out["scraper_url_profile"]:
    print(f"{r['bucket'][:53]:<55}{r['hits']:>10,}{r['bytes']/1024/1024:>14,.1f}")
    total_h += r["hits"]
    total_b += r["bytes"]
print(f"{'  (top 25 above)':<55}{total_h:>10,}{total_b/1024/1024:>14,.1f}")
print(f"{'  (all scraper hits)':<55}{out['scraper_total_hits']:>10,}{out['scraper_total_bytes']/1024/1024:>14,.1f}")

print("\n" + "=" * 80)
print("Search burn by named bot")
print("=" * 80)
print(f"{'Bot':<40}{'Search hits':>14}{'Total hits':>14}")
print("-" * 80)
for r in out["search_burn_by_named_bot"]:
    print(f"{r['name']:<40}{r['search_hits']:>14,}{r['total_hits']:>14,}")

print("\n" + "=" * 80)
print("Bytes served by actor (bandwidth)")
print("=" * 80)
for actor, gb in out["bytes_by_actor_gb"].items():
    hits = out["hits_by_actor"].get(actor, 0)
    print(f"  {actor:<22} {gb:>7.2f} GB    ({hits:>10,} hits)")
total_gb = sum(out["bytes_by_actor_gb"].values())
print(f"  {'TOTAL':<22} {total_gb:>7.2f} GB")

print("\n" + "=" * 80)
print("Status codes by hostname")
print("=" * 80)
for host, statuses in out["status_by_host"].items():
    total = sum(statuses.values())
    if total < 1000:
        continue
    print(f"\n{host}  ({total:,} total)")
    for st, n in list(statuses.items())[:6]:
        print(f"  {st}  {n:>10,}  ({n/total*100:5.1f}%)")

print("\n" + "=" * 80)
print(f"404 attack surface — {out['fourohfour_total']:,} total 404s")
print("=" * 80)
print(f"{'Bucket':<55}{'Hits':>10}")
print("-" * 70)
for r in out["fourohfour_top_urls"]:
    print(f"{r['bucket'][:53]:<55}{r['hits']:>10,}")
print(f"\n404s by actor:")
for actor, n in out["fourohfour_by_actor"].items():
    print(f"  {actor:<22} {n:>10,}")
