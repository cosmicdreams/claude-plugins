#!/usr/bin/env python3
"""
Host-header breakdown — answers: did this bot/search traffic come in via
origin.acmecorp.example.com (the Acquia direct hostname that bypasses Imperva)?

The apache-access log captures both:
  vhost=  the Apache vhost the request was served by
  host=   the actual Host header sent by the client

If a request reached origin via Imperva, it carries host=www.acmecorp.example.com (or
acmecorp.example.com). If it bypassed Imperva — by hitting the Acquia hostname directly
— it carries host=origin.acmecorp.example.com or host=acmecorp.example.acquia-sites.com.

Writes host_breakdown.json. Run takes ~1-2 minutes on the 19-day corpus.
"""
import gzip, glob, json, re, os
from collections import defaultdict, Counter

HERE = os.path.dirname(__file__)
LOGS = sorted(glob.glob(os.path.join(HERE, "..", "..", "<year>", "<month>", "*.prod.apache-access.log.gz")))

SCAN_PREFIXES = ("192.0.2.250",)

AREA_SEARCH = re.compile(
    r"^/(north-terminal|south-terminal|east-station|west-station|"
    r"central-hub|transit)?/?search(/|\?|$)")
API_SEARCH = re.compile(r"^/api/v\d+/search/(?!manifest)")
FACET_Q = re.compile(r"[?&](f%5B|f\[)")

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
HOST_RX = re.compile(r' host=(\S+)')
FWD_RX = re.compile(r'forwarded_for="([^"]*)"')


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


def is_search(path):
    if AREA_SEARCH.match(path) or API_SEARCH.match(path):
        return True
    if FACET_Q.search(path):
        return True
    return False


# host -> stats
hosts = defaultdict(lambda: {
    "total": 0,
    "search": 0,
    "actor": Counter(),
    "search_actor": Counter(),
    "status": Counter(),
    "search_routes": Counter(),
})

total_lines = 0
parsed_lines = 0

for fn in LOGS:
    with gzip.open(fn, "rt", errors="replace") as fh:
        for line in fh:
            total_lines += 1
            m = LINE.match(line)
            if not m:
                continue
            parsed_lines += 1
            d = m.groupdict()
            hm = HOST_RX.search(line)
            host = hm.group(1) if hm else "(missing)"
            # use forwarded_for first IP as the real client when present
            fw = FWD_RX.search(line)
            ip = fw.group(1).split(",")[0].strip() if (fw and fw.group(1).strip()) else d["ip"]

            ua = d["ua"]
            path = d["path"]
            status = d["status"]
            actor = classify_actor(ua, ip)

            h = hosts[host]
            h["total"] += 1
            h["actor"][actor] += 1
            h["status"][status] += 1

            if is_search(path):
                h["search"] += 1
                h["search_actor"][actor] += 1
                # bucket route
                p = path.split("?", 1)[0]
                ma = AREA_SEARCH.match(path)
                if ma:
                    area = ma.group(1) or ""
                    route = f"/{area}/search" if area else "/search"
                elif API_SEARCH.match(path):
                    route = p
                elif FACET_Q.search(path):
                    route = f"{p} [facet]"
                else:
                    route = p
                h["search_routes"][route] += 1

# Serialize
out = {
    "window": "<YYYY-MM-DD>..<YYYY-MM-DD>",
    "total_lines": total_lines,
    "parsed_lines": parsed_lines,
    "by_host": {},
}

# Sort by total
for host in sorted(hosts, key=lambda h: hosts[h]["total"], reverse=True):
    h = hosts[host]
    out["by_host"][host] = {
        "total": h["total"],
        "search": h["search"],
        "actor": dict(h["actor"].most_common()),
        "search_actor": dict(h["search_actor"].most_common()),
        "status": dict(h["status"].most_common()),
        "top_search_routes": h["search_routes"].most_common(10),
    }

with open(os.path.join(HERE, "host_breakdown.json"), "w") as f:
    json.dump(out, f, indent=2)

print(f"Total log lines:   {total_lines:,}")
print(f"Parsed (matched):  {parsed_lines:,}")
print(f"\n{'Host':<45}{'Total':>14}{'Search':>12}{'%Bot+Scrap':>14}{'%200':>8}{'%403':>8}")
print("-" * 105)
for host in sorted(hosts, key=lambda h: hosts[h]["total"], reverse=True):
    h = hosts[host]
    total = h["total"]
    if total < 100:
        continue
    nh = h["actor"].get("declared_bot", 0) + h["actor"].get("suspected_scraper", 0)
    s200 = h["status"].get("200", 0)
    s403 = h["status"].get("403", 0)
    print(f"{host[:43]:<45}{total:>14,}{h['search']:>12,}"
          f"{(nh/total*100):>13.1f}%{(s200/total*100):>7.1f}%{(s403/total*100):>7.1f}%")

print("\n=== origin.acmecorp.example.com — actor & search breakdown ===")
ac = hosts.get("origin.acmecorp.example.com", {})
if ac:
    print(f"Total requests: {ac['total']:,}")
    print(f"Search requests: {ac['search']:,}")
    print(f"\nActor mix (all traffic):")
    for actor, n in ac["actor"].most_common():
        print(f"  {actor:<22} {n:>10,}  ({n/ac['total']*100:.1f}%)")
    print(f"\nActor mix (search only, {ac['search']:,} requests):")
    for actor, n in ac["search_actor"].most_common():
        if ac["search"]:
            print(f"  {actor:<22} {n:>10,}  ({n/ac['search']*100:.1f}%)")
    print(f"\nStatus codes:")
    for st, n in list(ac["status"].most_common())[:8]:
        print(f"  {st:<5} {n:>10,}  ({n/ac['total']*100:.1f}%)")
    print(f"\nTop search routes hit via origin.acmecorp.example.com:")
    for route, n in ac.get("top_search_routes", []) or hosts["origin.acmecorp.example.com"]["search_routes"].most_common(10):
        print(f"  {n:>8,}  {route}")

print("\n=== acmecorp.example.acquia-sites.com — actor & search breakdown ===")
ac = hosts.get("acmecorp.example.acquia-sites.com", {})
if ac:
    print(f"Total requests: {ac['total']:,}")
    print(f"Search requests: {ac['search']:,}")
    print(f"\nActor mix (all traffic):")
    for actor, n in ac["actor"].most_common():
        print(f"  {actor:<22} {n:>10,}  ({n/ac['total']*100:.1f}%)")
    print(f"\nStatus codes:")
    for st, n in list(ac["status"].most_common())[:8]:
        print(f"  {st:<5} {n:>10,}  ({n/ac['total']*100:.1f}%)")
