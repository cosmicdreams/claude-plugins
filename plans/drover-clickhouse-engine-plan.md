# drover: ClickHouse report engine

Date: 2026-11-11, revised 2026-11-12 (access-log trends first). Status: plan for review. Evidence: `drover/experiments/clickhouse/` (branch `experiment/drover-clickhouse`). The drover Rust plan is shelved and is not a baseline here.

## Decisions (Chris, 2026-11-11 and 2026-11-12)

- **Optional engine with automatic fallback.** drover uses `clickhouse-local` when it finds the binary and runs today's Python path when it does not. Python stays the reference implementation that parity is measured against. Nobody has to install anything new for drover to keep working.
- **Access-log trends come first (revised 2026-11-12).** The team increasingly wants trends from access logs, not only errors. This replaces the earlier order (engine swap first, then traffic). The order is now:
  - Phase 1 (drover 5.2.0): access-log trend reports. This is a new capability. The engine plumbing, ClickHouse discovery and the documentation overhaul land here, because trends need them.
  - Phase 2 (drover 5.3.0): the engine swap behind today's error reports, with identical output. This is speed only for reports that already work.
  - Phase 3: spread of one error (`--widespread`), cross-project mode and the noise filter.
- **Jev stays optional with either engine.** ClickHouse does not need Jev. When Jev is enabled, the ClickHouse path must give it the same inputs Python does.

## What the experiment established

- On 26 project-months of real logs (15.9M events), 78 of 78 project × month × log-type aggregates were identical to `aggregate_files()`: fingerprints, counts, channel, severity, severities, days, summary, first three samples and group order.
- 6.4× faster overall (365 s → 57 s); the busiest month went from 73.7 s to 6.1 s. Small months gain nothing, because start-up costs a few tenths of a second.
- Peak memory is about 2.8 GB against about 1.07 GB for Python, because ClickHouse reads a whole month at once.
- A three-round council (`gpt-6.1-sol`, `claude-opus-5-5`, `gemini-4-argon`) approved it as an experiment.

Gaps the error-report engine (phase 2) must close:

1. `first_seen` / `last_seen` per group (`report.py` and `causes.py` read them).
2. Top-level `metadata` (files read and missing).
3. Jev severity classification for watchdog `unknown` severities.
4. Runs of invalid UTF-8 bytes fingerprint differently (Python: one U+FFFD per byte; `toValidUTF8()`: one per run).

## Phase 0: groundwork (small, independent)

- **Fix the manifest crash.** When the manifest lists `apache-access`, `report.py` parses for 77 s and then exits with `no parser for log_type='apache-access'`. Two client projects hit this today. The report path should skip types that have no parser and say so, instead of failing late. Ship this as its own patch release (5.1.1).
- **Land the experiment** as a pull request, with `results/` and `bin/` still gitignored.

## Phase 1: access-log trend reports (drover 5.2.0)

Goal: answer "how is this site's traffic changing?" month over month, from the `apache-access` logs drover already knows how to download.

### Getting the logs

- `acquia-pull` already downloads `apache-access` when the manifest lists it. Nothing to build there.
- `init` keeps `apache-error`, `drupal-watchdog` and `php-error` by default. It gains a question: also collect access logs for trends?
  - The question states the cost. Access logs are the largest type: about 1.5 GB of text a month on the busiest projects, roughly 10× smaller gzipped as stored.
  - The answer writes `apache-access` into the manifest's types for that environment.
- `report.py` keeps skipping types it has no parser for (5.1.1), so error reports are unaffected.

### Monthly rollups

Trends compare many months, and raw access logs are large. So each month is summarised once and the summary is kept:

- `scripts/trends.py` runs one ClickHouse query file per un-summarised month and writes `.drover/rollups/<env>/apache-access/<YYYY-MM>.json`.
- A rollup holds finished numbers, not states to merge, so nothing is ever summed across buckets that cannot be summed:
  - month totals: requests, bytes, unique client IPs, total response time, p50/p95, counts per status class plus exact 404s
  - one row per day: requests, bytes, unique client IPs for that day, p50/p95, 4xx and 5xx, requests per visitor class
  - named user agents (top 60) with class, requests, total response time and bytes
  - top hosts, and the top 200 routes by requests and by total response time, each with p95, 5xx, 404 and non-human counts
  - probe classes with requests, requests answered 200 and unique client IPs
- Month-level unique IPs are counted over the whole month at build time; trend reports compare the average of the daily counts, never a sum of them.
- A month is re-summarised only when its log files change (names, sizes and modification times recorded in the rollup).
- Rollups are small (kilobytes to a few megabytes) and contain no raw lines. They keep trend history even if the raw logs are later pruned; pruning is a separate decision.
- Rollups contain client paths and hosts, so they stay in the project's gitignored `.drover/` like the logs.

### Trend report

One `traffic-trends` report (Markdown, or JSON rendered by a `traffic-trends` HTML template) reads rollups only, so a 12-month report takes seconds once the rollups exist. It shows the last N months (default 6), compares per-day rates so partial months compare fairly, and has four sections:

- traffic: requests per day, unique IPs per day, share of 4xx and 5xx, p50/p95 response time, and a daily series for the latest month
- crawlers: browsers, search engines, AI crawlers and other bots as a share of requests, and named agents with their change
- routes: busiest routes by requests and by total server time, with the biggest risers and fallers
- security probes: `/_fragment`, WordPress, secrets and admin-tool probes per day, and how many were answered 200

The existing `examples/traffic-analysis-report` and the experiment's `sql/explore/02..05` queries are the starting material. Charts follow the `dataviz` skill and drover's existing Velir-branded shell.

### Engine requirement

- Building a rollup requires ClickHouse. Without it the report stops with an install hint (exit 3); months that already have a current rollup need no ClickHouse. There is no Python access-log parser.
- Rollups make a Python fallback feasible later, because each month is parsed only once. Not in scope for 5.2.0.
- The engine plumbing described under phase 2 (`engine.py` discovery, minimum version, `DROVER_CLICKHOUSE`, memory cap) is built here, in phase 1.

### Tests

- Synthetic access-log fixtures only. Cover: combined log format variants Acquia emits, IPv6 clients, quoted user agents with escaped quotes, missing response time, request lines that are not valid HTTP, and a month split across files.
- A Python reference count over the fixtures checks the rollup totals exactly.
- Rollup invalidation: changing a log file re-summarises that month only.

### Documentation (phase 1)

The documentation overhaul listed under phase 2 moves here, with trend-specific additions:
- the `init` access-log question and its disk cost
- the trend report in `skills/report/SKILL.md`
- what rollups are, where they live and that they are safe to delete (they rebuild from logs)

## Phase 2: ClickHouse engine for error reports (drover 5.3.0)

This is the original engine swap. `engine.py`, discovery and the docs overhaul already exist from phase 1; this phase adds the error-report SQL, the parity work and `auto` fallback for error reports.

### Engine selection

- New `scripts/engine.py`. `aggregate_files()` keeps its signature and dispatches:
  - `DROVER_ENGINE=python|clickhouse|auto` (default `auto`), and a `report.py --engine` flag that overrides the environment variable.
  - Binary discovery, in order: `DROVER_CLICKHOUSE` (a path), then `clickhouse` on `PATH`. The minimum version is checked with `clickhouse local --version`; 26.10 is the version verified.
- **`auto`:** use ClickHouse when it is found and at the minimum version. On any ClickHouse error, print one warning line and rerun that type on Python. The report never fails because ClickHouse is missing or broken.
- **`clickhouse`:** fail loudly. This mode is for tests and benchmarks.
- **Recording the engine:**
  - The JSON output gains `"engine": {"name": ..., "version": ..., "fallbacks": [...]}`.
  - The Markdown and HTML footers name the engine.
  - The terminal summary prints the engine and the time taken.
- Per-month dispatch stays as in the experiment: one `clickhouse local` process per log type per month (the SQL needs one month folder per run). The prior month uses the same engine.
- `php-error` stays on Python in both modes. It is small, and its stack-trace state machine is not worth porting.

### Code moves

| From (experiment) | To |
| --- | --- |
| `experiments/clickhouse/sql/{functions,watchdog,apache_error}.sql` | `scripts/sql/` |
| `ch_aggregate.py` (`load_sql`, `run_sql`, `resolve_day`, `rows_to_aggregate`) | `scripts/ch_engine.py` |
| `bench.py` | `scripts/bench_engines.py` (a developer tool, not a skill) |
| `explore.py`, `sql/explore/`, `build_demo.py` | stay in `experiments/`; phase 2 promotes the useful queries |

The `\s`/`\S` rewrite in `load_sql()` keeps its comment-enforced rule. A unit test fails if a SQL file uses `\s` inside a `[...]` class, other than the known `[^\s/]`.

### Closing the gaps

1. **First and last seen.**
   - Each bucket already corresponds to one file and one day key. Add the earliest and latest timestamp text per bucket:
     - watchdog: the `HH:MM:SS` part, combined in Python with the resolved day
     - apache-error: the full timestamp, parsed by `parse_apache_ts()`
   - `rows_to_aggregate()` takes the minimum and maximum `datetime` per group.
   - This adds two string aggregates per bucket and no extra pass over the data.
2. **Metadata.** Built in Python from `files_for()`: files read, files missing, types and range, as `aggregate_files()` does today.
3. **Jev.**
   - Python asks Jev once per daily file: `_classify_unknown_severities()` ranks that file's `(channel, message[:400])` keys among `unknown`-severity events and caps them at 100 per file, so a month can ask far more than 100 keys.
   - When Jev is enabled, run one small extra query first that reproduces this per file: keys grouped by `_file`, ranked by count with ties in encounter order, top 100 per file.
   - Ask Jev about exactly those `(file, key)` pairs, in the same per-file batches, then pass the confident answers back into the main query as a parameter table keyed by file and key, applied before grouping.
   - The cause-merge Jev gate in `causes.py` runs on groups and needs no change.
   - Parity is tested with a stubbed Jev client.
4. **Invalid UTF-8.** Also return a count of lines failing `isValidUTF8()` from the same query. If any file in a month has such lines, rerun that log type for that month on Python. That keeps outputs exact at almost no cost, because the corpus has none today.

### Memory

- Set `max_memory_usage` (default 4 GB, overridable with `DROVER_CLICKHOUSE_MAX_MEMORY`).
- Exceeding it is a ClickHouse error, so `auto` mode falls back to Python for that type.
- The 2.8 GB peak is documented in the README.

### Tests

- **`tests/python/test_ch_parity.py`:** synthetic fixtures only, never client logs. It folds in every edge case the council found:
  - orphan lines before the first header
  - continuation lines and their ownership
  - severity ties and group-order ties
  - mixed Apache modules
  - padded days and impossible clocks
  - Unicode whitespace and lowercasing
  - CRLF line endings
  - invalid UTF-8 (expecting the fallback)
  - embedded pipes
  
  Each case asserts that `bench.compare()` reports identical output, with group order checked. The test is skipped when no binary is found.
- **`tests/python/test_engine.py`:**
  - dispatch rules
  - a missing binary, a too-old version and a ClickHouse error all fall back
  - forced mode fails
  - the engine field appears in the JSON
- **New `.github/workflows/drover-tests.yml`** (drover has no CI today):
  - runs the Python tests on `ubuntu-latest`
  - in a second job, downloads the pinned ClickHouse build first so the parity suite runs instead of being skipped
- **Real-log benchmark before release:** run `bench_engines.py` over every captured month. The bar is 78/78 identical, now including first/last seen, with Jev off. The results stay local and gitignored.

### Documentation overhaul (built in phase 1; phase 2 adds the error-engine parts)

The goal: a fresh machine gets from nothing to a ClickHouse-backed report by following the docs alone, and the skills tell the agent exactly what to check and install.

- **`drover/README.md`**
  - Replace "Pure stdlib Python" with an engines section: what each engine does, how `auto` picks, the fallback rule, and the speed and memory numbers with their caveats.
  - Fix the stale "5.0" heading.
- **`drover/ONBOARDING.md`**
  - Retitle it; it still says "drover 2.0".
  - Add an optional step: "Install ClickHouse for faster reports", with the macOS and Linux commands, the 945 MB size, and how to confirm the binary is found.
- **`skills/report/SKILL.md`**
  - Prerequisites gain an engine check that prints which engine will run.
  - If ClickHouse is absent and the month is large, the skill may suggest installing it. It must ask before installing, because of the size, and never install unasked.
  - Document `--engine`, `DROVER_ENGINE`, `DROVER_CLICKHOUSE` and the fallback warning text.
- **`skills/init/SKILL.md`:** init reports whether ClickHouse was found, at which version, and which engine reports will use. The engine is per-machine, so nothing is written to the manifest.
- **Root `DEPENDENCIES.md`**
  - Add a `## clickhouse` section:
    - macOS: `brew install --cask clickhouse`
    - Linux: the official `curl https://clickhouse.com/ | sh` single-binary download, or the vendor apt repository
    - size, minimum version, the `DROVER_CLICKHOUSE` override
    - "Used by: optionally drover (`report`)"
  - Add `clickhouse` to drover's optional column in the by-plugin table.
- **`admin/skills/install/references/dependency-map.md`:** add a `clickhouse` row (macOS and Linux). Mark it optional and large, so a bulk install asks first.
- **`drover/CHANGELOG.md`:** a 5.2.0 entry. Bump the version with `admin:bump-version`.

## Phase 3: spread, portfolio and noise (later release)

- **Spread of one error.** `drover:report --widespread <fingerprint>` joins an error to the access logs and reports days seen, pages, signed-in users versus anonymous events, client IPs and share of requests per page. The experiment's `Html::escape()` example on one client project is the acceptance case.
- **Cross-project mode.** Run a trend template across every project under a root, for portfolio views. Rollups make this cheap.
- **Noise.** An optional per-project noise filter, such as Acquia Purge chatter (96% of one client project's watchdog entries), applied at report time. Applying it at pull time to save disk is a separate decision, because it discards data.

## Risks

| Risk | Mitigation |
| --- | --- |
| Binary size (about 945 MB) and macOS quarantine on download | Optional engine; Homebrew cask as the documented route; skill asks before installing |
| ClickHouse version drift changes SQL behaviour | Minimum-version check; parity suite in CI on a pinned build; `bench_engines.py` before each release |
| RE2 versus Python regex semantics (Unicode `\b`, `\d`, `\w`; `splitlines` separators) | Documented; the parity suite covers known cases; the real-log benchmark guards the rest |
| Memory on a much bigger month | Memory cap plus automatic fallback |
| Silent divergence in `auto` mode | Engine and fallbacks recorded in the JSON and footer; release gate is 100% parity on real logs |

## Acceptance (phase 1: trends)

- On a real project with six months of access logs, the `traffic-trends` report renders all four sections, and a rerun with unchanged logs re-summarises nothing.
- Rollup totals match a Python reference count on the synthetic fixtures exactly, and match a direct ClickHouse scan of the raw logs on one real month.
- Without ClickHouse, trend reports stop with the install hint and error reports still work.
- On a clean macOS account, following only `ONBOARDING.md` and `admin:install` ends with a trend report.
- A fresh council review of the phase 1 pull request.

## Acceptance (phase 2: error-report engine)

- The parity and engine tests pass in CI, and the parity job actually runs ClickHouse.
- The real-log benchmark is 100% identical, including first/last seen and the metadata values that can be compared.
- With Jev stubbed, the ClickHouse and Python paths give identical severities and merges.
- Removing the binary, or setting `DROVER_CLICKHOUSE=/nonexistent`, gives the same report on Python, with an `auto` fallback recorded.
- On a clean macOS account, following only `ONBOARDING.md` and `admin:install` ends with a ClickHouse-backed report.
- A fresh council review of the phase 2 pull request.

## Work items (create as Beads issues at kickoff)

1. Phase 0: report skips types with no parser (5.1.1). Done in branch `fix/drover-report-skip-types`, not yet merged.
2. Phase 0: land the experiment as a pull request.
3. Phase 1: `engine.py` discovery, minimum version, memory cap.
4. Phase 1: `init` access-log question; manifest types.
5. Phase 1: access-log parsing SQL and monthly rollups with invalidation.
6. Phase 1: the `traffic-trends` report (Markdown, JSON and HTML template) and charts.
7. Phase 1: synthetic fixtures, rollup tests, `drover-tests.yml` workflow with a ClickHouse job.
8. Phase 1: documentation overhaul (README, ONBOARDING, report and init skills, DEPENDENCIES, dependency map, CHANGELOG, version bump).
9. Phase 1: real-project check and council review.
10. Phase 2: move the error SQL and `ch_engine.py`; `auto` dispatch and fallback for error reports; engine recorded in output.
11. Phase 2: first/last seen, metadata, Jev key query, invalid UTF-8 fallback.
12. Phase 2: parity tests, real-log benchmark and council review.
13. Phase 3: `--widespread`, cross-project mode, noise filter.
