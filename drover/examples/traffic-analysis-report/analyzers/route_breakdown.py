#!/usr/bin/env python3
"""
Route-level breakdown of search-triggering traffic by actor.

Extends findings.json with per-route counts so we can answer:
  - Exactly which paths are bots/scrapers crawling that drive Solr queries?
  - Are the SearchMediator JSON-manifest routes (/api/v1/search/manifest/*)
    contributing to the burn? (They serve JSON for client-side fuzzy-search;
    they do NOT consume Solr quota.)

Writes route_breakdown.json next to this script.
"""
import gzip, glob, json, re, os
from collections import defaultdict, Counter
from urllib.parse import urlparse

HERE = os.path.dirname(__file__)
LOGS = sorted(glob.glob(os.path.join(HERE, "..", "..", "<year>", "<month>", "*.prod.apache-access.log.gz")))

SCAN_PREFIXES = ("192.0.2.250",)

AREA_SEARCH = re.compile(
    r"^/(north-terminal|south-terminal|east-station|west-station|"
    r"central-hub|transit)?/?search(/|\?|$)")
API_SEARCH_SOLR = re.compile(r"^/api/v\d+/search/(?!manifest)")  # Solr-backed
API_SEARCH_MANIFEST = re.compile(r"^/api/v\d+/search/manifest/")  # SearchMediator (NOT Solr)
FACET_Q = re.compile(r"[?&](f%5B|f\[)")
AUTOCOMPLETE = re.compile(r"autocomplete", re.I)

DECLARED_BOT = re.compile(
    r"bingbot|googlebot|bytespider|yandex|baiduspider|duckduckbot|applebot|"
    r"facebookexternalhit|meta-externalagent|semrush|ahrefsbot|mj12bot|"
    r"dotbot|petalbot|gptbot|claudebot|ccbot|amazonbot|slurp|crawler|spider|bot/",
    re.I)
SCRAPER_UA = re.compile(r"X11; Linux x86_64.*Chrome/12[0-9]\.")

LINE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<ts>[^\]]+)\] '
    r'"(?P<method>\S+) (?P<path>\S+) [^"]*" (?P<status>\d{3}) (?P<bytes>\S+) '
    r'"[^"]*" "(?P<ua>[^"]*)"')
FWD = re.compile(r'forwarded_for="([^"]*)"')


def real_ip(line, fb):
    m = FWD.search(line)
    if m and m.group(1).strip():
        return m.group(1).split(",")[0].strip()
    return fb


def classify_actor(ua, ip):
    if any(ip.startswith(p) for p in SCAN_PREFIXES):
        return "scan"
    if DECLARED_BOT.search(ua):
        return "declared_bot"
    if SCRAPER_UA.search(ua):
        return "suspected_scraper"
    if not ua or ua == "-":
        return "no_ua"
    return "human"


def canonicalize_search_route(path):
    """Bucket a search-triggering path into a stable route key."""
    # strip query
    p = path.split("?", 1)[0]
    # area-search pages
    m = AREA_SEARCH.match(path)
    if m:
        area = m.group(1) or ""
        if area:
            return f"/{area}/search"
        return "/search"
    if API_SEARCH_MANIFEST.match(path):
        # Manifest endpoint — JSON, NOT Solr
        # Bucket by endpoint name
        seg = p.split("/")
        # e.g. /api/v1/search/manifest/terminal-assets
        endpoint = seg[5] if len(seg) > 5 else "(unknown)"
        return f"/api/v1/search/manifest/{endpoint}"
    if API_SEARCH_SOLR.match(path):
        return p  # keep raw Solr API path
    if FACET_Q.search(path):
        # bucket facet hits by base path (without facet args)
        return f"{p} [facet]"
    if AUTOCOMPLETE.search(path):
        return f"{p} [autocomplete]"
    return None


# route -> {actor -> count}, plus total
routes = defaultdict(lambda: defaultdict(int))
# also track is-solr vs is-manifest for the route
route_kind = {}

for fn in LOGS:
    with gzip.open(fn, "rt", errors="replace") as fh:
        for line in fh:
            m = LINE.match(line)
            if not m:
                continue
            d = m.groupdict()
            ip = real_ip(line, d["ip"])
            actor = classify_actor(d["ua"], ip)
            path = d["path"]
            key = canonicalize_search_route(path)
            if not key:
                continue
            # mark kind
            if key not in route_kind:
                if API_SEARCH_MANIFEST.match(path):
                    route_kind[key] = "manifest_json"  # NOT Solr
                elif API_SEARCH_SOLR.match(path):
                    route_kind[key] = "solr_api"
                elif "[facet]" in key:
                    route_kind[key] = "solr_facet"
                elif "[autocomplete]" in key:
                    route_kind[key] = "autocomplete"
                else:
                    route_kind[key] = "solr_page"
            routes[key]["total"] += 1
            routes[key][actor] += 1


# build sorted breakdown
out = []
for route, counts in routes.items():
    total = counts["total"]
    out.append({
        "route": route,
        "kind": route_kind[route],
        "total": total,
        "human": counts.get("human", 0),
        "declared_bot": counts.get("declared_bot", 0),
        "suspected_scraper": counts.get("suspected_scraper", 0),
        "scan": counts.get("scan", 0),
        "no_ua": counts.get("no_ua", 0),
        "non_human": counts.get("declared_bot", 0) + counts.get("suspected_scraper", 0) + counts.get("scan", 0),
        "non_human_pct": round(
            (counts.get("declared_bot", 0) + counts.get("suspected_scraper", 0) + counts.get("scan", 0)) / total * 100,
            1) if total else 0,
    })

out.sort(key=lambda r: r["total"], reverse=True)

with open(os.path.join(HERE, "route_breakdown.json"), "w") as f:
    json.dump({"routes": out, "window": "<YYYY-MM-DD>..<YYYY-MM-DD>"}, f, indent=2)

# Print summary tables
print(f"{'Route':<60}{'Kind':<18}{'Total':>10}{'Human':>10}{'Bot':>10}{'Scraper':>10}{'%NonHuman':>12}")
print("-" * 130)
for r in out[:25]:
    print(f"{r['route'][:58]:<60}{r['kind']:<18}{r['total']:>10,}{r['human']:>10,}"
          f"{r['declared_bot']:>10,}{r['suspected_scraper']:>10,}{r['non_human_pct']:>11}%")

# SearchMediator-specific summary
print("\n=== SearchMediator manifest endpoints (NOT Solr, client-side fuzzy-search) ===")
manifest = [r for r in out if r["kind"] == "manifest_json"]
mtotal = sum(r["total"] for r in manifest)
mhuman = sum(r["human"] for r in manifest)
mbot = sum(r["declared_bot"] for r in manifest)
mscraper = sum(r["suspected_scraper"] for r in manifest)
print(f"Total manifest hits: {mtotal:,}")
print(f"  human:   {mhuman:,} ({mhuman/mtotal*100:.1f}%)" if mtotal else "  (no hits)")
print(f"  bot:     {mbot:,} ({mbot/mtotal*100:.1f}%)" if mtotal else "")
print(f"  scraper: {mscraper:,} ({mscraper/mtotal*100:.1f}%)" if mtotal else "")
for r in manifest:
    print(f"  {r['route']:<60} {r['total']:>8,} total")

# Solr-burning routes
print("\n=== Solr-burning routes (these are the search-quota culprits) ===")
solr = [r for r in out if r["kind"] in ("solr_page", "solr_facet", "solr_api")]
stotal = sum(r["total"] for r in solr)
shuman = sum(r["human"] for r in solr)
sbot = sum(r["declared_bot"] for r in solr)
sscraper = sum(r["suspected_scraper"] for r in solr)
print(f"Total Solr-driving hits: {stotal:,}")
print(f"  human:   {shuman:,} ({shuman/stotal*100:.1f}%)")
print(f"  bot:     {sbot:,} ({sbot/stotal*100:.1f}%)")
print(f"  scraper: {sscraper:,} ({sscraper/stotal*100:.1f}%)")
