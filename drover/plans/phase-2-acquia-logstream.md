# Phase 2 spike — Acquia remote log intake for drover monitors

## Goal

Bring Acquia (remote) Drupal logs into the same ECA monitor pipeline
that Phase 1 built for local DDEV. The bar is "sub-minute latency, no
local infrastructure to operate." If we can't clear that bar, fall
back to hourly `acli log:download` batch polling.

## Timebox

**2 hours.** If none of the options below can emit a real log line
into the drover umbrella within 2 hours of focused work, stop, record
findings, and accept the batch fallback.

## Options (ranked)

### Option 1 — Cloud API logstream (websocket) ← try first

Acquia Cloud API exposes a websocket for near-real-time log streaming.
`acli` wraps it partially but the plumbing has been painful.

**Test**:

1. Pick one Acquia app (likely SCHUSTERMAN or PNCB). Confirm auth via
   `acli auth:login --help`.
2. Hit the logstream endpoint directly with `websocat` or a small
   Python `websockets` client:
   - `GET /api/applications/{appUuid}/logstream` returns a websocket URL
   - Connect, subscribe to `php-error` and `apache-access`
3. Pipe messages through `fingerprint.py` and verify dedup works on
   Acquia's line format.
4. If reliable, wrap as `scripts/monitors/acquia-watch.py` — same
   interface as `ddev-watch.py` but different input source.

**Pass criteria**: 10 min continuous stream, zero disconnects, under
30s latency from log write to drover emission.

### Option 2 — Acquia syslog drain

Acquia Cloud can forward logs to an external syslog endpoint. Drover
tails the drain target instead of talking to Acquia directly.

**Test**:

1. Local rsyslog listener or Papertrail free tier
2. Configure one Acquia env to forward to it
3. Drover watches the drain file

**Trade-off**: one-time infra setup, reliable forever. No per-env
credential management in drover.

**Pass criteria**: log arrives in drain within 60s.

### Option 3 — Existing APM

If any Acquia site already ships to New Relic / Datadog / Splunk /
Sumo, their streaming APIs beat Acquia's. Skip if not wired up — not
worth a new vendor dependency.

### Option 4 (fallback) — hourly `acli log:download`

Current approach, but triggered by a monitor rather than `/loop`:

- `scripts/monitors/acquia-poll-watch.sh` — `acli log:download
  --since=$cursor` every 3600s, diffs against offset, pipes new lines
  through `fingerprint.py`
- Same umbrella pattern as DDEV: one entry per Acquia env
- Not real-time, but matches today's capabilities and needs no new
  infrastructure

## Deliverables regardless of outcome

1. **Findings** — which option tested, what worked, actual latency
2. **If Option 1 or 2 passes**: `scripts/monitors/acquia-watch.py` +
   bats tests (stubbed input) + manifest entry per Acquia env in
   `projects.json`
3. **If only Option 4 works**: `acquia-poll-watch.sh` and accept the
   1h latency, document as known limitation

## Open questions

- Does the logstream websocket require sticky sessions? Recovery
  from disconnects without losing lines?
- Can one Cloud API token subscribe to multiple envs, or separate
  websocket per env? (Affects umbrella child count)
- Acquia log line format vs. `fingerprint.py` normalizers — regex
  updates needed?
- Rate limits on logstream — throttling under high-volume traffic?

## Data model changes (if any)

`projects.json` may need an optional `acquia` block:

```json
{
  "name": "AHRI-main",
  "path": "/Users/.../AHRI/worktrees/main",
  "ddev_project": "AHRI-main",
  "acquia": {
    "app_uuid": "xxxx-xxxx",
    "environments": ["prod", "stage"]
  }
}
```

If so, `add-project.sh` needs to parse `drush/sites/*.site.yml` or a
separate Acquia discovery path to populate this automatically.

## Execution order

1. Confirm `websocat` or `websockets` available; install if not
2. Read Acquia Cloud API v2 logstream docs (confirm endpoint + auth)
3. Write a throwaway 20-line Python script to connect + print raw
   lines for one env — verify we CAN stream at all
4. If yes → wrap as `acquia-watch.py` matching `ddev-watch.py`
   interface, write bats tests with canned WS fixture
5. If no → document the failure mode, proceed to Option 2 or 4
