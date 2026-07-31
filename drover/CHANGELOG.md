# drover Changelog

## 2.2.5
- Shrink all 4 skill descriptions to a routing-sufficient summary; the full trigger-phrase detail moves into each SKILL.md body under `## When to use`, where it loads on invocation instead of sitting in context every session.
- Saves roughly 1,387 characters (~346 est. tokens) of always-resident context.
- Descriptions keep the distinctive tool vocabulary and the "not for X, use Y" disambiguation, so routing between sibling skills is unchanged.

## 2.2.4 — report defaults: branding, light mode, and print layout

- **Footer no longer names internal tooling.** It read `Prepared by Velir ·
  drover <version>`; a client has no idea what drover is. Now just
  `Prepared by Velir`.
- **Light is the default; dark is opt-in.** Two
  `@media (prefers-color-scheme: dark)` blocks meant a reader whose OS was in
  dark mode got a dark report — and a dark PDF — without ever choosing it. Dark
  now applies only when the toggle sets it, and the toggle's own fallback no
  longer reads the OS preference.
- **PDFs always print light.** The print stylesheet forced a white page
  background but left the dark tokens in place, so exporting while dark was
  toggled produced near-white text on white paper. Print now re-declares the
  light values over `:root[data-theme="dark"]`, including the twelve
  severity-pill token pairs that a first pass missed and that left the pills
  dark-filled on an otherwise light page.
- **Sections flow instead of taking a page each.** `h2.section` forced
  `break-before: page`, stranding short sections on two-thirds-empty pages —
  four bars alone on a sheet. Its stated purpose (headings never at a page
  bottom) is already served by `break-after: avoid`. One-idea-per-page is a
  deck layout and will live in the deck template. A sample report went from 7
  pages to 6, with page 1 now carrying the summary *and* the first chart.
- **Logo resolution hardened.** Adds `$DROVER_LOGO` and
  `.drover/branding/velir-logo.png` overrides, mirroring how `DESIGN.md`
  already resolves, and raises a clear error instead of silently rendering an
  unbranded header. Note the bundled logo already applied by default — this is
  hardening, not a bug fix.
- **Renders report what they resolved.** The run summary printed `design:` but
  not `logo:`; it now prints both, so "did branding apply?" is answerable from
  the output instead of by reading source.
- **Docs state that branding needs no setup.** `ONBOARDING.md` and
  `skills/init/SKILL.md` previously never mentioned the logo or `DESIGN.md`,
  so a new user had no reason to believe they weren't expected to supply them.

## 2.2.3 — coverage ledger integrity

The ledger could disagree with the files actually on disk, and
`/drover:report` reads it for coverage caveats — so a report could claim gaps
that had already been filled. Found on a real project: 10 of 60 tuples were
recorded as absent while every one of the files was present and verified.

- **Concurrent runs no longer clobber each other.** `save_coverage` rewrote
  the whole file from an in-process snapshot, so two runs against one project
  each loaded the ledger at start and the later save silently discarded
  everything the other had written. The in-process lock cannot help — it does
  not span processes. The write is now a read-merge-write under an exclusive
  `flock`. Measured with four concurrent writers of 25 entries each: before,
  74 of 100 entries were lost; after, all 100 survive.
- **Concurrent runs no longer crash.** Every process staged through the same
  `coverage.tmp`, so one process's rename could steal another's staging file
  and raise `FileNotFoundError` mid-write. Staging is now per-process.
- **Stale states are corrected.** The startup scan wrote the ledger only when
  an entry was missing, so an entry with a *wrong* state survived every later
  run even though the file was sitting on disk. A present file now forces the
  entry to `present`, and the correction is logged.
- A malformed on-disk ledger no longer crashes the write.

## 2.2.2 — store what the filename claims

- Downloads are sniffed for the gzip magic number and compressed only when it
  is absent. Acquia serves these logs already gzipped, and nothing
  re-compresses a payload that arrives compressed — that would spend CPU to
  shave a constant factor off a cost that is already small (gzip achieves
  roughly 28x on this data). But the stored path always ends `.log.gz` and
  every reader picks its opener from that suffix, so a payload arriving
  uncompressed would have been stored under a name that lies about its
  contents.
- `dominant_month_day` now raises `UnreadableLogFile` when a file cannot be
  decoded, instead of returning `None`. Previously `gzip.BadGzipFile` — a
  subclass of `OSError` — was caught and collapsed into the same `None` that
  means "readable but no dates found". The caller reads `None` as "cannot
  verify", so a corrupt download skipped verification entirely, was recorded
  `present`, and failed much later at report time, far from its cause.
  Verification failures now delete the file and retry like any other.

## 2.2.1 — create pacing and concurrent-writer safety

- Log-create pacing no longer holds the lock across its sleep. Creates
  serialized behind it across every group, and each group idled a full
  `rate_limit_s` after firing before it could begin polling. Slots are now
  claimed from a shared monotonic schedule, with the lock held only for the
  claim. The spacing guarantee between creates is unchanged and now tested.
- File presence is re-checked immediately before spending a snapshot request.
  The up-front scan only describes the filesystem at start-up, so a long run
  gave another writer time to land a file that the run still intended to
  fetch. Such a day is now skipped and recorded `present`.

  This does **not** make two concurrent pulls safe against each other. Acquia
  keeps one packaged file per `(env, type)`, so overlapping runs still clobber
  one another's snapshots; the guard against acting on a clobbered file is the
  post-download verification, not this check.

## 2.2.0 — pull observability, verified snapshots, extensible HTML and PDF delivery

### Pull progress is now visible while it happens

- Every notification status check is reported, so a snapshot that is still
  building is distinguishable from one whose status call is failing. Acquia
  packages logs asynchronously — request, build onto S3, then download — and
  the build leg previously produced no output at all for minutes at a time.
- A failing status check no longer disappears into `except Exception: pass`.
  The underlying error is carried into the `fetch-failed` reason instead of
  being replaced by a bare "poll deadline exceeded".
- An errored status check no longer leaves a stale status value standing from
  an earlier successful check.
- Snapshot request and download start are each reported, so the three legs of
  the Acquia flow are individually visible.
- stdout and stderr are line-buffered. Python block-buffers stdout when it is
  redirected to a file or pipe, which held every progress line until the run
  ended and made a working pull look identical to a hung one. Callers no
  longer need `python3 -u`.

### Post-download verification (was present in source but never released)

- Every downloaded file is verified before being recorded `present`: its
  dominant log date must match the requested day, and it must not be
  byte-identical to another day already pulled in the same group. Mismatches
  are deleted, marked `snapshot-mismatch`, and retried once. This ships the
  guard against Acquia's one-snapshot-per-(env,type) staleness, which
  previously produced mislabeled duplicate files.

### Extensible HTML and PDF delivery

- HTML is now the report skill's default editable artifact; PDF is the final
  stakeholder delivery artifact. The direct Markdown path remains supported.
- HTML templates are discovered from explicit directories, environment
  configuration, `.drover/templates`, and the bundled folder. Project templates
  and partials can override bundled names without changing plugin code.
- `cloudflare-summary` is now documented, carries a sample input, and derives
  its timestamp from input so HTML output remains deterministic.
- Reusable report partials cover headers, footers, coverage warnings, metric
  cards, horizontal charts, and prose callouts. `COMPONENTS.md` documents the
  template data contract and graph helpers.
- Project design overrides are automatically discovered at
  `.drover/design/DESIGN.md`; `--design` and `DROVER_DESIGN` remain explicit
  overrides. Print page size and margin are design tokens.
- `render-pdf.mjs` supports final PDF generation through installed Chrome,
  Chromium, or Edge, with an explicit support matrix in `PDF.md`.
- Removed the remote Google Fonts import so rendered HTML is genuinely
  self-contained; local IBM Plex installations and system fallbacks are used.

## 2.1.0 — HTML reports

Adds a self-contained, Velir-branded HTML output alongside the existing
markdown reports. Markdown remains the default; HTML is opt-in via a
two-stage Python→Node render path.

- **`report.py --format json`** — new `generate_data()` emits a
  schema-versioned (`drover_schema_version: 1`) structured aggregate:
  meta, coverage, totals (by severity/channel/day), fingerprint groups
  (raw + cause-collapsed), MoM deltas, and JIRA ticket specs. Same
  deterministic pipeline as the markdown path; one JSON file per
  month/env. `--template` is ignored when `--format=json`.
- **`render-html/`** — Node renderer (`render.mjs` → `render-core.mjs`)
  turns that JSON + `assets/design/DESIGN.md` tokens into HTML via
  Handlebars. All CSS inlined; logo embedded as a data URI; output is
  byte-deterministic. Low-coverage banner gated at <90%.
  - All five report views render in HTML: `monthly-client`,
    `root-cause-summary`, `calendar-boundary`, `triage-brief`,
    `jira-ready`.
  - Interactivity beyond the markdown path: persisted dark-mode toggle
    (with `prefers-color-scheme` fallback), chart hover tooltips,
    real-time search + severity filtering (triage-brief, jira-ready),
    one-click clipboard "Copy Specs" (jira-ready).
  - Shared chrome (theme init, toggle button, toggle handler) lives in
    `templates/partials/` and is registered once, so it can't drift
    across templates — a render test asserts the toggle handler is
    byte-identical in all five.
  - **No vendored `node_modules`.** Deps install lazily on first render
    (one-time `npm ci` from a committed lockfile); `render.mjs` is a
    builtin-only bootstrap so it loads before deps exist. Requires
    Node ≥20.
- Tests: `generate_data()` schema/determinism/serialization +
  `--format json` CLI (Python, unittest); per-template render +
  coverage-gate + determinism + cross-template drift guard
  (Node, `npm test`).

## 2.0.1
- Logs are now stored compressed (`.log.gz`) — 5-10× space savings, no decompression after download.
- Parsers and aggregator transparently read both `.log.gz` and `.log` so older uncompressed captures still work.
- Drover artifacts auto-locate outside `worktrees/` when run from inside a worktree, keeping `.drover/` at the project root.

## 2.0.0 — Pivot: log-analysis pipeline (clean break from v1)

Drover is now a Drupal/Acquia application-error log analysis pipeline.
The v1 product (live monitoring + dashboard + kanban + auto-fix) has
been retired wholesale. Anyone who wants the v1 experience installs
the `drover-1.51.2` tag.

**New surface — four skills, no UI:**

- **`/drover:init`** — discovery + manifest write. Reads drush
  aliases, composer.json, .ddev/config.yaml, acquia-pipelines.yml;
  resolves Acquia app UUID + env list + log types via the Cloud
  Platform API; writes `.drover/manifest.json`. JIRA project key,
  board, and default sprint are hand-edited into the manifest's
  `jira:` block today; `/drover:init` auto-detection lands in 2.1.
  Zero prompts in the happy path.
- **`/drover:acquia-pull`** — historical log download by date.
  Talks to the Acquia Cloud Platform API directly via the existing
  stdlib client; uses the documented `from`/`to` parameters on the
  log-snapshot endpoint to pull any 24-hour window in the last 30
  days. Idempotent reconcile against `.drover/coverage.json`. Modes:
  `--daily`, `--backfill`, `--from/--to`, `--date`, `--env all`.
  User-triggered, not scheduled — drover does not ship a cron
  template; the pull script is small, idempotent, and exit-code-
  correct so any external scheduler wraps it cleanly.
- **`/drover:report`** — render a markdown monthly report. Five
  templates:
    - `monthly-client` — stakeholder summary
    - `root-cause-summary` — Pareto cut + cause diagnosis + JIRA recs
    - `calendar-boundary` — events-by-channel bar chart for windowed
      analysis (campaigns, holiday boundaries)
    - `triage-brief` — dev-facing fingerprint detail
    - `jira-ready` — paste blocks for JIRA's create-issue dialog
  Stakeholder templates carry a Velir 2025 logo + brand palette and
  emit a sidecar JSON of ticket specs for downstream creation.
  Cause diagnosis from a 17-pattern library covering the most
  common Drupal/PHP/Apache shapes (entity_embed display drift,
  SQLSTATE errors, Acquia Solr flood-protection, login-attempt
  patterns, cron lock contention, routine cron instrumentation
  noise, PHP fatals, Twig errors, route-not-found, cache-backend
  unavailability, Apache child-process death, etc.). Fingerprints
  sharing the same diagnosed root cause collapse into one report
  entry and one JIRA ticket — the same Solr flood-protection error
  surfacing in both `search_api` and `acquia_search` becomes one
  issue, not two. Deterministic — no LLM in the rendering path.
  Coverage caveats are surfaced automatically when any day is
  missing or fetch-failed.
- **`/drover:create-tickets`** — file the report's recommended
  tickets in JIRA. Three execution paths share the same stable plan
  schema (`drover_plan_version: 1`):
    - **Atlassian MCP** — Claude calls `mcp__*atlassian*` /
      `mcp__*jira*` tools directly. Drover writes a plan; Claude
      reads it and invokes the matching MCP tools. No shared API
      token needed.
    - **Direct REST** — drover's built-in executor talks to
      Atlassian Cloud's REST API. Needs `JIRA_API_TOKEN` env.
    - **Plan-only** — drover writes the plan; the operator runs
      the writes themselves with jira-cli, the web UI, or custom
      tooling.
  Per-ticket sprint assignment + parent linking are best-effort:
  failures don't undo the issue creation; they're captured in a
  results sidecar.

**Architecture (pure stdlib Python):**

- `scripts/monitors/acquia_api.py` — patched with `from`/`to` support
  on `request_log_download()` and a new `get_log_download_url()`
  that captures the 301 → S3 redirect without poisoning S3 with
  the Acquia auth header. Retry-on-5xx-and-timeout via the same
  `_urlopen_with_retry` helper.
- `scripts/init.py` — discovery cascade + manifest builder.
- `scripts/pull.py` — single-day primitive + multi-day reconcile
  loop with retries, polite rate limiting, and incremental ledger
  checkpointing so partial progress survives a crash.
- `scripts/parsers/` — three deterministic parsers (apache-error,
  drupal-watchdog with continuation-line folding, php-error with
  stack-trace folding) emitting a uniform event shape.
- `scripts/aggregate.py` — fingerprint + group + count using v1's
  `fingerprint_structured` so issue keys remain hash-compatible
  with v1 history. MoM delta annotation.
- `scripts/causes.py` — 17-pattern cause-diagnosis library with
  honest "undiagnosed" fallback for unknown shapes. Operators
  extend by adding entries to `PATTERNS`. Includes
  `collapse_by_cause()` for cross-channel de-duplication.
- `scripts/charts.py` — pure-stdlib unicode bar charts that render
  correctly in every markdown viewer.
- `scripts/branding.py` — Velir 2025 brand palette + base64-embedded
  logo so rendered markdown is self-contained.
- `scripts/report_writer.py` + `agents/report-writer.md` — agent
  scaffolding for future LLM prose synthesis on top of the
  deterministic report.
- `scripts/report.py` — five template renderers + CLI.
- `scripts/jira_recs.py` — ticket-spec builder (title cleanup,
  priority heuristic, label assignment, cause linkage, multi-
  fingerprint collapse).
- `scripts/jira_api.py` — stdlib Atlassian Cloud REST client; reads
  credentials from manifest > `~/.drover/jira.json` > `jira-cli`'s
  config > `JIRA_API_TOKEN` env.
- `scripts/create_tickets.py` — three-mode orchestrator (REST
  executor / `--plan` JSON for external executors / interactive).

**Removed in 2.0:**

- `scripts/monitors/` watchers (acquia-watch, ddev-watch, wp-watch,
  bd-ready-watch, umbrella-watch) — gone. Application-error
  monitoring is out of scope.
- `tools/dashboard/` (~10K-line live SSE dashboard) — gone.
- `tools/kanban-ui/` — gone.
- `agents/triage-agent.md`, `agents/implementer-agent.md` — gone.
- `bin/drover` CLI for managing watchers — gone.
- `hooks/` session-start hook — gone.
- `monitors/monitors.json` — gone.
- 9 v1 skills (add-project, baseline, backfill, board, dashboard,
  implement, recall, reset-state, run, setup, solution, triage,
  verify, watch) — gone. Replaced by 3 (init, acquia-pull, report).

**Carried forward from v1:**

- `scripts/monitors/acquia_api.py` (patched, kept its stdlib client)
- `scripts/fingerprint.py` (the deterministic core only — bd-card-
  creating wrappers retired)
- `tests/python/test_fingerprint.py` and `test_acquia_api_errors.py`
- `tests/bats/_libs/` vendored bats helpers

**Test suite:** 182 tests across 9 modules, all stdlib, no live
network. Live verification scripts (`/tmp/recon-*.py`) preserved
outside CI for ad-hoc validation.

**Verified end-to-end against PNCB:**

- April 3rd download: 5,691 lines / 1.29 MB drupal-watchdog
- 3-day backfill (April 4–6): 3 fetches in 3m12s
- April monthly-client report: 380 fingerprint groups from 2,964
  events, top issue correctly identifies a real DB query bug in
  cron (severity=error, count=231)

## 1.51.2
- **Per-source toggles are now truthful.** When you flipped off a source pill (say, `apache-request` on AHRI prod), the config + side-file updated correctly, but the *running* acquia-watch process kept its original `DROVER_LOG_TYPES` and kept receiving apache-request events from Acquia's WebSocket. The UI was lying on top of a watcher that didn't care.
- Root cause: `resubscribeEnv` killed only the pidfile-tracked child. If the umbrella respawned the watcher without updating the pidfile (or if the watcher got orphaned to `ppid=1` during an umbrella-subshell race), the pidfile pointed at nothing and the orphan watcher lived on.
- Fix: added `killWatchersByKey(key)` which does a safety-net `pkill -f` against the watcher's argv signature (`acquia-watch.py <env>.<uuid>` for Acquia, `ddev-watch.py <project>` / `wp-watch.py <project>` for DDEV). The pidfile kill runs first, then the argv kill catches any orphans. Confirmed end-to-end: toggle off → old watcher (pid X, env=`drupal-watchdog,apache-request`) dies → umbrella respawns (pid Y, env=`drupal-watchdog`) → zero apache-request pulse events for the next 30s.

## 1.51.1
- **LIVE badge tells the truth when ingestion is paused.** New state `paused` (grey, no pulse, label `PAUSED`) that overrides `idle`/`live` whenever the master toggle is OFF. Previously the badge stayed on `idle` after toggling off because the SSE connection remained open and non-ingestion events (ddev-status heartbeats every ~30s) kept ticking the "last event" clock — making the toggle look like it did nothing. Now the badge reflects ingestion state as a separate dimension from SSE health.
- State matrix:
  - `LIVE` (green pulse) — SSE connected, ingestion ON, events in last 2 min
  - `IDLE` (yellow) — SSE connected, ingestion ON, no events recently
  - `PAUSED` (grey) — ingestion OFF (takes precedence over SSE signals)
  - `CONNECTING` (yellow) — SSE reconnecting
  - `OFFLINE` (red) — SSE disconnected, dashboard may be down
- `renderIngestionToggle` now publishes `window._ingestionRunning` and calls `refreshLiveBadgeFromState()` on every state change so the badge updates instantly instead of waiting for the next SSE tick.

## 1.51.0
- **Master ingestion on/off toggle in the dashboard header.** Sits next to the LIVE badge as a pill — green `●  ON` when watchers are running, grey `○  OFF` when paused. One click calls the new `POST /api/ingestion/stop` / `/api/ingestion/start` endpoints which wrap the existing `stopAutoIngestion()` / `startAutoIngestion()` functions. The dashboard UI stays up while ingestion is paused — operators can stop the stream mid-demo without losing their current view and flip it back on when ready.
- **New SSE event `ingestion-state`** broadcasts stop/start transitions so multiple browser tabs stay in sync.
- **`drover start` now only rejects on a real LISTEN** on port 3749. Previously used `lsof -ti:$PORT` which also returned client-side connections (e.g. a Chrome tab viewing the dashboard), so a freshly-stopped port could falsely report "in use" immediately after `drover stop`.

## 1.50.0
- **`drover` CLI for on/off control.** Single script at `drover/bin/drover` with four subcommands:
  - `drover stop` — kills every drover-owned process (dashboard, umbrella-watch.sh, acquia-watch.py, ddev-watch.py, wp-watch.py, bd-ready-watch.py) with SIGTERM then SIGKILL for holdouts, clears stale pidfiles, preserves side-files.
  - `drover start` — launches the dashboard (which arms its own umbrella, which spawns watchers from each env's side-file).
  - `drover restart` — stop + 2s settle + start. The escape hatch from the orphan-zoo states we hit tonight.
  - `drover status` — reports running process counts per monitor + count of stale pidfiles.
- **Fixed: fresh dashboard starts ingest subscriptions from drover-config.json.** Side-files (the umbrella's `DROVER_LOG_TYPES` overrides) are now bootstrapped at startup by `bootstrapSideFilesFromConfig()`. Before: if no user toggle had fired since startup, no side-file existed → acquia-watch subscribed to every available type → unwanted varnish-request / bal-request / drupal-request traffic bled into the pulse feed even when the config said `sources: ['drupal-watchdog']`. After: one side-file per indexed env at startup, first watcher spawn is correctly scoped.
- **Net: apache-request on AHRI prod now produces apache-request lines only** — the streaming proof works cleanly for the demo without collateral traffic from other envs.

## 1.49.1
- **Traffic-log events flow through to the pulse feed in real time.** Enabling `apache-request` (or any `TRAFFIC_TYPES` log — `drupal-request`, `fpm-access`, `bal-request`, `varnish-request`) now emits one pulse event per event instead of dropping on the floor.
  - Root cause: `fingerprint.py` explicitly filters access-log lines (*"HTTP access-log lines — error-like words in URLs are not errors"*) via `ACCESS_LOG_RE`. Every successful request line returned `None` from `classify()`, so the fingerprint pipeline produced no events. `handleUmbrellaLine` in the dashboard also only recognized `NEW` and `THRESH` prefixes; any `TRAFFIC` aggregate line from `acquia-watch.py` was silently dropped.
  - Fix path: `acquia-watch.py` now honors `DROVER_TRAFFIC_PASSTHRU=1` and emits a `TRAFFIC-LINE <log_type> <http_status> <alias> <raw text>` for every traffic event. `umbrella-watch.sh` sets that env var on every spawned child, so any env with a traffic source enabled immediately starts surfacing per-line events. Dashboard's `handleUmbrellaLine` gains a `TRAFFIC-LINE` branch that records a `traffic-line` pulse event (no bd card — these are not errors).
  - `TRAFFIC` aggregate summaries (one per `DROVER_TRAFFIC_INTERVAL=1000` events) now also flow to the pulse feed with a digest (`count=N status=200:950 404:50`) so operators who prefer the aggregate view get that too.
- **Demo use case unlocked.** Toggle on `apache-request` on any Acquia env and the pulse feed ticks in lockstep with the WebSocket — visible proof the live layer is not a polling loop.

## 1.49.0
- **Per-env log-source toggles in the project drawer.** Every env in a project drawer now renders its full list of available log sources as clickable pills — not just the enabled ones. Green pill = streaming, grey dashed pill = available-but-paused. One click flips the state; the drawer re-renders in place without close/reopen.
  - **Acquia envs** show the full canonical inventory: `drupal-watchdog`, `apache-error`, `php-error`, `fpm-error`, `apache-request`, `drupal-request`, `fpm-access`, `bal-request`, `varnish-request`.
  - **DDEV envs** show platform-detected inventory: Drupal → `drupal-watchdog` + `apache-error` + `php-error`; WordPress → `wp-debug` + `apache-error` + `php-error`.
  - Toggling uses the existing `POST /api/sources/toggle` endpoint; the server drops a side-file with the new `DROVER_LOG_TYPES` and asks the umbrella to re-spawn the env's watcher with the fresh subscription set. No restart needed.
- **`available_sources` field on every env in `/api/projects/overview`.** The drawer consumes it directly; the earlier field `enabled_sources` is unchanged so nothing else had to move.
- **`toggleEnvSource(alias, type, turnOn)` client helper** for the per-pill click. Hits `/api/sources/toggle`, toasts the result, then re-renders the open drawer in place against the fresh overview — same pattern as the existing `toggleEnvTracking` for env-level pause/resume.

## 1.48.0
- **Groups keep growing.** Group parent rows now render a selection checkbox (alongside the ⊞ glyph), not just a decorative symbol. A group is a living collection, not a frozen snapshot — you can add items to it after it's created.
- **Smart primary CTA on mixed selections.** The bulk-bar primary button now branches on selection shape:
  - *2+ groups selected*: disabled, label *"Pick one group + items"* (merging groups is out of scope).
  - *1 group + 1+ individuals*: *"Add to group (N) & Document…"* — POSTs to the new `/api/groups/:id/members` endpoint, refreshes the board, opens the group's sheet in write mode.
  - *0 groups + 1 individual*: *"Document…"* (single-mode sheet, unchanged).
  - *0 groups + 2+ individuals*: *"Group & Document…"* (new group + sheet, unchanged).
- **Bulk-bar count is shape-aware.** The label now reads *"N errors + M groups selected"* instead of a flat total.
- **`/api/groups/:id/members`** — new POST endpoint to grow an existing group. Same dedupe + label-write-first rollback pattern as `/api/groups` create. Members already in any group return 409 with per-member conflicts. Re-adding an existing member of the same group is a silent no-op.
- **Secondary *Group* button is now strictly for new-group creation** — enabled only when selection is 2+ individuals and 0 groups. Tells you to use the primary button if you meant to grow an existing group.
- **Mark-as-noise** on a mixed selection silently skips any groups in the selection and acts on the individuals only. Prompt wording reflects the split (*"…skipping N groups"*).
- **`classifySelection` helper** underneath it all — resolves `SELECTED` ids against `ALL_CARDS` (individuals) + `GROUPS` (synthesized parent via `synthesizeGroupCard`) so group IDs in the selection resolve correctly, since `ALL_CARDS` holds individuals only.
- **Pulse event `group-grew`** fires on each add-to-group with `{added: [...], conflicts: [...]}` payload.

## 1.47.1
- **Simplify pass** across drover after a parallel three-lens review (reuse / quality / efficiency).
  - **Parallelized per-member bd writes in `handleGroupSolution`.** `writeActualToCard` is now async and the group handler `Promise.all`s over the target set. At N=10 this collapses ~80s of worst-case serial A13-timeout exposure to a single concurrent wait, and stops blocking the event loop during the operation.
  - **Debounced `renderTable` on search keystroke** (150ms). At 500 cards typing was visibly laggy — each keystroke rebuilt the tbody and ran the full filter chain.
  - **Debounced client `fetchAll()` on SSE events** (200ms). `board-update`, `cycle-complete`, `ingest-event`, and `groups-update` events coalesce; a single umbrella line firing multiple broadcasts now produces one refresh instead of N × 6 endpoint hits.
  - **`invalidateAndBroadcast(event, payload)` wrapper.** The `ticketCache = {data:null,ts:0}` + `broadcast(...)` pair used to appear at 10+ call-sites; a future handler that forgets the invalidation would serve stale data until TTL expired. Wrapper introduced and applied at every adjacent pair.
  - **Dropped `_docCounterCache`.** The scan is cheap (low hundreds of cards, one pass), keystroke renders are now debounced, and the `ALL_CARDS` identity invariant it relied on was fragile. Deleted entirely.
  - **Extracted `drover/scripts/monitors/common.py`.** `ddev-watch.py` and `wp-watch.py` shared ~110 lines of byte-identical tail-subprocess + queue + fingerprint-emit logic; both collapse to ~30-line wrappers now. A bug fix to the shared loop lands in one place instead of two. State-checkpoint failure at shutdown logs to stderr (previously swallowed silently).
  - **`umbrella-watch.sh` projects-file gate.** Switched the inline Python heredoc from shell-interpolating the file path into a single-quoted string (injection risk if the path carried a quote) to passing via `sys.argv[1]`.

## 1.47.0
- **Tags (vision-doc Phase 4 partial).** Capture columns on both single-mode and group-mode sheets now include a comma-separated *Tags* input. Stored on the Actual markdown block as `- **tags:** drupal-core, mysql-8, cron` when set; becomes the substrate for cross-ticket facets in future work. Typeahead over past-used tags is deferred.
- **Scratch notes (vision-doc Phase 3 / Slice H).** The single-mode sheet's Understand column gets a dashed-border, italic textarea labeled *Scratch notes* with the help text *"Working thoughts while you investigate. Cleared when you save documentation; stays on this device until then."* Content is persisted to `localStorage` keyed by card id, auto-cleared on successful save. Not posted to the server — this is the thinking surface, not the archive surface.
- **Data-model extension.** `tags: string[]` is now a first-class field on the Actual block builder, accepted by both POST endpoints; absent = untagged; capped at 20 entries.

## 1.46.0
- **Category picker + template hints (vision-doc Phase 4 / "Write with scaffolding").** Both single-mode and group-mode Capture columns now lead with a Category dropdown: Database issue · Permission / access · Configuration · Third-party module · Deployment · Performance · Security · Other. Selecting a category surfaces a short info-tinted hint below the field — "Name the query pattern that failed, the Drupal/MySQL version, and the canonical workaround" for DB issues, and category-appropriate text for each of the others. Fills the blank-textarea gap the earlier draft named as the weakest spot in the capture experience.
- **Data model extension.** `category` is now a top-level field on the Actual markdown block when present. Backwards-compatible: absent = untagged. Both `/api/cards/:id/solution` and `/api/groups/:id/solution` accept the field; `buildActualBlock` emits it when set.
- **DRY capture helper.** Shared `buildCategoryField(idPrefix)` + `CATEGORY_OPTIONS` / `CATEGORY_HINTS` constants drive both surfaces from the same table, so taxonomy edits land in one place.

## 1.45.0
- **One-click openers (vision-doc Phase 3 / "Investigate").** Understand column on the single-card sheet now carries:
  - **Open approot** — reveals the project's repo root in Finder. Always enabled when the card carries a project.
  - **Open in PhpStorm** — appears when the card's top stack frame has a parseable `path.php:line` (or `path.php(line)`) signature. Opens via the `phpstorm://open?file=...&line=...` URL handler. Supports `.php`, `.module`, `.inc`, `.theme`.
- **Two new server endpoints gate these against arbitrary-path requests**:
  - `POST /api/openers/approot { project }` → resolves the name against `projectsModule.listProjects()`; runs `open <path>` on match, 404 otherwise.
  - `POST /api/openers/editor { project, file, line }` → file is resolved relative to the project approot; absolute paths must live inside the approot or the request is rejected with 400.
- Neither endpoint touches the network or the bd database; both are scoped to the local filesystem.

## 1.44.0
- **Structured error view in the sheet's Understand column (vision-doc Part I Stage 1).** The old single-block watchdog-pipe-soup title display is replaced by labeled fields: `CLASS`, `MESSAGE`, and — when the title carries the Acquia-style ` · `-separated parts — `HOOK` and `URL`. The raw title stays accessible behind a `▸ Show raw title` disclosure so no information is lost.
- **Client-side `parseWatchdogTitle`** drives the parse. Splits on ` · `, classifies each chunk (path-URL, host-only URL, hook token, bracketed severity), and falls back to the flat title when the format doesn't match. Combined with the existing `parseCardClient.extractException`, the sheet now renders the class + message cleanly whether the title was a pipe-soup or a plain string.

## 1.43.0
- **Bulk-action bar polish (vision-doc Phase 2 / Stage 3 Decide).** The toolbar under the table that appears on row selection is now the four-CTA bar from the vision doc:
  - **Primary**: *Group & Document…* (N>=2) / *Document…* (N=1). One click takes the operator from "these are the same bug" to the group's capture sheet — no intermediate "now go click the group" step.
  - **Secondary**: *Group* — group without opening the sheet, for the "I'll document later" path.
  - **Tertiary**: *Mark as noise* — bulk-silence. One reason-prompt, N serial POSTs to `/api/cards/:id/noise`.
  - **Quiet**: *Clear* — right-aligned, low-emphasis.
- **Primary button gets a filled treatment** (solid `--info` background) so the primary-action rule from ui-ux-pro-max reads correctly.
- **Keyboard separation on focused rows.** `Enter` opens the row's sheet (as before). `Space` now *toggles row selection* instead of opening the sheet — matches the spec in document-flow-vision Part I (Stage 2). Group rows (no checkbox) fall through to open.

## 1.42.0
- **Group-mode sheet (vision-doc Phase 5).** Clicking a group parent row now opens the same right-docked full-height sheet as a single-card click, adapted to group mode:
  - **Understand column**: aggregate *Details* (member count, projects, total occurrences, first/last seen), *Shared across members* rollup showing the majority value + `(N of M match)` badge for class and source plus per-env counts, and a clickable *Members* list where each row drills into the single-mode sheet for that card.
  - **Capture column**: *Have we seen this before?* recall seeded with the first member's id (members share shape by definition, so recall's output is the same), the *Writes to* checklist with live count (uncheck = ungroup before saving), and the three capture fields.
  - **Footer**: *Dissolve group* lives here; *Document* is the primary Save inside the Capture column. Group and single sheets now present identical shell chrome.
- **Retired**: `openGroupModal` (the centered "Group · X" dialog with *Document group* / *Dissolve group* buttons) and `openGroupDocumentForm` (the Back-to-overview relay). Both are replaced by `openGroupSheet`. Dead code removed — ~227 lines.
- **Questions doc** at `docs/questions-for-chris.md` introduced. A durable scratchpad for design decisions in flight, non-blocking judgment calls, and slice-level backlog. Used during the midnight-burn autonomous-work mode.

## 1.41.0
- **Single-mode Document sheet (vision-doc Phase 1).** The per-card Document modal is retired; its replacement is a right-docked full-height sheet with two independently-scrollable columns:
  - **Understand** (left, ~45%, read-only surface): *Details* grid (severity, fingerprint, occurrences, envs, age, lane, project, hostnames), the parsed *Error message*, the *Stack trace* when present, the *Triage log* when present, and *Agent notes* (Projected block, muted) when an implementer-agent has run. Everything the operator needs to understand the error before writing about it.
  - **Capture** (right, ~55%, write surface): *Have we seen this before?* recall matches at the top — per vision, recall is the answer to the understanding question before it's the answer to the documenting question — then either the existing Documented block (read-mode) or the capture form (write-mode) with Mark-as-noise as a secondary action.
  - The footer (*Move to* dropdown + Dashboard / advance buttons) stays full-width across both columns.
  - Narrow viewports (<900px) collapse to a single column with Understand stacked above Capture.
- **Other modals unchanged.** The sheet treatment is scoped to the single-card Document flow; the group modal, group Document form, Add Project, Sources, and Backfill modals remain centered — each now explicitly removes the `.sheet` class on open so toggling between flows never leaks styling.
- **Refactor: shared bd-write contract.** `handleSolution` and `handleGroupSolution` now both route through `buildActualBlock` (single vs group Actual markdown) + `writeActualToCard` (the two-call append-then-move-lane bd pattern with the 15000ms A13 timeout). Future bd-flag or Actual-schema changes land in one place instead of two.
- **Group save correctness tightened.** bd writes now run first on a pure partition of the membership; group state mutations (ungroup labels, auto-dissolve, groups-file write) happen only after at least one write landed. Complete write failure returns 500 with the group unchanged so the operator retries from a clean surface. Fixes the partial-failure case where ungroup labels could be pulled before any documentation had actually persisted.
- **Counter memoized.** `updateDocCounter` caches on `ALL_CARDS` identity; search-keystroke rerenders no longer rewalk the array.

## 1.40.1
- **Contribution feedback (vision-doc Phase 9).** Small polish around the save moment so the operator sees they just contributed knowledge to the system.
  - **Documentation counter** in the table toolbar, next to the errors count. Quiet green pill reading *"✓ N documented this week"* — hidden when N=0, self-respecting. Counts cards whose Actual block's `verified_at` is within the past 7 days.
  - **Single-card post-save toast** rewritten from the accurate-but-bureaucratic *"Actual solution saved. Ticket X closed."* to the letter-to-a-future-operator wording: *"Documented. Your notes will help the next operator who sees this."*
  - Group-mode save toast (shipped in 1.40.0) already carries the *"Documented N errors with one solution"* copy, so both single and group paths now land on the same emotional beat.

## 1.40.0
- **Group-mode Document flow ships (vision-doc Phase 6, partial).** Documenting a group is now a first-class action, not a per-member chore.
  - **Group modal** gains a primary `[ Document group ]` button alongside the existing `Dissolve group`. Clicking it replaces the overview with a Document form scoped to the group.
  - **"Writes to" checklist.** Every current member of the group appears with a checkbox, default-checked. The save button's label carries the live count (*"Save group documentation (N)"*).
  - **Uncheck = ungroup before saving.** This is the groupthink semantic from `docs/document-flow-vision.md`: groups commit to one truth. Unchecking a member strips its `group-<id>` label, drops it from the group record, and excludes it from the propagation. It becomes a plain single-mode card.
  - **One solution, many cards.** New endpoint `POST /api/groups/:id/solution` takes one set of root_cause / fix_summary / fix_commit_sha fields and writes the same Actual block to every remaining member's bd card. Each member is moved to `lane-done` with the same two-call write pattern as the per-card `handleSolution`. Partial failures surface per-member in the `errors` array.
  - **Auto-dissolve at save.** If the group shrinks below 2 members during save (operator unchecked all but one), the group record is removed and the singleton is ungrouped cleanly on the way out.
  - **Pulse event** `group-documented` fires once per group save with `{applied, ungrouped, dissolved}` counts so the pulse feed tells the knowledge-capture story without double-counting per-member writes.
- Vision doc (`docs/document-flow-vision.md`) continues to describe the fuller sheet + three-mode design targeted for phases 1, 5, 8–9. This release is the wiring underneath it.

## 1.39.1
- **Docs sweep** catching the written product up to what the 1.39.0 code actually does.
  - **`README.md`** rewritten. Tagline is now *"Drover watches your Drupal sites' error logs and captures what you know about each error — so the next time a similar one surfaces, you're not rediscovering the fix."* Retires the "opens fix PRs for you to review" language. The implementer-agent is called out explicitly as an opt-in / experimental capability, not as part of the primary product.
  - **`ONBOARDING.md`** rewritten from Step 5 onward. The first-run walkthrough is now *trigger a fake error → document it → see the recall loop fire on a second similar error → group across projects*. The "watch drover attempt a fix" step is removed. Glossary updated — `Document`, `Recall`, `Group`, `Pulse`, and an honest `Lane` listing with `noise` as a terminal state.
  - **`docs/user-stories.md`**: story §8 rewritten around documenting as the primary action; story §9 rewritten around the recall engine. New story §16 for *Dismiss as known noise*, §17 for *Advisor-agent: suggest a solution from history* (planned), §18 for *Implementer-agent: opt-in, not the product* (shipped). §15 reframed as documentation narrative rather than autonomy narrative.
  - **New: `docs/grouping-spec.md`** — full companion spec for the cross-project grouping feature (user-stories §12/§13): data model with natural keys, bd-label dual-write ordering, UX for selection and bulk bar, group modal behavior, the planned suggestion engine and its signal weights, the planned solution-propagation flow, and a testing checklist.
  - **`agents/implementer-agent.md`** and **`skills/implement/SKILL.md`** carry an explicit scope-note header: "Not part of drover's primary product. Opt-in / experimental." The skill's description is rewritten so agent-selection prompts see the scope boundary without having to read the body.

No runtime behavior changes in this version — this is documentation catching up to the 1.39.0 rescoping.

## 1.39.0
- **Drover's primary action is now "Document," not "Confirm fix."** The product is an error-tracking + documenting system with an optional advisor-agent that reads history. Not a fix pipeline. UI reframed accordingly.
- **Row-level Document CTA.** Every row for a card that hasn't been documented yet carries a `Document` button in a new rightmost column (warn-accent pill, distinct from the body text). Clicking it opens the modal with the capture form pre-expanded and focus landed on the root-cause field. Documented rows show a muted `✓ documented`; noise rows show a muted `⌀ noise`; group rows defer to the group modal.
- **Header chip: "N need documentation."** Orange/warn chip next to the LIVE badge counting cards in `lane-triage` / `lane-ready` that haven't been documented. Click to toggle a filter that narrows the table to those cards; re-click to clear. The product's primary ask, at a glance.
- **Recall — "Have we seen this before?" — in the capture modal.** New `GET /api/recall?card_id=…&project=…` endpoint. Given any card id, scores every other card's documented Actual block by: exception-class match (0.6), fingerprint match (+0.4), source match (+0.1), env match (+0.05), message-token Jaccard overlap (up to +0.25). Returns top 5 matches ≥0.2. The modal surfaces these at the top of the Documentation section with an **Apply this** button that prefills the capture form with the past root_cause / fix_summary / fix_commit_sha. The advisor role you described, using history as its data.
- **"Mark as known noise" flow.** New `POST /api/cards/:id/noise` endpoint + button in the modal. Prompts for a reason, moves the card to `lane-noise`, emits a `noise-marked` pulse event. Legitimate terminal state for an error-tracking tool — errors that will never be acted on shouldn't clog the queue.
- **Lane de-emphasis.** `lane-implementing` and `lane-awaiting-review` are tagged `optional:true` in the LANES model and hidden from the Lane sidebar facet unless at least one card is actually in them. The product's primary pipeline is triage → ready → documented (with noise and closed as terminal states). The implementer-agent workflow still exists for opt-in use; it's just no longer what the UI leads with.
- **Language:** "Record Actual solution" → `Document this error`. "Save + close ticket" → `Save documentation`. Pulse event type `solution` → `error-documented`. "Projected" solution block renders as muted "Agent notes (optional) — not drover's documentation" at the bottom of the section, so the human's Documented block is clearly the authoritative record.

## 1.38.0
- **Groups use a natural key: `{project, card_id}` tuples.** The 1.37.0 storage used bare `sprint-abc` ids, which aren't unique across projects (each `.beads/drover.db` has its own prefix space — two projects can both produce `sprint-abc`). Membership now requires the `{project, card_id}` tuple on the wire and on disk, so "pncb's sprint-abc" and "ahri's sprint-abc" can never collide. Conflict-check, lookup, and fold all key by the tuple.
- **Group membership is written into the individual project's bd database.** On create, the server writes a `group-<grpId>` label onto each member card via `bd update --add-label`. On dissolve, the label is removed via `--remove-label`. This means:
  - `bd list -l group-<grpId> --db <project>/.beads` returns the group's members in that project.
  - `drover:recall`, the triage agent, the implementer agent, and any other bd-facing tooling can see membership natively without the dashboard acting as a gatekeeper.
  - Membership propagates to the project's own view of its work, not just the aggregate dashboard.
- **Write ordering is safe.** Labels land in bd BEFORE the group record is saved to the JSON file; if labels partially succeed, the server rolls back the additions and fails. If the JSON write fails after labels succeed, labels are reversed. Net result: the bd mesh and the groups file never disagree about which cards belong to which group.
- **Failure modes documented in the response.** `handleGroupDissolve` returns `label_errors: []` when removals couldn't reach every project's bd (for example, a project's bd db got moved) — the group is still deleted from the JSON (orphan labels are strictly less harmful than orphan group records).
- **Client sends tuples.** `groupSelected` composes `[{project, card_id}, ...]` from the selected rows; lookup + fold key on the tuple; rows missing a project qualifier (shouldn't happen in virtual-central mode, but defensively) surface a toast and are skipped.

## 1.37.0
- **Groups actually group.** The 1.36.0 stub is promoted to a real feature. Selecting ≥2 rows and clicking *Group selected* now POSTs to `/api/groups`, which persists to `$CLAUDE_PLUGIN_DATA/drover-groups.json`. The table re-renders with member cards folded into a single parent row (purple left-accent, group-glyph in the select column, `[group-name] N errors · project·list`). Sort keys apply to the parent (worst severity, max lastSeen, sum occurrences, most-advanced lane).
- **Group modal.** Clicking a parent row opens a group modal with the member list (each row clickable through to its own ticket modal), a Details section (member count, projects, total occurrences, first/last seen), and a Dissolve button. Dissolving restores members to their own rows.
- **SSE + pulse wiring.** `groups-update` broadcasts on create/dissolve so other open dashboards refresh in real time. `group-created` / `group-dissolved` events appear in the pulse feed.
- **Server-side constraints.** A card can only belong to one group (409 on conflict). Group name truncated to 120 chars; member ids deduped.
- **Still stubbed for post-demo:** the similarity-based suggestion engine (spec'd in user-stories §12), solution propagation across members, cross-project fingerprint matching hints. This release lands the core data model + UX; v2 lands the intelligence on top.

## 1.36.0
- **Row-selection primitive for grouping.** Leftmost column in the error table is now a checkbox per row. Clicking the checkbox does **not** open the row modal (stopPropagation); clicking anywhere else on the row still does. A header "select all" checkbox toggles every visible row and honors filter scope. Selected rows render with a purple tint. Selection state (`SELECTED` set of card ids) survives across filter changes and sorts — rows that leave the filtered view stay selected and reappear checked when they return.
- **Bulk action bar** slides in above the table when selection count > 0: `N selected · [ Group selected ] · [ Clear ]`. `Group selected` is disabled until N ≥ 2.
- **Group creation — stub.** `Group selected` currently captures intent via toast + console log and clears the selection. Full implementation (parent/child row rendering, server-side group store, similarity-based suggestion engine, solution propagation) is scoped in [drover/docs/user-stories.md §12](./docs/user-stories.md) and will land in a follow-up feature branch. This release ships only the UX primitive — the column, the bar, the selection model.

## 1.35.1
- **Error cell now uses the space the Option-C layout gave it.** Two regressions fixed in one pass: (a) `.err-title` had `white-space: nowrap; text-overflow: ellipsis` which clamped every message to one truncated line — removed, replaced with a 3-line clamp that allows wrap and word-break; (b) the render was showing only the extracted post-colon tail (`sqlstatets: syntax error or ac`) instead of the full original title, throwing away URL paths, hook names, and watchdog pipe fields. The class chip remains as a visual anchor; the rest of the original title now renders alongside it, wrapped to as many lines as the clamp allows. Drupal watchdog pipe separators (`|n|`, `|ip|`) render as visible `·` bullets so the URL / hook / request-path fields are distinguishable.

## 1.35.0
- **Table refocuses on the error.** Project / Env / Source / Lane columns removed. The table now reads `[Sev] [Last seen] [Count] [Error →]` where Error takes all remaining horizontal space. This reflects the product's unit of work: what's broken, how bad, how often. Context (which project, env, source, lane) is still surfaced — it lives in the row modal and in the sidebar facets, which are the right affordances for "should I act on this" and "narrow to these" respectively.
- **Lane joins the sidebar facet rail.** Fourth facet after Severity / Environment / Project. Displayed in pipeline order (TRIAGE → READY → IMPLEMENTING → AWAITING REVIEW), not alphabetical, so "Ready" is visually where your eye expects it.
- **Count moves left of Error.** Reading flow is now severity → when → impact → message. The eye takes in the three-number triage-at-a-glance signal before committing to the text.
- **Error cell flexes to the viewport edge** (no right-side column boundary). Long messages have real room before they truncate. Hover tooltip reveals the full `Class: message` when truncation does happen.

## 1.34.0
- **Project facet in the filter sidebar.** Alongside Severity and Environment, the sidebar now carries a **Project** section with one checkbox per registered project (`acu`, `ahri`, `massport`, `pncb` — alphabetical, `-main` stripped to match the Projects-panel + Error-table Project column). Counts reflect open cards per project; projects with zero open cards still appear so the chip set is stable across refreshes. Click to narrow the table; multi-select ORs within the facet and ANDs across facets (same semantics as Severity / Environment).

## 1.33.2
- **Umbrella now respects per-project `drover-config.json`.** The `list_projects()` emission previously walked every env in `projects.json` and handed them all to the umbrella as spawn candidates, regardless of whether the user had paused them. Net effect: clicking "Tracking off" on an env in the UI wrote `sources: []` to the config, but the umbrella kept spawning a child for that env anyway and streamed its logs in silent defiance of the config. Fixed by gating each `ddev:<name>` and `acquia:<env>.<uuid>` emission on the matching env having a non-empty `sources` array in that project's drover-config. `bd-ready:<path>` pollers still emit unconditionally (they read the local board, not log streams). Net effect: the UI's env toggles are now the actual source of truth for what gets tailed.

## 1.33.1
- **Final layout: Header → Projects → Pulse → Table.** Projects now sits directly below the header — the admin context comes first, then the live event stream, then the actionable queue.
- **`OPEN BY ENV` chip row removed.** The env-health sidebar facet already provides per-env filtering, which is a stronger affordance than a read-only decorative chip row. Dropping it also cleans one more vertical band off the dashboard.

## 1.33.0
- **Pulse is now the hero, not an addition.** The old "Pulse" section (env-tile grid + error-volume sparkline + last-triage-cycle card) is retired. In its place: the live Pulse feed opens by default at page load, taking ~360px of vertical real estate and showing drover's actual event stream as it happens. One heartbeat surface, not two.
- **Env health collapses to a compact chip row.** The question "is anything on fire?" still matters, but doesn't deserve three large tiles. `OPEN BY ENV · prod 24 · test 33 · local 4` now sits as a single inline chip row below the Projects panel, colored by worst-severity per env and muted when zero.
- **Error-volume chart and Last-triage-cycle card retired.** The sparkline was decorative, not decision-informing; the cycle card always lied about process liveness. Both call sites are stubbed as no-ops so existing render wiring survives without surfacing the UI.

## 1.32.0
- **Pulse strip.** A new always-visible heartbeat row sits directly under the header. When collapsed it shows the most recent structured event drover emitted: `15:33:32 · env-on · pncb.test · Tracking on · drupal-watchdog`. Click the strip to expand a scrollable feed of the last 60 events in reverse chronological order. The dot beside the "Pulse" label pulses green when activity has occurred in the last 2 minutes; otherwise it goes grey. `prefers-reduced-motion` disables all pulse-strip animation (entrance, transitions, pulsing dot).
- **Event types + color coding.** Each event carries a type: `fingerprint-new` / `fingerprint-augment` (red-ish, for new or augmented error fingerprints), `lane-change` (blue), `solution` (green), `env-on` / `env-off` (green / muted), `watcher-start` / `watcher-restart` / `watcher-arm` / `watcher-stop` (blue / muted). Type pills are color-coded and left-border accents pop new fingerprints and solutions.
- **New SSE channel `pulse-event` + server-side ring buffer.** Every meaningful state transition is recorded via a new `recordPulse()` helper: new-card ingestion, threshold augmenting, lane moves, solution capture, env toggles, umbrella watcher lifecycle. The server keeps the last 200 events in memory; clients hydrate via `GET /api/pulse?limit=60` on load so the feed is never empty when history exists, then stream live via SSE.
- **Honest empty state.** When no events have been seen yet, the expanded feed says: *"No events yet. Toggle a project env or wait for an ingest — every meaningful transition drover makes will appear here."* No fabricated activity, no pulsing lies.

## 1.31.0
- **Error table rewritten.** New columns, ordered by operator read-priority: `Sev · Last seen · Project · Env · Source · Error · Count · Lane`. Every column remains sortable via the existing header-click handler.
- **Age → Last seen (absolute timestamps).** Age strings are retired from the table — they staled out between renders and answered the wrong question. `Last seen` renders as `HH:MM:SS` for events today and `MM/DD HH:MM` for older ones, with the full ISO + first-seen timestamp in the cell's tooltip. Default sort is `Last seen ↓` so the top of the table always answers "what happened most recently?"
- **Error column is now readable.** The triage-agent-emitted titles (`[ERROR] other: https://... |n| simple_cron |n|| drupal\core\database\databaseexceptionwrapper: sqlstatets: syntax error or access viol`) are parsed client-side into an exception class + one-line message. Class renders as an info-blue monospace chip; message follows. Truncated titles (which have no colon+message tail) promote the last backslash-path segment into the class slot so the row is never blank.
- **Env column drops the redundant hostname.** Used to show `prod · pncb.prod.acquia-sites.com`; now renders just the env slug with an inline `↗` link-out icon. Hostname moves to the tooltip. Saves ~200px horizontally.
- **Source column added.** `watchdog`, `apache-error`, `drupal-request`, `php-error`, etc — extracted from the `source-*` label (triage cards) with a body-field fallback. Muted chip for `other`/`unknown`.
- **Project column strips trailing `-main`** to match the Projects-panel labels.
- Search filter now matches on exception class, message, source, project label, fingerprint, and env in addition to the raw title.

## 1.30.1
- **Narrower project tiles.** Tile width trimmed from `min-width:240 / max-width:320` to `min-width:170 / max-width:230`. With the vertical env-toggle stack the old width was mostly whitespace — four projects now fit comfortably in the first half of the panel on a 1440px dashboard.
- **Drawer carries per-env toggles.** Each environment block in the drawer's Environments section now has its own `role="switch"` toggle — identical control surface to the tile, co-located with the env's listener method, last-event age, and source list. Toggling an env from inside the drawer flips the config and updates the block in-place; the drawer stays open so the user doesn't lose context.
- **Tile re-render no longer closes an open drawer.** The panel refresh path used to `existingPop.remove()` before re-creating each drawer, which forcibly closed whatever the user had open. Now we reuse the existing popover element across renders and only re-run `renderProjectDrawer` on the drawer if it's currently open.

## 1.30.0
- **Project tiles redesigned as compact listener strips with a popover drawer.** Each project tile is now a horizontal `[dot] name | vertical env-toggle stack` row. Each env row carries its own switch toggle and a per-env proof-of-life (`12s`, `4m`, `armed · no events`) keyed off the ingestion bus's per-source `lastTs`. Clicking anywhere on the tile opens a per-project drawer using the native HTML **Popover API** (`popover="auto"`) — no modal, no focus-trap code, browser handles dismiss and accessibility. Escape closes.
- **Drawer is the project's single-pane admin surface.** Three sections:
  - **Environments** — one block per env showing listener method (`ddev drush watchdog tail` / `Acquia logstream (WSS)`), last-event age, alias/trust/app_uuid/drush_alias/events/watcher pid, and the currently-enabled log source pills.
  - **Project** — DDEV instance + status + approot + URL, drush aliases, Acquia app UUID, full path to `drover-config.json`, full path to the project's Beads DB.
  - **Diagnostics** — per-env watcher liveness, armed-vs-running counts, orphan-watcher detection (a pid alive but env paused shows up here). This is the doctor corner that used to be mixed into the main page.
- **Shared Sources button hidden.** Per-project sources live in each project's drawer now; the legacy top-bar Sources modal stays in code (hidden) so `Seed history` remains reachable without removing its wiring.
- **`/api/projects/overview` enriched**: each env row now includes `listener_method`, `last_event_ts`, `event_count`, `watcher_pid` (from umbrella pidfiles), `ingest_key`, and identity bits (`env_slug`, `app_uuid`, `drush_alias`, `trust_level`). Projects carry `config_path`, `bd_db_path`, `ddev_http_url`, and `drush_aliases` so the drawer never needs a second round-trip.

## 1.29.1
- **Safe-by-default tracking: local on, remote off.** Drover's first-start policy is now explicit: local DDEV envs stream on first launch with `drupal-watchdog` (or `wp-debug` for WordPress); **remote Acquia envs start paused with `"sources": []`** and require an explicit per-env opt-in. Spinning up drover should never begin tailing production before the user says so.
  - `/drover:setup` schema updated — DDEV template seeds `["drupal-watchdog"]`, Acquia template seeds `[]`, with a new "Default tracking policy" section documenting the principle.
  - `/api/sources/inventory` no longer pre-checks `drupal-watchdog` on Acquia envs that have no canonical config — the Sources modal opens with every remote source unchecked until the user opts in. DDEV inventory still pre-selects the platform default, which is low-risk (user's own container).

## 1.29.0
- **Env chips are now toggles.** Click an env chip in any project tile to flip tracking on or off for that `(project, env)` pair. Paused → click → streams the platform-default source (`drupal-watchdog` for Drupal, `wp-debug` for WordPress). Streaming → click → clears all sources for that env and stops the watcher. The server writes the project's `.claude/drover-config.json` and signals the umbrella to respawn/stop the relevant tailer. Chip ARIA is `role="switch"` with `aria-checked` reflecting truth.
- **Header LIVE badge is now truthful.** The always-pulsing green "live" label is replaced by a state machine bound to the `/events` EventSource: **connecting** (amber) while the socket is opening, **live** (green) when connected and an event has arrived in the last 120s, **idle** (amber) when connected but silent for >120s, **offline** (red, no pulse) when the connection drops. Tooltip surfaces the last event's name + age so "is monitoring actually working?" is answerable by hovering the badge.
- **No more duplicate project name on tiles.** Project tile header is now a single `[dot] projectname`; the right-side DDEV instance name (which duplicated the project label after "-main" stripping) is gone. The DDEV status dot's tooltip carries the instance name.
- New endpoint: `POST /api/sources/env-toggle` — `{alias, enable}` → flips all sources for the env on or off, returns the new sources list and resubscribe action.

## 1.28.0
- **Top panel pivots from DDEV to Projects.** The "DDEV Instances" strip is replaced by a **Projects** panel where each tile represents one registered drover project (not one DDEV container). Each tile shows the project name, its designated DDEV instance with a live running/stopped/error dot, and a row of env chips (local · staging · production · …) sourced from `.claude/drover-config.json`. Chips with ≥1 enabled log source render green with the source count; chips with no sources configured render muted as "paused". Projects without a drover-config surface an amber CTA ("run /drover:setup in this project"). Unregistered-but-running DDEV instances drop into a dashed "Running · not watched" row below the registered projects with a "+ Add" affordance, preserving the existing onboarding flow.
- **Honest live-monitoring.** The previous empty-state card — which fabricated LIVE/events/last-event numbers from umbrella process liveness — is retired. The "Last triage cycle" card now hides itself entirely when no `~/.claude/drover.state.jsonl` cycle exists, instead of inventing stats. The actual "what are we streaming right now?" signal is carried by the Projects panel's per-env source counts, which key off config truth rather than process state.
- **Canonical env tiles.** Card env labels emitted as `env-<ddev_project>` (AHRI-main, pncb-main, massport, acu, …) are canonicalised to `local` both server-side (in `/api/health`) and client-side (in `parseCardClient`), so the Pulse row collapses all DDEV-sourced cards into a single `local` tile instead of one tile per project. Acquia env labels (`prod`, `test`, `dev`, `stage`, `content`, …) pass through unchanged. This also reshapes the sidebar Environment filter, which now offers canonical env names as facets.
- New endpoint: `GET /api/projects/overview` — unified per-project view returning registered projects with their configured environments, enabled-source lists, and DDEV instance status, plus a sidecar list of unregistered-but-running DDEV instances.

## 1.27.0
- **Wordmark V matches the favicon.** The inline `<em>v</em>` in the `drover` wordmark is replaced by the same three-color split-palette V used in the tab favicon (drover-red + Velir green/blue cap), so the header and favicon read as one brand mark.
- **"Last triage cycle" card surfaces live monitoring when no manual cycle has run.** Previously the card's empty state said *"Run /drover:watch to start"* — a slash command the user can't trigger from the UI. The card now retitles to **Live monitoring** when `HEALTH.lastCycle` is empty and renders umbrella watcher status from `/api/ingestion/status`: LIVE/IDLE badge, total events streamed, armed-vs-registered project count, and last-event timestamp with a relative age. Historical cycle data is still shown verbatim when present.

## 1.26.0
- **Top-bar button renamed Backfill → Sources.** The former Backfill modal is now a two-tab Sources panel, matching Acquia Cloud's own log-stream UI (Stream / Download). Internal URL paths keep the `backfill` name for stability (`/api/projects/backfill`, `/api/backfill/progress`); only user-facing strings change (T3).
- **Stream tab** — live subscription. Flat checkbox list of detected log sources per env, sourced from `AcquiaClient.list_log_types()` (Acquia) or project-platform defaults (DDEV). On first use only `drupal-watchdog` is pre-checked. Toggling writes `environments[].sources` in `.claude/drover-config.json` and signals the dashboard-owned umbrella to restart just that env's watcher with a fresh `DROVER_LOG_TYPES`. No full dashboard or umbrella restart. Per-source "N msgs / N connected" counter + "Listening for stream messages…" empty state.
- **Seed history tab** — one-shot historical pull. Wraps A11's per-type request-state machine (Ready / Not built / Preparing / Failed) inside the new tab chrome. Adds a time-window selector (Last hour / 24h / 7d / 30d / Custom; default 24h), renames the action button to **Seed history**. Progress panel labels and DONE summary use the spec wording: *"Seeded `<sources>` from `<env>`, last `<window>` — N events, M new fingerprints."*
- Keyboard shortcut: `s` opens the Sources panel.
- Legacy snake_case source names (watchdog, php_error_log, nginx_error_log, apache_error_log, wp_debug_log) are treated as "not configured" so the `drupal-watchdog` default applies on first view. First canonical toggle writes kebab-case names (drupal-watchdog, apache-error, php-error, …) that match Acquia's log-type inventory.
- New endpoints: `GET /api/sources/inventory?alias=` and `POST /api/sources/toggle {alias,type,enabled}`. Unchecking the last source stops the watcher (zero events for that env until a source is re-enabled). `sources-update` SSE event broadcasts config changes.
- `scripts/monitors/umbrella-watch.sh` now honours `$DROVER_UMBRELLA_TRACK_DIR` when set so the dashboard can locate per-key pidfiles and source-override files. Falls back to `mktemp -d` for standalone runs.

## 1.25.1
- Bumped `bd` mutation timeouts from 5s to 15s on the user-click hot path (handleMove, handleSolution's append-notes and move-to-done). Under live-ingest load a dolt-backed `.beads/drover.db` intermittently takes 6-8s to respond, which produced sporadic spawnSync ETIMEDOUT 500s when clicking "Save + close ticket" on the card modal (A13). The 5s cap on the parallel board-list fetch at first paint is unchanged by design.

## 1.25.0
- DDEV panel distinguishes registered-with-drover instances from unregistered-but-running ones (T6). Tiles now carry a ✓ watching / ○ not monitored badge; unregistered running tiles render with a dashed border and a primary `+ Add` button. Clicking Add registers the project, re-arms the umbrella so the new watcher spawns, and flips the tile to "watching" without a page reload. `/api/ddev/status` stamps every instance with `registered: bool`; `/api/projects/add` busts the ddev cache and broadcasts a fresh `ddev-status` SSE.
- `add-project.sh` prefers `config.local.yaml`'s `name:` over `config.yaml` when present so worktree-style DDEV setups register under the same instance name DDEV itself uses (e.g. `AHRI-main` for the AHRI worktree rather than the project slug from config.yaml).

## 1.24.0
- Clicking a row in the Dashboard error table now opens the same card-detail modal as clicking a kanban card on the Issues tab (T5a). The previous in-place row expansion, which showed only a re-echo of the title and "No log entries", is retired — every row click now goes straight to Details + Error message + Projected/Actual solution + Move-to + action strip. Board tab behaviour is unchanged.
- Fingerprint row display accepts non-hex identifier tokens (A10). `[a-f0-9]+` was arbitrarily restrictive and left cards whose fingerprint contained any other character rendering as `fp:[unknown]`; the regex now accepts any non-backtick, non-whitespace run between backticks. Applied consistently across the 4 call sites (server-side parse, solution lookup in two writers, client-side parseCardClient).

## 1.23.1
- Fixed: selecting an Acquia env whose project was registered without `app_uuid` in projects.json (e.g. massport.*) no longer 404s with "alias not found". A shared `resolveAliasToAcquia()` helper walks up from the project's path looking for `.claude/drover-config.json` (which carries `app_uuid` per env) and uses that as a fallback (A12).
- Friendlier 403 surface: when Acquia rejects with `forbidden_ip` (the app has an IP allowlist and the local machine isn't on it), the Backfill modal shows a one-sentence human explanation with remediation instead of a Python traceback. The client-side modal also surfaces any server-side `error` payload inline rather than falling through to the silent "No log types found" state.

## 1.23.0
- Backfill modal now respects Acquia's 2-step archive flow (A11). Previously, log types whose archives hadn't been prepared yet were rendered as disabled checkboxes marked "unavailable" — the user had no way to ask Acquia to build one. Each row now renders one of four states driven by the combined Acquia availability flag plus drover's in-flight request state: Ready (checkbox), Not built (Request button), Preparing (spinner + elapsed counter), Failed (Retry button). Clicking Request fires `AcquiaClient.request_log_download()`, the UI flips to Preparing, and a 10-second poll cycle picks up the transition to Ready (or Failed) without any manual refresh. When the archive is ready, the row becomes a pre-checked checkbox; the user then clicks Run Backfill to download and fingerprint the log.
- New endpoints: `POST /api/logs/request` and `GET /api/logs/status?alias=&type=`. `/api/backfill/log-types` response enriched with per-type `state` / `elapsedSec`, and fans out notification-URL polls for any preparing entries before responding so the UI's periodic refresh sees terminal states quickly.

## 1.22.0
- Auto-ingest on dashboard launch (T2): `/drover:dashboard` now spawns a detached-group umbrella watcher at startup (deduped via `~/.claude/drover.umbrella.dashboard.pid`), parses `[<key>] NEW …` lines from umbrella stdout, writes each to the matching project's `.beads/drover.db`, and broadcasts a new `ingest-event` SSE so the UI refetches `/api/board` without a page reload. Previously the dashboard loaded the UI but left ingestion to a separate `/loop` or `/drover:watch` invocation.
- "Listening for stream messages…" empty state on Pulse tiles for quiet projects (mirrors Acquia Cloud's own UI wording), backed by new `/api/ingestion/status` endpoint.
- Graceful teardown: umbrella process group is killed with SIGTERM when the dashboard server exits; no orphan `acquia-watch.py` or `bd-ready-watch.py` processes left behind.
- Segmented view toggle (A9) replaces the Dashboard / Board buttons with one labelled radiogroup. "Board" is relabelled "Issues" in the UI only (internal identifiers unchanged). State persists in `localStorage['drover.view']` and defaults to Dashboard.
- Pulse env-tile dedup (A8): config env `name:"production"` no longer renders as a separate tile from the `env-prod` card label. Each env appears once with a config-provided friendly label when one exists.
- `/drover:setup` now survives two known blockers on fresh projects (T1): the `bd init` deadlock (child git commit blocking on a dolt-locked pre-commit hook) is avoided by running `bd init` with `core.hooksPath=/dev/null` in the child environment + a 30s `perl -e 'alarm'` watchdog. The Acquia credentials flow probes `AcquiaClient.verify_credentials()` first and skips the API-key/secret prompt when an existing `acli` session is valid; a `'skip'` escape hatch lets the user register DDEV-only.
- Virtual-central bd mutation routing (T0): `handleMove` and `handleSolution` now resolve each ticket's source `.beads/drover.db` via a shared `resolveBoardForTicket()` helper. Previously both paths hardcoded `--db DB_PATH`, which was empty in virtual-central mode and failed with `bd update ... --db` "no issue found matching". Lane advance and Record Actual both work across projects.

## 1.21.0
- Stable Apache fingerprints: parser in `fingerprint.process()` strips IPs, timestamps, request_ids, user-agents, vhost path tails, and forwarded_for data before hashing; anchors the canonical shape on the `AHNNNNN` Acquia error code. The 50-row `[ERROR] apache: …` wall that produced `fp:[unknown]` for every line now collapses to a handful of unique fingerprints with real occurrence counts.
- Triage card bodies: `handleTriage` switched from the unsupported `bd create --body` flag to `--description`, so cards now carry `**Fingerprint:** …`, `**Occurrences:** …`, `**Source:** …`, and the raw log line. Occurrence counts render from the persisted acquia-state instead of always reading 0.
- Favicon: the dashboard now serves `/favicon.svg` — a V mark that mixes drover's crit-red wedge with Velir's green/blue chevron cap. Declared via `<link rel="icon">` and `<link rel="mask-icon">` in the dashboard head.

## 1.20.0
- **Cross-env fingerprint dedup on umbrella stdout (sprint-ie4)**: the same fingerprint hitting local + staging + prod within a short window used to produce three separate NEW notifications because watcher state is per-env. The umbrella's stdout filter now runs a cross-env dedup pass (`CrossEnvDedup` in `scripts/monitors/budget_filter.py`) before the budget step. First-seen env's NEW passes through; subsequent different-env sightings of the same fp within `DROVER_DEDUP_WINDOW` seconds (default 60) are suppressed and accumulated into a single `[drover] multi-env fp <fp>: <env1>,<env2>,<env3>` summary line. Same-env repeats are unaffected — those remain the job of BudgetFilter / per-fp THRESH.
- **New pure helper `CrossEnvDedup`**: parse regex extracts fp + env from the `[key] NEW <fp> <severity> <source> <env> <msg>` shape. Five python tests cover suppression within window, no-op on same env, window expiry, multi-env summary emission, and non-NEW passthrough.
- **Composition order**: dedup first (so cross-env collapses don't consume budget slots), budget second.

## 1.19.1
- **Dashboard resolves PROJECT_ROOT from drover-config.json, not `git rev-parse` (sprint-06p)**: worktree-style layouts (AHRI, KELLOGG, etc.) have multiple `.beads/` directories under one git repo — invoking `/drover:dashboard` from `worktrees/main` vs the repo root used to produce wildly different boards (2 cards vs 37). The dashboard skill now walks up from `$PWD` for the nearest `.claude/drover-config.json` and uses that directory as `PROJECT_ROOT`, consistent regardless of cwd inside the worktree tree.
- **Explicit `dashboard.db_path` support**: drover-config.json can now carry `"dashboard": { "db_path": "<path or relative>" }` to pin a single-project dashboard run without setting `DROVER_DB_OVERRIDE` each time. Precedence: env override → config value → `--all-projects` virtual-central fallback.

## 1.19.0
- **Per-session notification budget on umbrella stdout (sprint-89h)**: a deploy burst of 20 unique errors used to become 20 per-event harness notifications in under a minute — the existing `THRESH` was per-fingerprint, not per-session. The umbrella now routes its own stdout through a rolling-window budget filter (`scripts/monitors/budget_filter.py`) via `exec > >(python3 …)`. NEW events exceeding `DROVER_NOTIFY_MAX` (default 10) per `DROVER_NOTIFY_WINDOW` seconds (default 300) are dropped; a "`[drover] N NEW events suppressed`" summary is emitted every `DROVER_NOTIFY_SUMMARY_EVERY` drops (default 5). THRESH / TRAFFIC / anything that isn't `[key] NEW …` passes through untouched.
- **Escape hatch**: `DROVER_NOTIFY_DISABLE=1` bypasses the filter for tests and debugging.
- **Tests**: 5 new python tests for `BudgetFilter` (under-budget passthrough, overflow suppression, non-NEW immunity, sliding window expiry, summary-line emission) + 2 new bats tests confirming the integration path (budget applied, disable flag honored). All 27 umbrella bats tests pass.

## 1.18.0
- **Add Project modal replaces the generic folder picker (sprint-nto)**: clicking + Add Project used to open a free-form macOS folder dialog with no validation — a silent way to register any directory as a drover project. The button now opens a modal with two sections: (a) running DDEV projects that aren't registered yet, each with a one-click Add button; (b) paste-path input + native folder picker fallback. Every path is validated server-side for `.ddev/config.yaml` presence before being handed to add-project.sh, so bad selections fail fast with a clear error.
- **New API endpoint `GET /api/projects/discover`**: returns running DDEV projects not yet present in `projects.json`, diffed against current registrations.
- **New pure helpers**: `projects.hasDdevConfig(path)` for .ddev/config.yaml validation (4 tests) and `projects.listRunningDdevUnregistered({runner, registered})` for the discovery list (3 tests). Runner/registered are injectable so tests don't shell out to ddev.

## 1.17.1
- **Parallel `fetchTickets` (sprint-56q)**: the dashboard previously ran `bd list` sequentially against every registered project's board — N × (bd boot ≈ 300ms + dolt open ≈ 200ms) of serial latency on every first paint. Now each board is queried via `util.promisify(execFile)` + `Promise.all`, so total latency is max-over-boards instead of sum-over-boards. Extracted `queryBoard()` as a dedicated async unit that returns `{project, rows}` or `{project, error}` — partial-failure resilience preserved.
- **Cache prefetch at startup**: `server.listen` callback now fires `fetchTickets()` so the first `/api/board` request paints from cache instead of paying full bd-list latency. Failures are logged but non-fatal.
- **All four `fetchTickets()` callers** (`/api/board`, `/api/health`, `handleMove`, `handleSolution`) now `await` the async function. `fetchHealth()` is async as well.

## 1.17.0
- **In-UI backfill progress indicator (sprint-ydz)**: the Backfill modal used to queue the job and close with a "tail the log" toast — nobody tailed the log. Clicking Run Backfill now swaps the form for a live progress panel that subscribes to a new `GET /api/backfill/progress?log=<path>` SSE endpoint, streaming backfill.sh stdout/stderr line-by-line into a scrolling `<pre>`. A phase badge (QUEUED / STARTING / ARCHIVING / POLLING / DOWNLOADING / PARSING / DONE / TIMEOUT / RECONNECT) updates from known markers in the log. The board refreshes automatically when DONE fires.
- **Path-safe SSE tail**: server validates the log path via new pure helper `projects.isValidBackfillLogPath(path, logDir)` — must resolve inside `DROVER_BACKFILL_LOG_DIR` (default `/private/tmp`), carry the `drover-backfill-` filename prefix, and exist on disk — refusing symlink games, path traversal, and arbitrary-file reads. Five tests cover accept/traversal/prefix/missing/non-string paths.
- **Line classifier**: new pure helper `projects.classifyBackfillLine(line)` maps stdout/stderr to phase strings (`BACKFILL done` → DONE, `Requested log download` → ARCHIVING, `attempt N/30` → POLLING, `downloading archive` → DOWNLOADING, `NEW`/`THRESH` → PARSING). Unit-tested with six cases.
- **Streaming implementation**: the endpoint tails by tracking byte position and reading from the last offset on each fs.watch change + 1 s polling fallback (macOS fs.watch misses append events). Closes on DONE marker, 15-min ceiling, or client disconnect. No sockets leak on modal dismissal — a MutationObserver on the modal closes the EventSource.

## 1.16.0
- **Dashboard card rows and modal surface hostnames (sprint-2g8)**: cards previously showed only the bare env label ("production") so a user with multiple registered projects couldn't tell whether an error came from pncb.prod or massport.prod. Each card is now server-enriched with a `hostnames: [{env, domain, url}]` array resolved from `projects.json`: Acquia envs resolve to their `default_domain` (e.g. `pncb.prod.acquia-sites.com`) and DDEV/local envs fall back to `<ddev_project>.ddev.site`. Env cells in the error table render the domain as a clickable link, the modal's Details grid shows a new "Hostnames" row, and fuzzy matching (`production` → `prod`) keeps user-chosen env names compatible with Acquia's own slugs.
- **New pure helper `projects.resolveCardHostnames(card, project)`**: six new node tests cover Acquia lookup, ddev.site fallback, fuzzy production↔prod matching, null-project safety, empty envLabels, and dedup.
- **`fetchTickets()` builds the project registry once per call** and attaches hostnames during the merge so SSE refresh payloads carry the enrichment without per-ticket projects.json reads.

## 1.15.1
- **Dashboard ddev filter aggregates across all registered projects (sprint-7fy)**: `getRelevantDdevProjects` in virtual-central mode was filtering `ddev list -A` output by only the launch-dir `drover-config.json`'s environments, so a user with six running ddev instances across pncb / massport / ahri only saw one in the dashboard. Now it unions `ddev_project` from every registered project in `projects.json` and layers the launch-dir config on top. New pure helper `projects.ddevProjectNames()` keeps the aggregation testable; four new node tests cover union, skip-missing, dedup, and non-array input safety.

## 1.15.0
- **Dashboard Solution section in the card modal**: the error-detail modal now shows a structured Solution block with both Projected (written by the implementer agent) and Actual (written by the user) blocks. Fields are extracted from the ticket's notes/body (`### Projected` and `### Actual` subsections). Empty states explicitly say so ("No projected solution. drover:implementer has not run on this ticket." / "Record Actual solution" button).
- **In-modal Actual solution form**: click "Record Actual solution" to open an inline form with root_cause, fix_summary, fix_commit_sha, and divergence-from-projected dropdown (only shown when a Projected block exists). Save posts to a new `/api/cards/:id/solution` endpoint that writes the structured `### Actual` block via `bd update --append-notes`, moves the ticket to `lane-done`, and closes it. Dashboard refreshes automatically.
- **Virtual-central aware**: the Solution endpoint locates the ticket across all registered project boards (by `project` tag) and writes to the right db, not the `--db` flag value.
- Client + server both parse Projected/Actual so SSE refreshes preserve the rendered fields without a server round-trip.

## 1.14.0
- **Dashboard virtual-central view across all registered projects (sprint-0r3)**: the dashboard no longer shows only the board from the directory you `cd`'d into. It now merges cards from every project registered in `projects.json` by default and tags each card with its source project. A new "Project" column appears in the error table so you can see at a glance which project each card came from. Pass `DROVER_DB_OVERRIDE=<path>` to the skill to scope back to a single board.
- **File watcher fan-out**: one `fs.watch` per registered project's `.beads/` directory. When triage writes to *any* project's board, the dashboard pushes an SSE `board-update` immediately — no reload, no re-launch. Viewing AHRI and a new PNCB error fires? You see the card appear in real time.
- **New `projectsModule.listBoards()`**: enumerates `{project, path, dbPath}` for every registered project that has a usable beads board. Handles both the `.beads/drover.db` layout (sqlite file or dolt-backed directory) and the dolt-only `.beads/` layout (config.yaml + dolt/). Walks up from the registered path to find the board, which fixes worktree-style layouts where projects register at `/repo/worktrees/main` but `.beads` lives at `/repo`.
- **CLI: `--all-projects` flag** for `server.js`. Now the default when `--db` is not supplied. Fixed the arg parser so boolean flags like `--all-projects` no longer consume the next token as their value.
- **Partial-failure resilience**: if one project's db errors (schema mismatch, locked db, etc), the dashboard now returns cards from the healthy projects and logs the partial failure to stderr. Previously one bad db would hide all boards.

## 1.13.0
- **Dashboard Backfill is now async**: clicking Run Backfill returns immediately with `{status: "queued", log: "/private/tmp/drover-backfill-<alias>-<iso>.log"}`. Previously the click blocked the user for the full Acquia archive-create + poll + download cycle (several minutes) with no feedback. Full backfill stdout/stderr now streams to the per-run log file; tail it for live progress. SSE progress stream is a future enhancement.
- **New `projectsModule.backfillAsync()`**: spawns `backfill.sh` detached with `stdio: ['ignore', logFd, logFd]` so both streams interleave in one log file. Aliases are sanitized to keep the resulting path inside `logDir` (no path-traversal escapes). Legacy synchronous `backfill()` is kept for CLI use and tests.
- **Tests**: four new node tests covering the queued return shape, spawn argument plumbing, alias sanitization, and spawn-failure error path.

## 1.12.2
- **Fix: dashboard Backfill button was fully broken.** Two layered bugs:
  - `server.js`: `handleBackfill` and `handleAddProject` double-parsed the request body (`JSON.parse(raw)` where `raw` was already the parsed object from `readBody`), always returning 400 "invalid JSON body". Removed the redundant parse.
  - `backfill.sh`: still called `acquia-download.sh` with the legacy 2-arg signature `(alias, log_type)` instead of the current 3-arg `(app_uuid, env_name, log_type)` that landed in 1.11.0 when acli was dropped for direct API calls. The downloader silently rejected and the temp log ended up empty — toast reported "0 events". Now resolves the alias to `(app_uuid, env_name)` via `projects.json` before calling the downloader; exits 3 with a pointer to `/drover:add-project` if the alias can't be resolved.
- **Test updates**: `test_backfill.bats` setup now provides a `DROVER_PROJECTS_FILE` fixture and updates the fake downloader to the 3-arg signature. New regression test asserts the downloader receives `(app_uuid, env_name, log_type)` and refuses to proceed on the legacy 2-arg form.

## 1.12.1
- **TRAFFIC summary cadence is configurable (sprint-j0u)**: the hardcoded `% 100` emission rate became multiple task-notifications per minute on busy WSS-streamed production sites. New defaults: `DROVER_TRAFFIC_INTERVAL=1000` (10× fewer notifications from the same traffic volume) and `DROVER_TRAFFIC_EMIT=1` (set to `0` to suppress TRAFFIC stdout entirely while still accumulating stats into state).

## 1.12.0
- **WordPress platform support**: new `wp-watch.py` tails `wp-content/debug.log` + container PHP/nginx error logs via `ddev exec`. First non-Drupal platform on drover.
- **(substrate, platform) dispatcher**: umbrella reads `platform: drupal|wordpress` from each `projects.json` entry and routes to the correct watcher. Unknown platforms warn once and fall back to drupal. Default (no `platform` field) remains `drupal`.
- **Solution capture schema (Projected/Actual)**: drover tickets now carry a structured `## Solution` section with separate Projected (implementer hypothesis) and Actual (verified ground truth) blocks. `effectiveness: pending|verified|ineffective` tracks the verification arc. See ADR `2026-04-21-drover-solution-capture-schema`.
- **New skills**:
  - `/drover:solution <ticket-id>` — interactively capture the Actual block (works whether or not the implementer agent ran).
  - `/drover:recall "<query>"` — ranked search over verified Actual blocks across every registered project board.
  - `/drover:verify <ticket-id>` — one-click promotion of Projected to Actual when the implementer hypothesis was correct.
- **Quiet-by-default monitors**: child watcher stderr routed to the umbrella log file (`~/.claude/drover.umbrella.log`) instead of the harness. Only user-actionable signal (NEW / THRESH / TRAFFIC) reaches the Claude Code task-notification channel. Dashboard reads per-env status from watcher state files.
- **Registration-time reachability gates**: at session start, the umbrella probes `ddev list -A` (once) and each Acquia app's credentials (once per app), skipping watchers whose targets aren't reachable. Eliminates the spawn/fail/retry flood for stopped DDEV projects and invalid Acquia creds. Override via `DROVER_REACHABLE_DDEV` / `DROVER_REACHABLE_ACQUIA_APPS`.
- **Acquia alias contract fix**: `list_projects` now reads the `env` slug field correctly and locates `app_uuid` per-env (matching current add-project.sh output), producing the canonical `acquia:<env>.<app_uuid>` form that acquia-watch.py expects. Resolves the HTTP 400 `invalid_id` spam that flooded every session on projects registered before this release.
- **`invalid_id` classified as permanent**: added to `permanent_slugs` in acquia-watch.py so the umbrella's quarantine kicks in instead of respawning the watcher.
- **Vendored bats-support / bats-assert / bats-mock**: under `drover/tests/bats/_libs/`. The test suite is now self-contained (none of these are in homebrew-core) with `assert_output` / `refute_output` / `assert_success` diagnostics. Writing the bats-mock coverage caught a production heredoc bug in the DDEV gate parser that would otherwise have silently failed in real usage.
- **Tests**: 66/69 drover bats pass (3 pre-existing failures in `test_resolve_acquia_uuids.bats` unrelated).

## 1.11.1
- **Structured Acquia API error handling**: new `AcquiaAPIError` carries HTTP status + parsed `error` slug (e.g. `forbidden_ip`, `invalid_grant`). `acquia-watch.py` distinguishes permanent failures (exit 3) from transient ones (exit 1).
- **Auto-retry on transient failures**: 429 and 5xx responses are retried with exponential backoff (3 attempts, 1s/2s/4s) before raising.
- **Umbrella quarantine for permanent failures**: envs with IP-allowlist or revoked-credential failures are quarantined for 1h (DROVER_UMBRELLA_QUARANTINE) instead of respawning every cycle, stopping notification floods when a site is unreachable from the current network.
- **Tests**: new `test_acquia_api_errors.py` covers forbidden_ip classification, 5xx retry-then-success, and non-retryable 4xx.

## 1.11.0
- **Direct Acquia Cloud API + WSS**: replaced acli subprocess with acquia_api.py (REST client) and acquia_logstream.py (async WSS client). Per-type log subscription, structured JSON events, no PHP dependency.
- **acli dropped as dependency**: all scripts now use the API directly. Only ~/.acquia/cloud_api.conf is needed.
- **TRAFFIC event type**: acquia-watch.py emits periodic traffic summaries for access/request log types alongside error fingerprinting.
- **Umbrella respawn backoff**: per-child exponential backoff (5s-300s) prevents respawn flood when a watcher child exits immediately.
- **Severity misclassification fix**: access-log lines excluded from fingerprint classifier.
- **Setup interview reduced**: 10 prompts collapsed to 5 with sensible defaults and conditional follow-ups.
- **Skill audience tags**: triage, watch, backfill, reset-state marked audience:internal (user-facing 11 to 7).
- **README and ONBOARDING**: new docs for first-time users with no AI background.
- **UX measurement harness**: 6 scenarios, 17 metrics, fixture-replay baseline.
- **Requires**: pip install websockets for Acquia log streaming.

## 1.10.1
- **Quiet umbrella monitor**: lifecycle messages (`starting`/`stopping`/unknown-kind) now go to `~/.claude/drover.umbrella.log` (override via `DROVER_UMBRELLA_LOG`) instead of stdout. The Claude Code harness treats every stdout line from a Monitor as a user-facing notification, so stdout is now reserved for actual signal from child watchers.
- **Lazy start gate**: umbrella exits immediately when `projects.json` is missing or holds an empty list. The monitor still registers on every session; it just no-ops until a project is added. Picked up on next session without `/reload-plugins`.
- **Tests**: updated `test_umbrella_watch.bats` to assert lifecycle in the log file and verify stdout stays silent for non-signal events. All 5 tests green.

## 1.10.0
- **Fingerprint unification** — one hash space, one implementation. Triage and the monitor pipeline now compute fingerprints using the same `scripts/fingerprint.py` module. `fingerprint_structured(source, message, level=…, file=…, type_=…)` is the new entry point for pre-parsed records; `process(line)` remains the line-mode entry point for monitors. Both produce sha256[:12] hashes in the same keyspace.
- **Migration**: `scripts/fingerprint-migrate.py <drover.db>` rewrites the fingerprint hashes stored in open ticket bodies so existing tickets survive the cutover. Idempotent; `--dry-run` previews changes. Run once per project after upgrade.
- **`fingerprint-rules.md`** rewritten as a thin reference that describes what `fingerprint.py` does; the divergent inline per-source helper is gone.
- **`triage-procedure.md`** Step 4 now calls `fingerprint_structured()` directly instead of duplicating sha1 logic.
- **Tests**: +7 python tests for `fingerprint_structured` covering watchdog-type stability, php module-relative paths + line-number invariance, apache client/pid stripping, hex length, unknown-source fallthrough. Total: 82 tests green.

## 1.9.0
- **bd-ready monitor**: new `scripts/monitors/bd-ready-watch.py` polls each registered project's Beads board every 60s (`DROVER_BD_POLL_INTERVAL`) and emits `READY <ticket-id> <severity> <fingerprint> <project>` when a new unassigned `lane-ready` ticket appears. Detection-only — invoking `drover:implement` remains the user/agent call.
- **Umbrella routing**: `bd-ready:<project-path>` keys route to the new watcher. Pidfile naming switched from colon-substitution to sha1-hashed (handles paths with slashes). Each pidfile stores the original key on line 1, pid on line 2.
- **`drover:implement` skill doc**: notes that detection is now monitor-driven; `/loop 30m` remains supported but is no longer the primary cadence.
- **Tests**: 5 new bats tests for bd-ready-watch (missing path, NEW on first ready ticket, diffing across polls, state persistence, missing db tolerance). Umbrella test stubs both ddev and bd-ready children. Total: 75 tests green.

## 1.8.2
- **Dashboard UI polish**: replaced `alert()` / `prompt()` with `showToast()` feedback and a proper modal for the Backfill flow. Modal uses safe DOM-construction (no innerHTML with untrusted content). Add Project result now surfaces as a toast; Backfill opens a modal with an environment dropdown and log-types field.

## 1.8.1
- **System-wide consistency pass** — no behavioral change; docs aligned with the monitor-driven architecture introduced in 1.6.0–1.8.0.
- `drover:watch` redescribed as a manual full-sweep skill; continuous watching now flows through the plugin's umbrella monitor.
- `drover:run` and `drover:setup` "next steps" lead with `drover:add-project` + dashboard instead of `/loop 3m /drover:watch`.
- `drover:baseline` doc notes that `acquia-baseline.sh` now delegates to `backfill.sh` + aggregation.
- `drover:implement` doc notes it is the last `/loop`-driven skill in the pipeline; future pass will convert to a monitor.
- `fingerprint-rules.md` now honestly documents the two-implementation split (line-mode `fingerprint.py` vs structured-record per-source helpers used by triage) and outlines the deferred Phase 3b unification plan.
- `triage-procedure.md` Step 4 disambiguates: structured variant here, streaming variant in `scripts/fingerprint.py`.

## 1.8.0
- **`drover:backfill` skill + `scripts/backfill.sh`**: pulls historical Acquia logs for a registered environment and feeds them through the same fingerprint/state pipeline live monitoring uses. Idempotent — re-running the same window increments counts without double-emitting `NEW`. Use after a monitor outage or to seed a newly-registered env.
- **`scripts/acquia-download.sh`**: extracted thin wrapper around `acli api:environments:log-download`. Shared building block for backfill and baseline.
- **Refactored `scripts/acquia-baseline.sh`**: now calls `backfill.sh` with `DROVER_JSONL_OUT` and aggregates the stream into the legacy baseline JSON. Eliminates the divergent fingerprint logic — one source of truth for "what errors happened".
- **Dashboard**: `POST /api/projects/backfill` endpoint + "Backfill" button in the topbar. Prompts for an Acquia env from the registered list, runs the backfill, shows event/new-fingerprint/threshold counts.
- **Tests**: +12 (7 backfill bats, 2 baseline bats, 3 node backfill). Total: 70 tests green.

## 1.7.0
- **Acquia logstream watcher**: `scripts/monitors/acquia-watch.py` spawns `acli app:log:tail <env>`, strips the preamble, and routes lines through the shared `fingerprint.process()` — same `NEW`/`THRESH` emission format as `ddev-watch.py`. State at `${DROVER_STATE_DIR}/acquia-<envId>.json`.
- **Umbrella routing by prefix**: `ddev:<name>` keys spawn `ddev-watch.py`; `acquia:<alias-or-id>` keys spawn `acquia-watch.py`. Pidfiles use `__` instead of `:` for filesystem safety.
- **Auto-discovery from drush aliases**: `add-project.sh` now parses `drush/sites/*.site.yml` for `ac-site` + `ac-env` keys and populates `acquia.environments[]` with `{alias, env, site, drush_alias}`. The `alias` field works directly as the argument to `acli app:log:tail`.
- **UUID caching**: `scripts/resolve-acquia-uuids.sh` is invoked at registration time when `acli` is on PATH. It enriches each Acquia env with `app_uuid`, `env_uuid`, and `default_domain` via one-shot `acli api:applications:list` + `environment-list` calls. These UUIDs support future backfill and historical pulls without re-hitting the API.
- **Tests**: +11 tests (6 acquia-watch, 3 uuid resolver, 1 umbrella acquia routing, 1 add-project discovery). Total: 58 tests green.

## 1.6.0
- **Monitor-driven architecture**: adopts the CC 2.1.105 `monitors` manifest key. The new umbrella monitor (`scripts/monitors/umbrella-watch.sh`) reads `${CLAUDE_PLUGIN_DATA}/projects.json` and spawns one `ddev-watch.py` per registered project. Auto-arms at session start, skill invocation, or `/reload-plugins` — no `/loop` required.
- **`ddev-watch.py`**: per-project error watcher merging `drush watchdog:tail` and `ddev logs -f --service web`. Shared-fingerprint dedup. Emits `NEW <fp>` on first occurrence and `THRESH <fp> count=N` when a fingerprint hits `DROVER_THRESHOLD` (default 50 = Drupal watchdog batch size). State persisted in `${CLAUDE_PLUGIN_DATA}/ddev-state/<project>.json`.
- **`scripts/fingerprint.py`**: pure stdin→JSON fingerprinter, single source of truth for "same error" across triage and monitors. Normalizes timestamps, IPs, line numbers, pid numbers, long paths; classifies severity and source. Handles `BrokenPipeError` cleanly.
- **`scripts/add-project.sh`**: idempotent project registration — reads `.ddev/config.yaml`, drush aliases, git remote. Writes to `${CLAUDE_PLUGIN_DATA}/projects.json`. Emits structured JSON.
- **`drover:add-project` skill**: on macOS, opens a native folder picker via `osascript`, then registers the project. Accepts an explicit path argument on other platforms.
- **Dashboard**: new `GET /api/projects` and `POST /api/projects/add` endpoints backed by `tools/dashboard/projects.js`. The POST endpoint runs `osascript` server-side when no path is supplied.
- **Tests**: 47 new tests total — 21 python unit tests (fingerprint), 18 bats tests (add-project, ddev-watch, umbrella-watch), 8 node:test tests (dashboard projects module). Unified runner at `tests/run.sh` skips frameworks that aren't installed.

## 1.5.1
- Cross-reference `lib:ddev` from implementer procedure

## 1.5.0
- `triage-agent`: bumped model from haiku to sonnet (haiku was skipping Steps 2-4: drush enrichment, noise filter, fingerprinting)
- `triage-agent`: added explicit non-skippable step callouts in agent definition to enforce enrichment and dedup before ticket creation
- `bd list --json`: added `--flat` to all `bd list --json` calls across all skills, agent definitions, hooks, and reference files (13 occurrences); `bd` v0.59.0 requires `--flat` for JSON output
- `bd get` → `bd show`: replaced non-existent `bd get` command with correct `bd show` in `skills/implement/SKILL.md` (2 occurrences)
- `--unassigned` → `--no-assignee`: fixed invalid flag in `skills/implement/SKILL.md`; correct flag is `--no-assignee`
- `triage-procedure.md` Step 5 velocity boost: fixed mixed Python/shell syntax — extracted `bd update` shell command out of the Python code block
- `triage-procedure.md` Step 7 quiet hours: fixed overnight window logic (`start > end` case was inverted, causing quiet hours to be silenced at wrong times)
- `tools/dashboard/server.js`: added `-A` flag to `ddev list --json-output` to discover all projects, not just those in the server's cwd

## 1.4.1
- `triage-agent`: extract 390-line procedure to `skills/triage/references/triage-procedure.md` (agent: 438→63 lines), add SendMessage tool
- `implementer-agent`: extract 247-line procedure to `skills/implement/references/implementer-procedure.md` (agent: 275→53 lines), add SendMessage tool

## 1.4.0
- `drover:dashboard`: new Datadog/Splunk-style ops dashboard on port 3749. Environment health tiles, error volume timeline chart, triage cycle stats, filterable error table with expandable stack traces, and full kanban board view with drag-and-drop and ticket modals. Live updates via SSE (no polling). System fonts, zero external dependencies.

## 1.3.0
- `drover:implement`: agents now run as a named agent team (`TeamCreate` before spawn, `TeamDelete` after) so the implementer can report back via `SendMessage`
- `drover:watch`: triage agents now run as a named agent team; each environment gets its own named agent (`triage-{env}`) with a shared communication channel; team is torn down after all summaries are received
- `drover:triage` (triage-agent): fixed DDEV instance resolution to use `ddev list -A --json-output` instead of `ddev describe`; skips DDEV log sources gracefully if no running instance found; adds `ddev restart` heal path on drush failures
- `drover:watch` (verify-deps.sh): fixed Beads DB check to use `-e` instead of `-f` (Beads creates a directory, not a plain file)

## 1.2.0
- `drover:triage` (triage-agent): DDEV pre-flight step (Step 0) discovers running DDEV instance or starts `worktrees/main`; returns zeros instead of fabricating data if DDEV is unreachable
- `drover:triage` (triage-agent): switched from `ddev exec -s web drush` to `ddev drush`; watchdog query now uses `--severity=4 --count=500` for better coverage
- `drover:setup`: Step 1.7 auto-discovers Drush site aliases (`drush/sites/*.site.yml`) to pre-fill env slugs, aliases, staging/production defaults
- `drover:watch` (verify-deps.sh): fixed Beads DB check to use `-e` instead of `-f` (Dolt creates a directory, not a plain file)
- `drover:watch` (verify-deps.sh): Slack dep check now looks for `agent-slack` instead of `gws`

## [1.1.0] - 2026-03-12

### Added
- **Global/project config split** — notification preferences (Slack User ID, quiet mode, quiet hours) now live in `~/.claude/drover-global-config.json`; project config (`.claude/drover-config.json`) contains no `notify` block. `drover:setup` auto-migrates legacy per-project `notify` blocks on re-run.
- **Suspect commit tracking** — triage agent runs `scripts/suspect-commit.sh` after each new ticket is created, resolving the error's `location` field to a git-tracked file and extracting the most recent commit. Result written to the ticket's Merge Case section.
- **Dual-window log gathering** — short-window triage (every 3m via `drush @alias watchdog:show`) supplemented by long-window 24h Acquia baseline via `scripts/acquia-baseline.sh`. Velocity-rising errors get a `velocity-rising` label and a lower effective promotion threshold.
- **Kanban web UI** (`tools/kanban-ui/server.js`) — pure Node.js ≥18 HTTP server on port 3748. Auto-refreshes every 30s. `drover:board` launches it alongside the ASCII summary. Requires no npm install.
- **`drover:baseline` skill** — on-demand 24h Acquia log download and velocity analysis. Shows rising/stable/falling error trends per fingerprint.
- **`drover:reset-state` skill** — state recovery for corrupted `drover.state.jsonl`. Soft reset advances offsets to current log tail; hard reset rescans with a one-cycle dedup guard to prevent ticket storms.
- **`scripts/verify-deps.sh`** — dependency gate run at `drover:watch` startup. Checks bd, python3, Node.js ≥18, config file, Beads DB. Warnings for optional deps (Node.js); errors for required deps.
- **`scripts/acquia-baseline.sh`** — downloads 24h PHP + Apache logs from Acquia via `acli log:download`, computes per-fingerprint hourly rates and mean baseline, outputs JSON.
- **`ddev_alias` field** in Acquia environment config — enables short-window Drush queries via `drush @alias` (faster than full `acli ssh` roundtrip).
- **Velocity boost** in triage agent — detects accelerating error rates (recent gaps <50% of overall average) and applies `velocity-rising` label with reduced promotion threshold.

### Changed
- **Slack DM replaces gmail** — triage agent and implementer agent now notify via `gws slack send-dm` using `slack_user_id` from global config. Gmail (`gws gmail send`) removed.
- **Approot cached once per session** — triage agent resolves DDEV/Acquia approot at startup (not per log entry) to avoid repeated shell-outs.
- **`drover:board`** now performs DB existence pre-check before attempting to start the web server. Includes port conflict detection and 3s startup verification.
- **`drover:watch`** runs `verify-deps.sh` as first pre-flight step; aborts with actionable error if required deps are missing.
- **`drover:setup`** Step 1.5 migrates legacy `notify` block from project config to global config on re-run; last-write-wins with INFO log on conflict.
- **Implementer agent worktree creation** explicitly branches from `main` (not current HEAD) with idempotency guard for existing worktrees.

## [1.0.0] - 2026-03-12

### Added
- Initial release: automated Drupal error monitoring and self-healing pipeline
- `drover:setup` — first-time project configuration with interactive interview, Beads board init, and environment validation
- `drover:watch` — loop orchestrator that runs triage and verification cycles against configured environments (DDEV + Acquia)
- `drover:triage` — fingerprint-based log ingestion: deduplication, cross-environment signal boost, promotion rules, and Beads ticket management
- `drover:implement` — autonomous fix pipeline: claims ready tickets, spawns implementer agent, creates isolated git worktrees, runs PHPCS/PHPStan
- `drover:board` — human-facing board viewer with filterable columns and open/closed counts
- `triage-agent` (haiku) — reads logs, fingerprints errors, creates/augments Beads tickets without code writing
- `implementer-agent` (sonnet) — claims tickets, creates worktrees, implements fixes, writes merge cases
- Environment trust model: `high` (production), `medium` (staging), `low` (local DDEV) with configurable promotion thresholds
- Local noise filter: suppresses DDEV-specific false positives (missing synced files, absent services)
- Cross-environment signal boost: shared fingerprint in low+high trust environments promotes immediately
- Quiet mode and quiet hours for notifications (skips non-critical on `quiet_mode: true` or during quiet window)
- Verification loop: tracks 3 consecutive absent cycles before auto-closing a fixed ticket
- Session-start hook: injects one-line ambient status when drover is configured in the current project
- Stateful checkpoint via `~/.claude/drover.state.jsonl` (append-only, trimmed to 30 days)
- Fingerprint rules reference: per-source normalization rules (watchdog, PHP error log, Nginx/Apache)
