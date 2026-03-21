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

### Setup

```bash
ddev xhprof on
```

### Measure `<path>` (default: `/`)

1. Enable xhprof and set a timestamp marker:
```bash
ddev xhprof on
ddev exec touch /tmp/.xhprof-mark
```

2. Trigger the request (internal URL avoids TLS):
```bash
ddev exec curl -s -o /dev/null "http://web/<path>"
```

3. Find the xhprof file created after the marker:
```bash
ddev exec find /var/xhprof -name "*.xhprof" -newer /tmp/.xhprof-mark -type f | head -1
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

2. Read the slow query log:
```bash
ddev exec cat /var/lib/mysql/slow.log
```

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
