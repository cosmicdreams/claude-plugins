#!/usr/bin/env python3
"""
office:log-analyzer — log analysis engine
Parses Acquia/Drupal access logs and Cloudflare firewall events.
Outputs a JSON summary for the skill to format as a dashboard.
"""

import json
import sys
import argparse
from collections import defaultdict, Counter
from datetime import datetime


def parse_args():
    parser = argparse.ArgumentParser(description="Analyze web server logs")
    parser.add_argument("--access-log", help="Path to JSON access log file")
    parser.add_argument("--cf-events", help="Path to Cloudflare firewall events JSON")
    return parser.parse_args()


def categorize_status(code):
    code = int(code)
    if 200 <= code < 300:
        return "2xx"
    elif 300 <= code < 400:
        return "3xx"
    elif 400 <= code < 500:
        return "4xx"
    elif 500 <= code < 600:
        return "5xx"
    return "other"


def parse_access_log(path):
    """Parse JSON access log. Handles both NDJSON and JSON array formats."""
    entries = []
    if not path:
        return entries
    try:
        with open(path) as f:
            content = f.read().strip()
            if content.startswith("["):
                entries = json.loads(content)
            else:
                # NDJSON (one JSON object per line)
                for line in content.splitlines():
                    line = line.strip()
                    if line:
                        try:
                            entries.append(json.loads(line))
                        except json.JSONDecodeError:
                            continue
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Warning: could not parse access log: {e}", file=sys.stderr)
    return entries


def parse_cf_events(path):
    """Parse Cloudflare firewall events JSON."""
    if not path:
        return []
    try:
        with open(path) as f:
            data = json.load(f)
            # Cloudflare API wraps events in result.result
            if isinstance(data, dict):
                return data.get("result", {}).get("data", data.get("result", []))
            return data
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Warning: could not parse Cloudflare events: {e}", file=sys.stderr)
        return []


def analyze(access_entries, cf_events):
    total = len(access_entries)
    status_counts = defaultdict(int)
    path_counts = Counter()
    ip_counts = Counter()
    hourly_counts = defaultdict(int)
    cf_threats = len(cf_events)

    for entry in access_entries:
        # Support multiple log field name conventions
        status = str(entry.get("status", entry.get("response_code", entry.get("code", "0"))))
        path = entry.get("path", entry.get("request_path", entry.get("uri", "/")))
        ip = entry.get("ip", entry.get("remote_addr", entry.get("client_ip", "unknown")))
        timestamp = entry.get("timestamp", entry.get("time", entry.get("datetime", "")))

        status_counts[categorize_status(status)] += 1
        # Normalize path — strip query string for grouping
        clean_path = path.split("?")[0] if path else "/"
        path_counts[clean_path] += 1
        ip_counts[ip] += 1

        # Parse hour from timestamp
        if timestamp:
            try:
                if isinstance(timestamp, (int, float)):
                    hour = datetime.fromtimestamp(timestamp).strftime("%H:00")
                else:
                    # Try common formats
                    for fmt in ["%Y-%m-%dT%H:%M:%S", "%d/%b/%Y:%H:%M:%S", "%Y-%m-%d %H:%M:%S"]:
                        try:
                            hour = datetime.strptime(timestamp[:19], fmt).strftime("%H:00")
                            break
                        except ValueError:
                            continue
                    else:
                        hour = "00:00"
                hourly_counts[hour] += 1
            except (ValueError, OSError):
                pass

    # Severity calculation
    server_errors = status_counts.get("5xx", 0)
    error_rate = (server_errors / total) if total > 0 else 0

    if error_rate > 0.05 or cf_threats > 50:
        severity = "red"
    elif error_rate > 0.01 or cf_threats > 10:
        severity = "yellow"
    else:
        severity = "green"

    # Bot detection: IPs with high request volume
    # Rough threshold: flag if IP has more than 1% of total traffic or > 500 requests
    bot_threshold = max(500, int(total * 0.01))
    top_ips = [
        {"ip": ip, "count": count, "bot_flag": count > bot_threshold}
        for ip, count in ip_counts.most_common(10)
    ]

    top_paths = [
        {"path": path, "count": count}
        for path, count in path_counts.most_common(10)
    ]

    hourly_trend = [
        {"hour": hour, "count": count}
        for hour, count in sorted(hourly_counts.items())
    ]

    return {
        "total_requests": total,
        "status_codes": {
            "2xx": status_counts.get("2xx", 0),
            "3xx": status_counts.get("3xx", 0),
            "4xx": status_counts.get("4xx", 0),
            "5xx": status_counts.get("5xx", 0),
        },
        "top_paths": top_paths,
        "top_ips": top_ips,
        "hourly_trend": hourly_trend,
        "cloudflare_threats": cf_threats,
        "severity": severity,
    }


def main():
    args = parse_args()
    access_entries = parse_access_log(args.access_log)
    cf_events = parse_cf_events(args.cf_events)
    result = analyze(access_entries, cf_events)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
