---
name: fingerprint-rules
description: >
  Canonical reference for drover error fingerprinting. As of 1.10.0 there
  is one implementation — `scripts/fingerprint.py` — consumed by both the
  umbrella monitor (line-mode via `process(line)`) and drover:triage
  (structured-record mode via `fingerprint_structured(...)`). This
  document describes what that code does and why.
---

# Drover Fingerprint Rules

Fingerprints are the canonical deduplication key for drover tickets.
Both the monitor pipeline and triage compute fingerprints using the
**same Python module** (`${CLAUDE_PLUGIN_ROOT}/scripts/fingerprint.py`),
**same hash** (sha256, truncated to 12 hex chars), and **same key
space** — so a `NEW` emitted by `ddev-watch.py` shares a fingerprint
with a triage-created ticket for the same underlying error.

## Two entry points, one implementation

| Entry point | Function | Input |
|---|---|---|
| Umbrella monitor (`ddev-watch.py`, `acquia-watch.py`, `backfill.sh`) | `fingerprint.process(line)` | raw log line; source auto-detected |
| `drover:triage` Step 4 | `fingerprint.fingerprint_structured(...)` | parsed record with explicit `source`, `level`, `file`, `type`, `message` |

Both paths call the same internal `normalize()` + sha256-truncate
sequence.

## Normalization (before hashing, either entry point)

From `fingerprint.py`:

1. Strip request IDs (UUID-ish hex patterns)
2. Strip timestamps (bracketed tokens, ISO dates, Drupal watchdog date format)
3. Strip IP addresses
4. Strip PID markers (`pid <n>`)
5. Strip hex addresses (`0x…`)
6. Collapse long path runs to `PATH/<last-two-segments>`
7. Replace bare integers with `N`
8. Collapse whitespace
9. Lowercase, strip, truncate to 120 chars

## Source-specific key shape (structured mode)

The structured helper produces a per-source key **before** hashing so
that a Drupal watchdog notice stays distinct from an Apache error even
when the raw message strings happen to collide post-normalization.

| Source | Key shape |
|---|---|
| `watchdog` | `watchdog:{type}:{normalized_message}` |
| `php` | `php:{level}:{normalized_message}:{module_relative_file}` |
| `nginx` | `nginx:{level}:{normalized_message}` (transport noise stripped first) |
| `apache` | `apache:{level}:{normalized_message}` (`[client …]`, `[pid …]`, `AH00xx:` stripped first) |
| other | `{source}:{normalized_message}` |

For `php`, `module_relative_file` is the path from the first `modules/`
or `core/` prefix onward with trailing `:<line>` stripped. Example:
`/var/www/html/modules/custom/foo/src/Bar.php:142` →
`modules/custom/foo/src/Bar.php`.

## Line-mode (monitor) source classification

`process(line)` detects source from the line content:
- `watchdog`: contains ` | php ` / ` | cron ` / "drush" (drush watchdog:tail format)
- `php`: contains `[php:` or `php fatal` / `php warning`
- `apache`: contains `[error]` or `[:error]`
- `other`: anything else that passes the severity gate

Line-mode calls `normalize(line)` directly (no per-source prefix) and
hashes the result. This means line-mode and structured-mode can assign
slightly different fingerprints to the same error when the raw line
normalizes differently than the structured record's `message` field.
In practice the two paths process disjoint data windows (live stream
vs batch triage). When they disagree, structured-mode is authoritative
for ticket identity.

## Migration (1.10.0)

The legacy per-source helper used sha1[:12] — a different hash space
from the monitor pipeline. Unifying onto `fingerprint_structured()`
changes the hash of every existing open ticket. Run
`${CLAUDE_PLUGIN_ROOT}/scripts/fingerprint-migrate.py <path/to/.beads/drover.db>`
once per project to recompute and rewrite the fingerprint hashes stored
in open ticket bodies. Idempotent; safe to re-run. Pass `--dry-run`
first to preview.

## Fingerprint lookup

Ticket bodies store the fingerprint as `**Fingerprint:** \`<hash>\``.
Triage Step 4 greps for that string when searching for an existing
ticket to augment.
