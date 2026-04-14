# Phase 2 findings — Acquia logstream

## Result: Option 1 passes

`acli app:log:tail <env-id>` streams Acquia logs over the Cloud API
websocket without us writing the WS client. Preamble is ~5 lines
ending in `"Streaming has started and new logs will appear below."`;
after that, each line is a raw Acquia log entry (apache access, php
error, or watchdog) with no additional framing.

Test run against PNCB prod (2026-04-14): connected in under 5s,
received first access-log line within 30s. Stable for 30s observation
window.

No need for:
- Option 2 (syslog drain) — spare infra
- Option 3 (external APM) — not wired up
- Option 4 (batch download) — shelved

## Implementation (committed)

- `scripts/monitors/acquia-watch.py` — spawns `acli app:log:tail`, skips
  preamble, reuses `fingerprint.process()`, emits `NEW/THRESH` in the
  same format as `ddev-watch.py`. State: `acquia-<envId>.json`.
- `scripts/monitors/umbrella-watch.sh` — now routes by prefix:
  `ddev:<name>` → `ddev-watch.py`, `acquia:<env-id>` → `acquia-watch.py`.
- `projects.json` data model extended with an optional `acquia` block:
  ```json
  {
    "name": "PNCB",
    "acquia": { "environments": [{ "id": "30395-..." }] }
  }
  ```
- Tests: 6 bats tests for acquia-watch (preamble skip, fingerprint,
  threshold, state, missing arg) + 1 new umbrella test for Acquia
  routing.

## Known limitations

- `acli app:log:tail` emits a 5-line preamble that's stripped by
  `STREAM_READY_MARKER`. If Acquia changes the banner text, watcher
  will skip everything forever. Future: detect first matching fingerprint
  line as a heartbeat.
- No disconnect detection. If `acli` crashes, watcher exits silently and
  umbrella restarts it on the next poll (30s gap). Good enough for now.
- `add-project.sh` doesn't yet auto-discover Acquia envs from the chosen
  folder — user must hand-edit `projects.json` to add the `acquia` block.
  Follow-up card: parse `drush/sites/*.site.yml` cloud hooks to derive
  env IDs.
