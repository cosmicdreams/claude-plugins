---
name: log-analyzer
description: >
  Analyzes web server and application logs (Acquia/Drupal + Cloudflare) and renders
  an ASCII dashboard report in the terminal. Use when the user asks to analyze logs,
  check error rates, investigate traffic spikes, identify bot traffic, view Cloudflare
  threat blocks, review overall site health, diagnose PHP errors, investigate 500 errors,
  find slow requests, or answer "who is hammering my site". Trigger phrases: "analyze
  logs", "check error rates", "log analysis", "cloudflare threats", "acquia logs",
  "traffic spike", "bot traffic", "site health report", "what's hitting my site",
  "PHP errors", "500 errors", "slow requests", "who is hammering my site".
  Do NOT trigger for Drupal-specific log analysis within DDEV (use drupal-lab tools
  for that).
---

# office:log-analyzer

Ask the user which log source they want to analyze (Acquia access logs, Acquia error
logs, or Cloudflare), or default to Acquia apache-access logs if no preference is stated.
Then follow the steps below.

## Data ingestion

### Acquia logs

Fetch logs to a temp file, then analyze:

```bash
# Option 1: acli log:tail (captures to file)
acli log:tail --format=json > /tmp/office-acquia-logs.json

# Option 2: logstream CLI (if available)
logstream --format=json --output=/tmp/office-acquia-logs.json
```

Log types available via acli:
- `apache-access` — HTTP access log (most useful)
- `apache-error` — PHP/Apache errors
- `php-error` — PHP fatal errors
- `drupal-watchdog` — Drupal's internal log
- `varnish-request` — Cache layer requests

Default: collect `apache-access` unless user specifies otherwise.

### Cloudflare logs

Requires `CF_API_TOKEN` env var and `CF_ZONE_ID` env var.

```bash
# Fetch firewall events (threat blocks) for the last 24 hours
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/firewall/events" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" > /tmp/office-cf-events.json
```

If either variable is missing, skip Cloudflare analysis entirely and note the reason.
Do not prompt the user for credentials mid-analysis.

> Cloudflare analysis skipped. Set CF_API_TOKEN and CF_ZONE_ID in environment
> or ~/.config/office/config to enable threat analysis.

## Running the analyzer

Once log data is collected, pass it to the bundled Python script:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/log-analyzer/scripts/analyze.py" \
  --access-log /tmp/office-acquia-logs.json \
  --cf-events /tmp/office-cf-events.json
```

Always use `${CLAUDE_PLUGIN_ROOT}` to reference the bundled script — the path changes
with each plugin version install. Do not hardcode a cache path.

The script outputs a JSON summary. Parse that JSON to build the dashboard.

## Dashboard output

Format the Python output as a rich Markdown report. Use the template below as a guide:

~~~markdown
# Site Health Dashboard — 2026-03-07

## Overall Status: YELLOW

| Metric | Value |
|--------|-------|
| Total Requests | 48,293 |
| 2xx Success | 94.2% (45,492) |
| 3xx Redirects | 3.1% (1,497) |
| 4xx Client Errors | 2.1% (1,014) |
| 5xx Server Errors | 0.6% (290) — watch this |
| Cloudflare Threats Blocked | 23 |

## Traffic Trend (last 24h)

    00:00 ████░░░░░░  812 req
    01:00 ███░░░░░░░  634 req
    ...
    12:00 ██████████ 3,842 req (peak)

## Top Paths by Volume
| Path | Requests |
|------|----------|
| /api/v1/content | 8,234 |
| / | 6,102 |
...

## Potential Bot Traffic
| IP | Requests | Flag |
|----|----------|------|
| 192.0.2.42 | 4,201 | High volume |
...

## Recommendations
- 5xx rate is elevated (0.6%) — check apache-error logs
- IP 192.0.2.42 sending 4,201 requests — consider rate limiting
~~~

## Optional: HTML report

Generate the HTML report when the user needs to share the analysis with someone who
doesn't have terminal access, or when the dashboard is too wide for the current terminal.

If the user asks for an HTML report, generate a standalone `log-report-<YYYY-MM-DD>.html`
file with the same data formatted as an HTML dashboard with inline CSS, then open it:

```bash
open log-report-2026-03-07.html
```

## Error handling

- `acli: command not found`: direct user to install Acquia CLI
- `python3: command not found`: unlikely on macOS; try `python` as fallback
- Empty log file: report "No log data found in the specified time range"
- Cloudflare API error: show the error body and suggest checking CF_API_TOKEN
