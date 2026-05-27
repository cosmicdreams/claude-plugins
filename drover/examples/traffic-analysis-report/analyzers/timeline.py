#!/usr/bin/env python3
"""
Per-day timeline showing when the origin.acmecorp.example.com bypass mitigation
took effect. Captures daily totals split by host and actor.
"""
import gzip, glob, json, re, os
from collections import defaultdict, Counter

HERE = os.path.dirname(__file__)
LOGS = sorted(glob.glob(os.path.join(HERE, "..", "..", "<year>", "<month>", "*.prod.apache-access.log.gz")))

SCAN_PREFIXES = ("192.0.2.250",)
SCRAPER_UA = re.compile(r"X11; Linux x86_64.*Chrome/12[0-9]\.")
DECLARED_BOT = re.compile(
    r"bingbot|googlebot|bytespider|yandex|baiduspider|duckduckbot|applebot|"
    r"facebookexternalhit|meta-externalagent|semrush|ahrefsbot|mj12bot|"
    r"dotbot|petalbot|gptbot|claudebot|ccbot|amazonbot|slurp|crawler|spider|bot/",
    re.I)

LINE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<ts>[^\]]+)\] '
    r'"(?P<method>\S+) (?P<path>\S+) [^"]*" (?P<status>\d{3}) (?P<bytes>\S+) '
    r'"[^"]*" "(?P<ua>[^"]*)"')
HOST_RX = re.compile(r' host=(\S+)')
FWD_RX = re.compile(r'forwarded_for="([^"]*)"')


def classify(ua, ip):
    if any(ip.startswith(p) for p in SCAN_PREFIXES):
        return "scan"
    if SCRAPER_UA.search(ua):
        return "scraper"
    if DECLARED_BOT.search(ua):
        return "bot"
    if not ua or ua == "-":
        return "no_ua"
    return "human"


# day -> host -> actor -> count, plus status splits
by_day_host = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
by_day_host_status = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))

for fn in LOGS:
    day = os.path.basename(fn)[:10]
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
            actor = classify(d["ua"], ip)
            by_day_host[day][host][actor] += 1
            by_day_host[day][host]["_total"] += 1
            by_day_host_status[day][host][d["status"]] += 1


# Serialize
out = {
    "window": "<YYYY-MM-DD>..<YYYY-MM-DD>",
    "days": {},
}
for day in sorted(by_day_host):
    out["days"][day] = {
        "by_host": {h: dict(a) for h, a in by_day_host[day].items()},
        "status_by_host": {h: dict(s) for h, s in by_day_host_status[day].items()},
    }

with open(os.path.join(HERE, "timeline.json"), "w") as f:
    json.dump(out, f, indent=2)


# --- Pretty print: origin.acmecorp.example.com timeline ---
print(f"{'Day':<12}{'acquia total':>14}{'scraper':>12}{'bot':>10}{'scan':>10}{'human':>10}{'200':>10}{'403':>10}{'404':>10}")
print("-" * 100)
for day in sorted(by_day_host):
    ac = by_day_host[day].get("origin.acmecorp.example.com", {})
    st = by_day_host_status[day].get("origin.acmecorp.example.com", {})
    total = ac.get("_total", 0)
    if total == 0:
        continue
    print(f"{day:<12}{total:>14,}{ac.get('scraper', 0):>12,}"
          f"{ac.get('bot', 0):>10,}{ac.get('scan', 0):>10,}{ac.get('human', 0):>10,}"
          f"{st.get('200', 0):>10,}{st.get('403', 0):>10,}{st.get('404', 0):>10,}")

print(f"\n{'Day':<12}{'www total':>14}{'scraper':>12}{'bot':>10}{'human':>10}")
print("-" * 60)
for day in sorted(by_day_host):
    w = by_day_host[day].get("www.acmecorp.example.com", {})
    total = w.get("_total", 0)
    if total == 0:
        continue
    print(f"{day:<12}{total:>14,}{w.get('scraper', 0):>12,}"
          f"{w.get('bot', 0):>10,}{w.get('human', 0):>10,}")
