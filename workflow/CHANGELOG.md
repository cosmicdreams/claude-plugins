# Changelog

## 1.4.0 — Add knowledge-check

### `knowledge-check` (new)
- Keeps the human cognitively in the loop during AI-assisted work: maintains a running
  understanding checklist, asks the user to restate their mental model, fills gaps, and quizzes
  before moving on. Guards against cognitive surrender — the user stays the source of truth.
- Triggers on "keep me honest", "knowledge-check me", "quiz me on this", "make me explain it
  back", "make sure I understand before we move on", "don't let me cognitively surrender".
- Distinct from `research-lab:understand`, which handles first-pass exploration of new material;
  `knowledge-check` starts after there is session context to check the user's understanding of.

## 1.3.0 — Consolidate to verbs: prioritize + scout

Reworked the triage/awareness skills around purpose (they had grown from separate vertical slices
with blurred intent), and applied the skills-are-verbs naming rule.

### `prioritize` (new — replaces `pulse` + `morning-brief`, both retired)
- One on-demand "what should I work on next?" skill for any time of day (the old morning-only framing
  misfit the afternoon-slump use). Merges three planes: standing obligations (blocked/stale/queue,
  from morning-brief) + overnight delta (from pulse) + **available time from `personal-calendar`** (new).
- **Leads with a single `NEXT:` action** + a one-line why; the ranked table is secondary (a wall of
  signals worsens focus paralysis).
- Two modes: on-demand (default, full picture) and ambient `--loop` (delta-only, quiet, surfaces only
  when the top item changes). One shared Slack/Jira fetch+rank engine (kills the old duplication and
  the `what needs my attention` trigger collision).
- Ranking weights exposed in `workflow.json` under `prioritize.weights`.
- **Work email/calendar (Outlook/Exchange)** are declared-but-unconnected source slots; the brief
  prints `(work email/calendar: not connected)` until Microsoft Graph auth is solved.

### `scout` (renamed from `ecosystem-pulse`) — a better Feedly
- **Config-driven extensible source list** (`scout.sources`: feed / page / search) instead of
  hardcoded sources; add/remove conversationally.
- **Tunable interest profile** (`scout.interests` / `anti_interests`) drives relevance scoring.
- **Feedback loop**: mark items useful / not / more-like-this / mute; feedback is logged to the vault
  and proposes weight/profile adjustments (propose-then-apply). The radar sharpens with use.
- Renamed to end the "pulse" name collision and follow skills-are-verbs.

### Cross-references updated
- `restore-loop.sh` hook now loops `/workflow:scout`; `lib:slack` routing guidance, both READMEs,
  the config schema (added `prioritize`/`scout` blocks), `DEPENDENCIES.md`, and admin install docs
  point at the new names. (Remaining stale doc refs: `admin/.../dependency-map.md` two-section merge,
  one eval-script comment, ideas-funnel ONBOARDING — non-breaking, noted for a doc-sync pass.)

## 1.2.0
- Changed: `deploy-post` simplified from a stateful checklist manager to a guided post-only skill. It now elicits three inputs (channel, current production release, tag/branch being deployed), renders the canonical checklist with every task at `:rocket:` pending, and posts once via `agent-slack`. The user edits the status emojis directly in Slack.
- Removed: `start`/`done`/`undo`/`status`/`reset` commands, the `~/.deploy-post-state.json` state file, the message-ts capture/edit logic, `scripts/deploy-post.py`, and `references/step-names.md` — the advance-status flow added latency without being used.
- Changed: template now matches the actual deployment checklist (dropped maintenance-mode, search-reindex, and merge-to-develop steps; added "Build release with github action"; header is `MM/DD/YYYY Deployment of <branch> to production` with a "Current production release" line).

## 1.1.1
- Fixed: `check-integration.sh` slack preflight now checks for `agent-slack` instead of a non-existent `slack` CLI. Previous behavior caused every morning-brief and pulse run to silently skip Slack.

## 1.1.0
- Added: `scripts/check-integration.sh` — shared preflight circuit-breaker for external integrations (gws, jira, slack, gh)
- Caches health results for 5 minutes; open circuit short-circuits without re-running preflight
- Wired circuit-breaker into: pulse (step 01-setup), morning-brief (step 01-setup), personal-email, personal-calendar
- pulse and morning-brief degrade gracefully (skip unavailable source, continue with the rest)
- Added: `tests/test_circuit_breaker.bats` — 13 tests covering cache hit, cache miss, and TTL expiry

## 1.0.0
- Initial release: extracted from `office` plugin
- Skills: morning-brief, pulse, deploy-post, personal-calendar, personal-email, organize, obsidian-lint, ecosystem-pulse
- Added: workflow:config skill for integration discovery and configuration
