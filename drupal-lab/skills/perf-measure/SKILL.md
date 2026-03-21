---
name: perf-measure
description: >
  PHP performance profiling inside DDEV. Outputs machine-readable JSON score tuples
  for the experiment ratchet, including callgraph_top_10 for autonomous hypothesis
  generation. Use when profiling Drupal page load times, memory allocations, or
  database query patterns. Do NOT use for frontend performance -- use improve:perf-measure.
triggers:
  - "profile this page"
  - "drupal performance"
  - "xhprof"
  - "slow query"
  - "drupal-lab:perf-measure"
---

# perf-measure

PHP performance profiling inside DDEV. Assumes DDEV is running. For DDEV lifecycle and command reference, see `drupal-lab:ddev`.

## Groups

| Flag | Default? | setup | measure |
|---|---|---|---|
| `--xhprof` | yes | `ddev xhprof on` | curl internal, parse via helper script |
| `--newrelic` | no | addon install + env vars + restart | none — continuous APM, no point-in-time output |
| `--db` | no | session-only slow query log | flush, curl, read log, EXPLAIN |

## --xhprof

### Prerequisites

> **Never use `ddev config` to change individual settings** — it rewrites and reorganizes the entire `config.yaml`, which can cascade into DB type mismatches and project name collisions. Use `config.local.yaml` for all local overrides instead.

**Step 0 — Verify xhprof mode before measuring.**

DDEV v1.23+ defaults xhprof to `xhgui` mode, which sends data to a collector pipeline rather than writing raw `.xhprof` files. This skill requires `prepend` mode (raw files). Check which mode is active:

```bash
ddev exec php -r "echo ini_get('auto_prepend_file');" 2>/dev/null
```

- If output contains `xhprof_prepend.php` → you are in `prepend` mode. Proceed.
- If output is empty or contains `xhgui` → set prepend mode via `config.local.yaml`:

```yaml
# .ddev/config.local.yaml
xhprof_mode: prepend
```

Then restart: `ddev restart` (not `ddev start` — containers are already running).

If DDEV is not running yet, use `ddev xhprof on` which enables xhprof (in whatever mode is configured). Then verify mode with the check above before proceeding.

> **Note:** If DDEV containers are already running, `ddev xhprof on` will attempt a restart internally. If it fails with a container conflict error, run `ddev poweroff` first, then `ddev xhprof on`.

### Setup

```bash
ddev xhprof on
# Verify mode (must say prepend):
ddev exec php -r "echo ini_get('auto_prepend_file');"
```

### Measure `<path>` (default: `/`)

1. Enable xhprof and set a timestamp marker:
```bash
ddev xhprof on
ddev exec touch /tmp/.xhprof-mark
```

2. Trigger the request via the external DDEV URL (not `http://web/` — that routes to an internal PHP_CodeSniffer bootstrap, not a Drupal page):
```bash
curl -sk -o /dev/null "https://<ddev-site-name>.ddev.site/<path>"
```

The site name is the `name:` field in `.ddev/config.local.yaml`. For example: `https://pncb-perf.ddev.site/`.

3. Find the xhprof file created after the marker:
```bash
ddev exec find /tmp/xhprof -name "*.xhprof" -newer /tmp/.xhprof-mark -type f | head -1
```

If `/tmp/.xhprof-mark` doesn't exist (first run or container restart), fall back to the most recently modified xhprof file:
```bash
ddev exec find /tmp/xhprof -name "*.xhprof" -type f | sort -t_ -k2 -n | tail -1
```

4. Parse via helper script (copy to project first):
```bash
ddev exec php /var/www/html/.claude/perf-measure/parse-xhprof.php <xhprof-file>
```

The script is at `drupal-lab/skills/perf-measure/scripts/parse-xhprof.php` — copy to `.claude/perf-measure/` in your project before running.

## --newrelic

### Setup only (no measure mode — continuous APM)

1. Install the DDEV add-on:
```bash
ddev add-on get tbkot/ddev-newrelic
```

2. Add secrets to `.ddev/config.local.yaml` (gitignored — correct place for secrets):
```yaml
web_environment:
  - NEWRELIC_LICENSE_KEY: <your-license-key>
  - NEWRELIC_APPNAME: <your-app-name>
```

3. Restart and enable:
```bash
ddev restart && ddev newrelic on
```

Note: New Relic is mutually exclusive with xhprof, xdebug, and Blackfire — the command disables them automatically.

No `measure` mode. Production slow query data → pull from the New Relic dashboard.

## --db

### Setup (session-only, resets on container restart)

```bash
ddev exec mysql -e "SET GLOBAL slow_query_log = 'ON'; SET GLOBAL long_query_time = 0.1; FLUSH SLOW LOGS;"
```

### Measure `<path>` (default: `/`)

1. Flush logs, trigger request, flush again:
```bash
ddev exec mysql -e "FLUSH SLOW LOGS;"
ddev exec curl -s -o /dev/null "http://web/<path>"
ddev exec mysql -e "FLUSH SLOW LOGS;"
```

2. Locate and read the slow query log (path varies by DDEV/MariaDB version — always check first):
```bash
ddev exec mysql -e "SHOW VARIABLES LIKE 'slow_query_log_file';"
# Use the Value from the result:
ddev exec cat <slow_query_log_file_path>
```
Common path: `/var/lib/mysql/<hostname>-slow.log` or `/var/lib/mysql/slow.log` — confirm with the query above.

3. Parse query text, run `EXPLAIN` for each unique query:
```bash
ddev exec mysql <dbname> -e "EXPLAIN <query>"
```

4. Include as `slow_queries` array in output.

## Output Contract

```json
{
  "scores": {
    "wall_time_ms": 340,
    "cpu_time_ms": 290,
    "memory_peak_mb": 42,
    "function_calls_total": 4821,
    "top_function": "Drupal\\Core\\Cache\\CacheBackend::get",
    "top_function_wall_ms": 48,
    "top_function_calls": 312,
    "db_queries": 23,
    "db_time_ms": 67
  },
  "callgraph_top_10": [
    { "fn": "...", "wt_ms": 48, "ct": 312, "cpu_ms": 41, "mu_kb": 2048, "pmu_kb": 4096 }
  ],
  "ts": "2026-03-21T12:00:00Z"
}
```

`callgraph_top_10` is intentionally outside `scores`. The ratchet compares `scores`; `callgraph_top_10` is the hypothesis-generation input for autoresearch — it tells you *where* time is spent, not just *how much*.

All xhprof values are **inclusive** — they include the function's own time plus all callees.

## Baseline Convention

Save baseline:
```bash
drupal-lab:perf-measure --xhprof measure / > /tmp/perf-baseline.json
```

Compare after a change:
```bash
jq -s '.[0].scores, .[1].scores' /tmp/perf-baseline.json /tmp/perf-after.json
```

## Using with the Experiment Loop

The `scores` object is the tuple the ratchet compares. Typical targets:

- **Page speed**: `keep if wall_time_ms < previous.wall_time_ms`
- **Memory**: `keep if memory_peak_mb < previous.memory_peak_mb`
- **Queries**: `keep if db_queries < previous.db_queries`

`callgraph_top_10` drives hypothesis generation in `improve:optimizer`.
