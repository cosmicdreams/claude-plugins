#!/usr/bin/env python3
"""
Acmecorp (example) access-log analyzer — search-allocation + Imperva-passthrough.

Processes the verified per-day apache-access logs in <project>/<year>/<month>/ and emits:
  - findings.json  (structured aggregates)
  - the numbers the two Markdown reports are built from (printed to stdout)

Backend-agnostic: search-triggering requests are identified by URL (the
Solr-backed search paths + facets), not by which Solr server served them.
Quota tie-out (Acquia Search vs SearchStax) is a separate external input.

Run:  python3 analyze.py [glob]   (default: ../../<year>/<month>/*.prod.apache-access.log.gz)
"""
import gzip, glob, json, re, sys, os
from collections import defaultdict, Counter

LOG_GLOB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(__file__), "..", "..", "<year>", "<month>", "*.prod.apache-access.log.gz")

# --- monthly security scan (sanctioned; excluded from organic baseline) ---
SCAN_PREFIXES = ("192.0.2.250",)          # monthly security-scan vendor range (illustrative)

# --- search-triggering paths (Solr-backed) ---
AREA_SEARCH = re.compile(
    r"^/(north-terminal|south-terminal|east-station|west-station|"
    r"central-hub|transit)?/?search(/|\?|$)")
API_SEARCH = re.compile(r"^/api/v\d+/search/")
FACET_Q = re.compile(r"[?&](f%5B|f\[)")   # facets module: f[0]=... (raw or encoded)
AUTOCOMPLETE = re.compile(r"autocomplete", re.I)

# --- bot/crawler UA signatures (declared) ---
DECLARED_BOT = re.compile(
    r"bingbot|googlebot|bytespider|yandex|baiduspider|duckduckbot|applebot|"
    r"facebookexternalhit|meta-externalagent|semrush|ahrefsbot|mj12bot|"
    r"dotbot|petalbot|gptbot|claudebot|ccbot|amazonbot|slurp|crawler|spider|bot/",
    re.I)
# datacenter-scraper heuristic: headless-ish X11 Linux Chrome with no platform extras
SCRAPER_UA = re.compile(r"X11; Linux x86_64.*Chrome/12[0-9]\.")

STATIC_EXT = re.compile(
    r"\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|mp4|webm|pdf)(?:\?|$)",
    re.I)

LINE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<ts>[^\]]+)\] '
    r'"(?P<method>\S+) (?P<path>\S+) [^"]*" (?P<status>\d{3}) (?P<bytes>\S+) '
    r'"[^"]*" "(?P<ua>[^"]*)"')
FWD = re.compile(r'forwarded_for="([^"]*)"')


def real_ip(line, fallback):
    m = FWD.search(line)
    if m and m.group(1).strip():
        return m.group(1).split(",")[0].strip()
    return fallback


def classify_actor(ua, ip):
    if any(ip.startswith(p) for p in SCAN_PREFIXES):
        return "scan"          # monthly sanctioned security scan
    if DECLARED_BOT.search(ua):
        return "declared_bot"
    if SCRAPER_UA.search(ua):
        return "suspected_scraper"
    if not ua or ua in ("-",):
        return "no_ua"
    return "human"


def is_search(path):
    if AREA_SEARCH.match(path) or API_SEARCH.match(path):
        return "search_page"
    if FACET_Q.search(path):
        return "facet"
    if AUTOCOMPLETE.search(path):
        return "autocomplete"
    return None


agg = {
    "total": 0, "scan": 0, "organic": 0,
    "by_day": defaultdict(lambda: {"total": 0, "search": 0, "scan": 0}),
    "search_total": 0,
    "search_by_actor": Counter(),
    "search_by_kind": Counter(),
    "actor_totals": Counter(),
    "facet_actor": Counter(),
    "facet_distinct_urls": defaultdict(set),     # actor-ip -> set(facet urls)
    "search_top_ip": Counter(),
    "search_top_ua": Counter(),
    # Imperva passthrough (organic only — scan excluded)
    "passthrough": {"static": 0, "declared_bot": 0, "suspected_scraper": 0,
                    "no_ua": 0, "human": 0, "total": 0},
    "passthrough_bot_ips": Counter(),
    "status": Counter(),
}

for fn in sorted(glob.glob(LOG_GLOB)):
    day = os.path.basename(fn)[:10]
    with gzip.open(fn, "rt", errors="replace") as fh:
        for line in fh:
            m = LINE.match(line)
            if not m:
                continue
            d = m.groupdict()
            ip = real_ip(line, d["ip"])
            ua = d["ua"]
            path = d["path"]
            actor = classify_actor(ua, ip)
            is_scan = actor == "scan"

            agg["total"] += 1
            agg["status"][d["status"]] += 1
            agg["actor_totals"][actor] += 1
            dd = agg["by_day"][day]
            dd["total"] += 1
            if is_scan:
                agg["scan"] += 1
                dd["scan"] += 1
            else:
                agg["organic"] += 1

            kind = is_search(path)
            if kind:
                agg["search_total"] += 1
                agg["search_by_actor"][actor] += 1
                agg["search_by_kind"][kind] += 1
                agg["search_top_ip"][ip] += 1
                agg["search_top_ua"][ua[:80]] += 1
                dd["search"] += 1
                if kind == "facet":
                    agg["facet_actor"][actor] += 1
                    agg["facet_distinct_urls"][f"{actor}|{ip}"].add(path)

            # --- Imperva passthrough: organic traffic only ---
            if not is_scan:
                p = agg["passthrough"]
                p["total"] += 1
                if STATIC_EXT.search(path):
                    p["static"] += 1
                elif actor == "declared_bot":
                    p["declared_bot"] += 1
                    agg["passthrough_bot_ips"][ip] += 1
                elif actor == "suspected_scraper":
                    p["suspected_scraper"] += 1
                    agg["passthrough_bot_ips"][ip] += 1
                elif actor == "no_ua":
                    p["no_ua"] += 1
                else:
                    p["human"] += 1

# distinct facet-URL offenders (the quota drain)
facet_offenders = sorted(
    ((len(urls), key) for key, urls in agg["facet_distinct_urls"].items()),
    reverse=True)[:20]

out = {
    "window": "<YYYY-MM-DD>..<YYYY-MM-DD> (prod apache-access; partial day excluded)",
    "total_requests": agg["total"],
    "scan_requests": agg["scan"],
    "organic_requests": agg["organic"],
    "actor_totals": dict(agg["actor_totals"].most_common()),
    "search_total": agg["search_total"],
    "search_by_actor": dict(agg["search_by_actor"].most_common()),
    "search_by_kind": dict(agg["search_by_kind"].most_common()),
    "search_top_ip": agg["search_top_ip"].most_common(20),
    "search_top_ua": agg["search_top_ua"].most_common(15),
    "facet_by_actor": dict(agg["facet_actor"].most_common()),
    "facet_distinct_url_offenders": [
        {"actor_ip": k, "distinct_facet_urls": n} for n, k in facet_offenders],
    "by_day": {d: v for d, v in sorted(agg["by_day"].items())},
    "passthrough": agg["passthrough"],
    "passthrough_top_bot_ips": agg["passthrough_bot_ips"].most_common(20),
    "status_distribution": dict(agg["status"].most_common()),
}

with open(os.path.join(os.path.dirname(__file__), "findings.json"), "w") as f:
    json.dump(out, f, indent=2)

print(json.dumps({k: out[k] for k in (
    "window", "total_requests", "scan_requests", "organic_requests",
    "actor_totals", "search_total", "search_by_actor", "search_by_kind",
    "facet_by_actor", "passthrough")}, indent=2))
print("\n-- top search IPs --")
for ip, n in out["search_top_ip"][:12]:
    print(f"{n:>8}  {ip}")
print("\n-- facet distinct-URL offenders (quota drain) --")
for o in out["facet_distinct_url_offenders"][:12]:
    print(f"{o['distinct_facet_urls']:>7} distinct  {o['actor_ip']}")
