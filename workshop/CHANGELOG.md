# Changelog

## 2.1.0 — 2026-06-25 — prioritize: deadline coverage + branded HTML brief

- **prioritize**: added a `DUE` attention category to the Jira fetch — issues assigned to you and due today or overdue are always surfaced, even when nothing changed in the delta window (the gap that previously hid a release ticket due the same day). Pass 2 now pulls the `duedate` column.
- **prioritize**: fixed the "quiet project" bug — a project is now marked quiet only when it has zero items across BOTH passes, computed from the final merged list, not from the delta pass alone (an assigned standing-obligation no longer gets buried under a false "quiet").
- **prioritize**: `DUE` scoring tier (90, just under RESPOND) with a +15 overdue bonus; a due-today item that also blocks others is the strongest `NEXT:` candidate.
- **prioritize**: on-demand runs now also write and open a self-contained HTML brief (`~/.claude/workshop-prioritize.brief.html`) centered on "What should I work on next?" — terminal `NEXT:` line stays. New `assets/brief.template.html`, styled to Velir 2025 tokens (`~/.velir/DESIGN.md`) when present: flat, light, IBM Plex Sans, navy chrome, no left-border "bracket" callouts. Ambient (`--loop`) mode stays quiet — no HTML.
- **prioritize**: noted the jira-cli `--updated ">DATE"` quirk and the JQL fallback so quiet detection does not get false negatives.

## 2.0.0 — 2026-06-10 — Fable-era rewrite

- **prioritize**: added singleton cron discipline — `CronList` before `CronCreate`, skip if entry already exists, document de-registration path (`CronDelete` with job ID); trimmed process narration
- **scout**: same singleton cron discipline as prioritize; loop section updated with CronList check before creating; trimmed defensive prose
- **knowledge-check**: kept all logic; trimmed to essentials; removed redundant stance/coaching prose
- **obsidian-lint**: inlined all three step files (scan, propose, apply) directly into SKILL.md; deleted `steps/` directory (pure narration indirection)
- **organize**: inlined all three step files (find, propose, apply) directly into SKILL.md; deleted `steps/` directory
- **config**: inlined all four step files (detect, integrations, projects, storage) directly into SKILL.md; deleted `steps/` directory; kept `references/schema.md` (genuine reference data)
- **deploy-post, personal-calendar, personal-email**: light trim only — these are thin by design
- Plugin distributable via Claude Desktop Personal Plugins — see admin:install for packaging instructions

## 1.5.0 — Rename plugin: workflow → workshop

Renamed the plugin from `workflow` to `workshop` to avoid colliding with Claude Code's
built-in `workflow` feature. No behavior change — same skills, new namespace.

- Skill namespace `workflow:*` → `workshop:*` (config, prioritize, scout, knowledge-check,
  deploy-post, organize, obsidian-lint, personal-calendar, personal-email).
- Runtime config file `~/.claude/workflow.json` → `~/.claude/workshop.json` (existing file
  migrated in place).
- Installed cache/data paths follow the new plugin name
  (`cache/local/workshop/`, `plugins/data/workshop/`).
- Cross-plugin references updated in `lib`, `admin`, `ideate`, and `plans`.
- Marketplace entry + source path updated.

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
- Ranking weights exposed in `workshop.json` under `prioritize.weights`.
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
- `restore-loop.sh` hook now loops `/workshop:scout`; `lib:slack` routing guidance, both READMEs,
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
- Added: workshop:config skill for integration discovery and configuration
