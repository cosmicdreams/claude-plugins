# drover Changelog

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
