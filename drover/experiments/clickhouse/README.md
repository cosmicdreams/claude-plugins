# Experiment: drover on clickhouse-local

Question: does `clickhouse-local` (one free binary, no server) make drover's log work meaningfully faster without changing its answers, and does it open up analysis drover can't do today?

Nothing in `drover/scripts` changes. This folder holds a SQL port of drover's aggregation for the two high-volume log types, a benchmark that checks the port against the unchanged Python, and a set of cross-project queries.

## Run it

```sh
./get-clickhouse.sh                              # 26.10 branch build into ./bin (gitignored)
python3 bench.py ~/Sites/<PROJECT>:2026-10 ...   # Python vs ClickHouse, parity check -> results/bench.json
python3 explore.py ~/Sites                       # every sql/explore query over all projects -> results/explore.json
python3 build_demo.py                            # -> results/demo.html
```

`bench.py` takes `<project folder>:<YYYY-MM>` pairs. Each engine runs in its own child process per project × month × log type, with Jev off. The explore queries take the folder that holds the project folders and read the project name from a `/Sites/<project>/` path segment.

`results/` is generated from client logs and is gitignored.

## What is ported

| Log type | Engine | Port |
| --- | --- | --- |
| drupal-watchdog | ClickHouse | `sql/watchdog.sql`: header match, continuation folding, severity inference, syslog year choice, `fingerprint_structured('watchdog', …)` |
| apache-error | ClickHouse | `sql/apache_error.sql`: lead regex, module/level split, `fingerprint_structured('apache', …)` |
| php-error | Python (unchanged) | small volume; its stack-trace state machine is not worth porting |

`sql/functions.sql` holds `normalize()`, the sha256 fingerprint and the severity map as SQL functions. `ch_aggregate.aggregate_type()` reproduces `aggregate.aggregate_files()` for one month of daily files, without per-group `first_seen`/`last_seen` or the top-level `metadata`. Reports use those fields, so this is not yet a drop-in replacement; adding them is follow-up work.

Parity means `bench.compare()` finds the same fingerprints in the same order with the same count, source, channel, majority severity, severities, per-day counts, summary and first three samples, and identical `events_total`, `by_severity`, `by_channel` and `by_day`. The speedups count php-error, which runs on Python in both columns.

## Design notes

- **Multi-line watchdog entries.** An `ASOF JOIN` attaches each continuation line to the nearest earlier header in its file; header lines stream through ungrouped. On the busiest month (402 continuation lines in 4.5M) a window function over all lines did the same job with twice the memory. Some sites are mostly continuation lines (stack traces); there the join does real work.
- **Normalize once per distinct message.** `normalize()` is a fixed sequence of substitutions whose first step replaces request ids. Rows are grouped on that first step, and the other seven run once per distinct result.
- **Short-circuit evaluation is off.** With it on, `if()`/`multiIf()` branches re-evaluated shared regex extractions and the query cost about 5x the CPU.
- **Days.** SQL emits a small set of day keys and Python resolves them with drover's own `parse_syslog_ts()` (watchdog, no year) and `parse_apache_ts()` (apache-error), so date acceptance rules match by construction.
- **Encounter order.** Python gives a group its first event's channel and breaks severity ties by first appearance. The SQL returns each sub-group's first occurrence so `rows_to_aggregate()` can do the same.
- **Whitespace.** Python's `\s`, `str.strip()` and `str.isspace()` are Unicode; RE2's `\s` is ASCII. The SQL is written with `\s`/`\S` and `load_sql()` rewrites them to Python's 29 whitespace characters. A non-breaking space in one month's logs is what found this.
- **Line endings.** Python reads in text mode, so `\r\n` becomes `\n`; the SQL strips a trailing `\r` to match.

## Known differences from Python

- `str.splitlines()` also splits on `\x0b`, `\x0c`, `\x1c`–`\x1e`, `\x85`, `\u2028`, `\u2029` and a lone `\r`; ClickHouse splits on `\n` only.
- RE2 `\b`, `\d` and `\w` are ASCII; Python's are Unicode. Non-ASCII digits or letters next to digits could normalize differently.
- Peak memory is higher: about 2.8 GB for the busiest captured month against about 1 GB for Python, because ClickHouse reads the month's files at once.
- Jev (drover's optional severity classifier) is not ported. Both engines run with `JEV_DISABLED=1`; with Jev on, Python's watchdog severities can differ.
- Invalid UTF-8: Python's `errors="replace"` gives one U+FFFD per invalid byte; `toValidUTF8()` gives one per run of invalid bytes, so a message with two or more invalid bytes in a row can fingerprint differently.
- ClickHouse is slower on small months: its start-up costs a few tenths of a second, so below about a second of Python work it does not pay off.

None of these caused a mismatch in the captured logs; `bench.py` reports any that do.

## Results

See `results/demo.html` (generated) and `results/bench.json`.
