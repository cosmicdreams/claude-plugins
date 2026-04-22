# T2 Evidence — /drover:dashboard auto-arms the umbrella watcher

**Ticket:** T2 from `drover-demo-script.md`
**Branch:** `feat/drover-dashboard-autoingest`
**Commits:**
  - `9020ad37` feat(drover): auto-arm umbrella watcher on dashboard launch (T2)
  - `2709f963` fix(drover): kill umbrella process group on dashboard shutdown (T2)
**Dashboard URL:** http://localhost:3749 during testing (later moved off per team-lead request; branch itself uses whatever port the launcher passes)

## Canonical evidence paths (worktree-relative)

All files live under `analysis-reports/t2-dashboard-autoingest/` on this branch:

| Artefact | File | What it proves |
|---|---|---|
| Hard-reload t=0 snapshot (dashboard armed, empty error table) | `FINAL-t0-snapshot.yml` | 3 Pulse tiles render `Listening for stream messages…` |
| Forced-event t≤30s snapshot | `FINAL-t-post-injection.yml` | New row in error investigation table: age `0m`, lane `TRIAGE`, title starts with `[ERROR] apache: T2 final evidence…`, project `ahri-main` |
| Server log excerpt | `final-evidence.log` / `evidence-run-ingest-only.log` | Shows `[ingest] umbrella armed (pid=…)` at startup and `[ingest] NEW … error apache -> bd card in project=ahri-main` at the forced event |
| Ingestion API snapshots | `FINAL-ingestion-t0.json`, `ingestion-status-post.json` | `umbrellaAlive=true`, `eventCount` jumps 0 → 1 for `ahri-main` after the injection |
| Process tree during armed state | `umbrella-children.ps` | 30 rows showing node server → bash umbrella (detached) → per-project acquia-watch.py / bd-ready-watch.py; 5 Acquia WSS subscriptions and 4 bd-ready monitors spawned from the dashboard-owned umbrella |

Older iterations (`t0-clean-dashboard.yml`, `t-post-event.yml`, `snapshot-t0-clean-hardreload.yml`, `snapshot-t-post-forced-event.yml`) show the same behaviour earlier in the session and are kept as corroborating evidence.

## Observed real Acquia ingestion (bonus)

While iterating on the teardown fix, the log `evidence-run.log` captured **five organic live-stream events from pncb-main's real Acquia environments** being ingested into bd cards without any manual injection:

```
[ingest] NEW 9216da282038 error other -> bd card in project=pncb-main
[ingest] NEW 1fa8db22ec52 error other -> bd card in project=pncb-main
[ingest] NEW c9dcdb9f9a11 error other -> bd card in project=pncb-main
[ingest] NEW 07437e18df42 error other -> bd card in project=pncb-main
[ingest] NEW 87b3002da1ae error other -> bd card in project=pncb-main
```

These arrived organically from the dashboard-owned umbrella child's WSS subscription to pncb Acquia envs. The forced-event path in the primary evidence is the **deterministic** test; this is a bonus real-data proof.

## Mechanism (one-line summary)

Dashboard server spawns a detached-group umbrella child at startup (deduped via `~/.claude/drover.umbrella.dashboard.pid`), parses `[<key>] NEW <fp> <sev> <src> <env> <msg>` lines from its stdout, looks up `<key>` → project + dbPath via the projects.json index, and runs `bd create` in the matching `.beads/drover.db`. An SSE `ingest-event` push + invalidation of `ticketCache` forces the UI to refetch; the new card appears live in the error investigation table.

## Graceful teardown verified

- `teardown-v3.log` shows `[ingest] SIGTERM received; stopping umbrella` followed by clean dashboard + umbrella exit.
- After teardown: `pgrep -f drover-dashboard-autoingest` → 0, pid file cleared.
- `stopAutoIngestion` uses `process.kill(-pid, SIGTERM)` on the detached group so per-project watcher children (acquia-watch.py / ddev-watch.py / bd-ready-watch.py) die with the parent — they do not reparent to init.

## Double-arm protection

- Pid file at `~/.claude/drover.umbrella.dashboard.pid` tracks the dashboard-owned umbrella.
- On startup, if an existing dashboard-owned pid is alive the server logs `dashboard-owned umbrella already alive … not double-arming` and skips spawn.
- External umbrellas (harness-spawned from Claude Code Monitor, `/drover:watch` in another terminal, a `/loop` cron, etc.) are detected via `pgrep -f umbrella-watch.sh` and logged informationally. We deliberately coexist: the harness umbrella streams to Claude's notification channel (not to us), and the dashboard umbrella uses a dedicated `DROVER_STATE_DIR` so its fingerprint memory is isolated. bd-level fingerprint uniqueness at `bd create` time prevents duplicate cards across the two umbrellas.
- Observed 18 external umbrellas during testing; no duplicate cards produced.

## "Listening for stream messages…" empty state

The Pulse tile for an environment renders `Listening for stream messages…` (wording per spec §4.12.a, copied from Acquia Cloud's own log-stream UI) when:
- `env.count === 0` (no open cards for that env), AND
- `INGESTION.umbrellaAlive === true`, AND
- total event count across all projects is 0 (no events ingested yet this session)

Tooltip: "Umbrella watcher is armed; no new events yet in this dashboard session."

A subtle purple pulse animation (CSS `listening-pulse`) visually distinguishes this from the standard green "0 open" state that previously conflated "healthy" with "nothing ingested".

## Cache drift note

`~/.claude/plugins/cache/local/drover/` is at **1.20.6**; `main` (this branch's base) is at **1.21.0**. T1 and A8 evidence reviewers should account for the gap — any slash-command invocation against the cached plugin will not exercise the 1.21.0 fingerprint / favicon / T0 changes that are in main. Consider a plugin cache refresh before the Thursday dress rehearsal.

## Residual concerns

1. **Row rendering `fp:[unknown]` cosmetic.** The injected row displays `fp:[unknown]` in the Error investigation table because the client-side `parseCardClient` regex expects backtick-wrapped fingerprints; my body template already emits backticks, so this must be a regex-escaping issue in `parseCardClient` (the string `\*\*Fingerprint:\*\*\s+\`([a-f0-9]+)\`` ). The card body itself is correctly populated — modal open/close paths read `fp` fine. **Not a blocker for beat 2.** Flagged for post-demo follow-up.
2. **DDEV auto-ingest from local watchdog.** Our auto-arm covers Acquia WSS via `acquia-watch.py`; DDEV local tails via `ddev-watch.py` do fire as children but we did not observe local-watchdog → bd card in this session because none of the currently-running DDEV projects produced a Drupal watchdog entry during the test window. The pipeline is structurally the same (ddev-watch emits `NEW` to stdout, umbrella prefixes with `[ddev:<project>]`, our parser routes it), so when live events occur they should flow through identically.
3. **`disown` quirk.** When testing, if the launching shell exits, node receives SIGHUP and our shutdown handlers fire as expected. The dashboard-launch skill (`drover/skills/dashboard/SKILL.md`) uses `node … &` without `disown`, so in a real harness session the SIGHUP risk applies. Consider `nohup` in the skill — optional polish, not a demo blocker.
