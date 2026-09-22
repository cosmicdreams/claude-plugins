# Changelog

## 2.5.0

- **scout**: optional Jev pass in step 3 (`scripts/jev_scout.py`) — one request per fetched
  item asks duplicate / augment / net-new against baseline candidates found by token overlap,
  the Keep / Watch / Skip Choice with the interest profile in the question, and the three
  lens questions as yes/no probabilities. Confident verdicts are used (a strong lens still
  promotes Watch to Keep); everything else, and every item without `TYPESAFE_API_KEY`, is
  scored by hand as before. Mutes and feedback weights stay deterministic and run first.
- **prioritize**: optional Jev classification in steps 2 and 3 (`scripts/jev_prioritize.py`)
  — one RESPOND / (DUE / UNBLOCK) / REVIEW / FYI Choice per Slack or Jira candidate, packed
  several per request. Due dates, Blocked status, and direct mentions are deterministic
  floors Jev cannot lower. Unconfident answers fall back to the subagent's rules; the
  arithmetic ranking in `scripts/output.py` is unchanged.
- `scripts/jev_client.py` — shared standard-library client; `tests/test_jev_scripts.py`.

## 2.4.0
- **prioritize**: restore the explicit `duedate <= endOfDay()` deadline query per project, lost in the 2.3.0 twg move, so due and overdue issues never depend on paging or the detail budget.
- **sync**: new source `claude` — Claude Code session timestamps per project directory, clustered
  with 30-minute gap splits; the only duration source besides the calendar. Closes "the recap only
  counts meetings." Jira fetch hardened: maxResults 25, markdown format, minimal fields, nextPageToken
  paging (a 50-issue week overflowed 250k characters). Outlook ids switched to internetMessageId
  (search results carry no conversation id). Slack channel-id one-time resolution cached in config.
- **recap**: session clusters render as hours alongside calendar; closing **proposed allocation
  table** (union of meetings and sessions per project per day, double-booked slots counted once and
  flagged, Chris corrects and commits every number). Attribution rules are now **source-scoped** —
  a cross-source match misfiled internal commits under a client on the first live run; that error
  class is now structurally impossible. `subject_keywords` attribute sent mail. Display-noise filter
  for marketing/newsletters/Mavenlink notifications (ledger keeps them; render suppresses).
- **scripts/ledger.py**: `claude` source, `session` kind.
- Config schema: `project_map.*.claude_dirs`, `project_map.*.subject_keywords`.

## 2.3.0
- Move `prioritize` Jira collection and the Jira health check from jira-cli to twg. Queries keep `project = KEY` in the JQL and follow every page.
- `config` records Jira servers as twg sites: `site`, `auth` (`oauth` or `api-token`), and `login`. Sites outside the OAuth organization use API-token auth in an isolated `TWG_CONFIG_DIR`. `config_file` is now legacy.
- Consolidate prioritize on the existing sprint/release/backlog policy: discover Jira
  due-today/overdue obligations, preserve them alongside RESPOND/UNBLOCK through all
  display quotas, and compute quiet projects across delta and attention passes.
- Add Slack unread/DM human filtering and timestamp-aware urgency; repair Google
  Calendar REST-shaped commands, timezone windows, pagination and failure handling.
- Rank once with an offline Python helper and derive terminal, uncapped JSON snapshot,
  and safe, filterable Velir HTML from the same result. On-demand artifacts live under
  data_path; ambient runs never replace them. No loop behavior or typo alias changes.
- Add deterministic offline ranking, retention, schema/rendering and artifact tests.

## 2.2.0
- prioritize now ranks committed work first: each Jira item is tagged sprint, release, or backlog, and issues assigned long ago but never planned into a sprint no longer outrank current commitments.
- prioritize scopes its assigned-workload query per project. It previously ran unscoped, so jira-cli fell back to the single project in its config and reported one project as if it were the entire workload.
- prioritize reports how many assigned issues sit in no sprint or release instead of dropping them, so unplanned work stays visible.
- Items needing a reply or blocking someone else stay on the table regardless of sprint membership.
- prioritize output is explicitly concise: the NEXT line and the table are the whole answer, overriding a verbose host output style.

## 2.1.0 — 2026-07-09 — Communication loop Stage 1

- **sync** (new skill): idempotent reconcile of the work-event ledger from claude.ai connectors (Outlook, Calendar, Jira, Slack, Zoom-recap emails) plus local git. Per-source cursors advance only on complete passes; 30-day lookback cap; coverage record; envelope-only summaries with provenance tagging for untrusted text; read-only tool allowlist in frontmatter.
- **recap** (new skill): `--day` (best-effort digest, session-start friendly) and `--week` (the mandatory Mavenlink timesheet artifact, tolerates zero daily runs). Read-time project attribution from `project_map` in workshop.json; evidence lists with links, never fabricated hours — calendar blocks are the only durations; coverage gauge with explicit unaccounted-time label; timesheet section reads `actor: self` only; never aggregates by person; logs correction events as `kind: meta`.
- **scripts/ledger.py** (new): pure-stdlib append-only JSON Lines work-event store. Skip-if-present dedupe on source-native ids, schema validation, date-range query with last-write-wins, per-source cursors, sync coverage bookkeeping, atomic state writes.
- Config: `project_map` (per-project jira_prefixes / slack_channels / sender_domains / calendar_keywords / git_repos / client_visible_jira) and `git_repos` keys documented in the new skills.
- Design: plans/workshop-communication-loop.md revision 7.

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
