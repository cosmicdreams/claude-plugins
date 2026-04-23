# Drover — User Stories

This is drover's product spec expressed as user stories. Each story names a
role, a want, and a reason. The reason is the test: if a change stops
serving the reason, the change is wrong.

**Status legend:**

- **✅ Shipped** — in the product today.
- **🚧 In progress** — under active work.
- **📋 Planned** — scoped, not yet built.
- **💡 Backlog** — identified need, not yet scoped.

For each story we also keep a link to the feature or spec where it lives,
and a short "how we know it's true" acceptance note. When writing or
editing a story, prefer the passive-but-testable voice: not "drover is
fast" but "a user opens the dashboard and sees the first screen of errors
within 2 seconds."

---

## Glossary

- **Project** — a registered Drupal or WordPress site. Has one local DDEV
  env plus zero or more remote envs (usually Acquia dev / test / prod).
- **Env** — one environment within a project. `local`, `dev`, `test`,
  `staging`, `prod`, etc.
- **Fingerprint** — a hash derived from a normalized error (class, file,
  line, source). Drover's primary dedup key.
- **Card** — a Beads ticket, one per distinct fingerprint per project.
- **Group** — a user-defined collection of cards that represent the same
  underlying bug across projects. (See story 12.)
- **Pulse** — the live event feed in the dashboard header showing drover's
  own meaningful transitions.

---

## 1. Multi-project error visibility

**As** a Drupal platform lead managing several client sites,
**I want to** see every site's error stream in one dashboard,
**so that** I can triage across clients without switching tools or tabs.

**Motivation.** Platform engineers running 3–10 client sites today juggle
individual Acquia dashboards, watchdog tables, and Slack channels. The
real work — "what's on fire right now across my portfolio?" — has no
single surface.

**Acceptance.**
- A single `/drover:dashboard` call opens one URL that shows errors from
  every registered project.
- Errors from different projects appear in the same table and share the
  same lane semantics.
- Adding a new project via `/drover:add-project` makes its errors
  appear in the dashboard without restart.

**Status.** ✅ Shipped · virtual-central mode in the dashboard server;
`/api/board` merges cards across all registered `.beads/drover.db` files.

---

## 2. Dedup identical errors into a single ticket

**As** an on-call engineer,
**I want** identical errors to collapse into one ticket with an occurrence
count,
**so that** "this happened 47 times in the last hour" is a headline number
instead of 47 separate rows I have to scan.

**Motivation.** A 500-error stuck in a cron loop can fire thousands of
times a day. Without dedup the ticket list becomes unreadable and real
bugs hide.

**Acceptance.**
- When two log lines produce the same fingerprint, the second augments
  the existing card instead of creating a new one.
- The card shows a total occurrence count that increases over time.
- The pulse shows an `augmented` event when a fingerprint re-fires.

**Status.** ✅ Shipped · fingerprint-based dedup in `handleUmbrellaLine`
(`NEW` creates card, `THRESH` augments), `**Total Occurrences:**` field
on the card body.

---

## 3. Promote production errors ahead of staging/local noise

**As** an on-call engineer,
**I want** production errors routed to `Ready` faster than staging or
local errors,
**so that** customer-facing bugs don't get buried behind noise from
throwaway environments.

**Motivation.** A deprecation notice in local-dev and a fatal error in
production both exist in drover's logs. They shouldn't have the same
urgency treatment. The trust-level gradient (local = low, staging =
medium, prod = high) encodes that.

**Acceptance.**
- Each env in `drover-config.json` carries a `trust_level` and a
  `promote_threshold` with `min_count` and `min_severity`.
- The triage agent promotes a card to `lane-ready` when the threshold is
  met for that env.
- Production defaults are aggressive: `min_count: 1, min_severity: error`.
  Local defaults are forgiving: `min_count: 5, min_severity: error`.
- `immediate_promote_severities` (e.g. `emergency`, `critical`, `alert`)
  bypass count thresholds entirely.

**Status.** ✅ Shipped · encoded in env config schema and honored by
`drover:triage`.

---

## 4. Safe-by-default tracking

**As** a security-conscious operator setting drover up for the first
time,
**I want** drover to tail only my local DDEV env by default — not
production,
**so that** I never accidentally stream a client's production logs
before I've confirmed my setup and authorization.

**Motivation.** Streaming production logs carries real data-handling
implications. The principle of least surprise: installing a tool
shouldn't immediately open a hose of PII-adjacent logs to anyone who
ran `/drover:setup`.

**Acceptance.**
- New projects seeded via `/drover:setup` have `sources: []` on every
  Acquia env and `sources: ["drupal-watchdog"]` on the local DDEV env.
- Enabling a remote env is a single intentional click in the UI per env.
- The Sources modal pre-selects nothing for remote envs on first view.

**Status.** ✅ Shipped in 1.29.1.

---

## 5. Per-env tracking control with an obvious toggle

**As** a platform owner,
**I want** to turn tracking on or off for any specific env (project × env
pair) from the dashboard,
**so that** I can respond to changing needs (muting a noisy env during a
migration; enabling a new env post-deploy) without editing config files
by hand.

**Motivation.** Config files are intimidating; a visible toggle is not.
Tracking controls need to live in the place the user already spends
time — the dashboard.

**Acceptance.**
- Each env row in the Projects panel has a `role="switch"` toggle with
  `aria-checked` reflecting the real state.
- Toggle off writes `sources: []` to that env's drover-config.json and
  kills the umbrella's child watcher for that env.
- Toggle on writes the platform default (`drupal-watchdog` / `wp-debug`)
  and triggers the watcher to spawn.
- Project drawer carries the same toggle so it can be flipped from
  either location.

**Status.** ✅ Shipped in 1.29.0 / 1.30.0.

---

## 6. Config truth — the UI mirrors reality

**As** a skeptical user,
**I want** drover's UI state to match what drover is actually doing,
**so that** I can trust the dashboard as evidence instead of having to
verify with `ps` and `lsof`.

**Motivation.** Ops dashboards frequently lie by omission. A toggle that
says "on" but doesn't spawn a watcher (or one that says "off" while a
stale watcher keeps tailing) destroys trust and takes real data — not
labels — to detect.

**Acceptance.**
- Toggling an env on actually spawns (or kills) the umbrella child.
- The umbrella honors `sources=[]` as "don't spawn" (never emits a
  spawn key for a paused env).
- The drawer's Diagnostics section shows reconciliation: configured envs
  vs. live watcher pids. Drift is visible, not hidden.
- The header `LIVE` badge is a real state machine: `connecting / live /
  idle / offline`, tied to SSE readyState and recent event age.

**Status.** ✅ Shipped · reconciliation in 1.29.0; umbrella config-
respect in 1.33.2; honest LIVE badge in 1.29.0.

---

## 7. Live event pulse as proof of life

**As** a user looking at the dashboard,
**I want** to see drover's events arriving in real time,
**so that** I can visually confirm drover is working — silence should
be meaningful, not ambiguous.

**Motivation.** A static scoreboard can't answer "is it working?"
Movement can. A pulse feed turns the dashboard from a claim into
evidence.

**Acceptance.**
- Every meaningful state transition (new fingerprint, threshold
  crossing, lane change, solution captured, env toggle, watcher start /
  stop) emits a pulse event over SSE.
- The dashboard header strip always shows the most recent event.
- The strip expands into a feed of the last ~60 events.
- When no events are happening, the pulse is honestly quiet.

**Status.** ✅ Shipped in 1.32.0.

---

## 8. Document every resolved error (primary action)

**As** a Drupal platform operator,
**I want** documenting an error to be the single most obvious action on
the dashboard,
**so that** my team's institutional knowledge about each failure is
captured at the moment of resolution — not lost to a Slack thread or a
closed PR description.

**Motivation.** Drover's compound-interest asset is documentation.
Every error an operator resolves without writing down what it was and
what they did about it is memory that evaporates. The dashboard exists
to make *not evaporating* the easy path.

**Acceptance.**
- Every table row for an undocumented card in `lane-triage` / `lane-ready`
  carries a row-level `Document` button, styled as the primary per-row
  action (warn-accent pill), visible without opening a modal.
- The header carries a `N need documentation` count chip (also in warn
  accent) that filters the table to undocumented cards on click.
- Clicking `Document` opens the row modal with the capture form
  pre-expanded and focus landed on the root-cause field — no hunting.
- The capture form takes root cause (required) + fix summary (required)
  + commit SHA (optional). Submit writes a structured Actual block on
  the card, moves the card to `lane-done`, and emits an
  `error-documented` pulse event.
- Documented cards show `✓ documented` in the action column; the card
  no longer counts toward the "need documentation" chip.
- The skill `/drover:solution` is the CLI equivalent and writes to the
  same endpoint — no divergence between UI and CLI paths.

**Status.** ✅ Shipped in 1.39.1.

---

## 9. Recall — "have we seen this before?"

**As** an operator about to document a new error,
**I want** drover to surface any previously documented errors that look
similar,
**so that** when the same root cause recurs on a different site or a
different fingerprint, I can reuse the past resolution with one click
instead of rediscovering it.

**Motivation.** The grouping feature (§12) solves the "same bug, two
tickets" problem when the operator knows they're related. Recall solves
the "might be the same bug, I don't remember" problem by consulting
history automatically on every new documentation event. Together they
make drover's memory function useful.

**Acceptance.**
- `GET /api/recall?card_id=…&project=…` returns the top N similar
  documented errors across every registered project, scored on
  exception-class match + fingerprint match + source/env match +
  message-token Jaccard overlap.
- The capture modal renders the top results at the top of the form as
  "Have we seen this before?" with match scores, past root cause and
  fix summary rendered for the operator to read.
- Each match carries an `Apply this` button that prefills the current
  card's capture form with the past root cause / fix summary / commit
  SHA. The operator can then tweak and save.
- When there are no matches, the section says so plainly —
  *"No documented matches across your registered projects yet. You're
  the first."* — rather than rendering an empty shell.
- `/drover:recall <keyword>` remains as the CLI equivalent for ad-hoc
  searching outside a specific card's context.

**Status.** ✅ Shipped in 1.39.1.

---

## 10. Projects-first mental model

**As** a platform operator,
**I want** drover to treat projects as first-class entities,
**so that** I can reason about "what is drover watching for pncb?"
in one place — not as three separate answers spread across the UI.

**Motivation.** Pre-1.30, the dashboard organized around DDEV instances.
That conflated two things: the container layer (DDEV) and the product
layer (the client site). Clients have multiple envs across multiple
layers; thinking per-project fixes the abstraction.

**Acceptance.**
- The top panel is "Projects," not "DDEV Instances."
- Each tile is one project with all its envs displayed as toggle rows.
- Clicking a tile opens a project drawer with Environments / Project /
  Diagnostics sections.
- Env labels on cards normalize to canonical names (`local`, not
  `AHRI-main`).

**Status.** ✅ Shipped in 1.28.0–1.30.1.

---

## 11. Orphan watcher hygiene

**As** a long-running user,
**I want** drover to clean up after itself as I restart the dashboard
over the course of iteration,
**so that** I don't accumulate dozens of stale umbrella processes
holding socket connections and competing with the current dashboard
for the same streams.

**Motivation.** During development and normal operation, dashboards
restart. Without explicit reaping, each restart leaves a zombie
umbrella + acquia-watch children. We observed 182 orphaned processes
in a single session.

**Acceptance.**
- On startup, the dashboard detects umbrella-watch.sh processes that
  aren't its own child and offers / performs a reap.
- Clean shutdown (SIGINT / SIGTERM on the dashboard) tears down the
  umbrella and all its children.
- The reconciliation banner in the project drawer flags any orphan
  (config says paused but pid is alive).

**Status.** 📋 Planned · reap-on-boot is scoped, not yet implemented.
Manual reap performed during demo prep.

---

## 12. Cross-project error grouping

**As** a Drupal platform lead maintaining several client sites,
**I want to** mark errors across different projects as "the same issue,"
**so that** I can fix one root cause once and track its impact across
every site it affects — instead of chasing N near-duplicate tickets.

**Motivation.** Fingerprinting is a heuristic; the same bug on two
projects often produces two fingerprints because their URLs or line
numbers differ. We've agreed no heuristic will be perfect — the system
should suggest, the user should commit.

**Acceptance.**
- A user can multi-select rows in the table and mark them as a group.
- Grouped rows render as one parent row with a member count; expanding
  reveals per-project children.
- Drover suggests candidate members based on similarity signals (class,
  normalized message, first stack frame, source, temporal co-occurrence);
  user accepts or rejects each.
- Rejected pairs are never re-suggested for that group.
- Capturing a solution on a group member offers to propagate it to all
  members.
- Grouping state persists across dashboard restarts.

**Status.** 📋 Planned · full spec in
[drover/docs/grouping-spec.md](./grouping-spec.md) *(to be written — draft
lives in the conversation preceding this doc's creation).*

---

## 13. Fingerprint granularity is user-overridable

**As** a user,
**I want to** tell drover "these two fingerprints are actually the
same error class,"
**so that** I can override drover's automatic grouping heuristic when
it misses a cross-project similarity — without having to edit a regex
or a config file.

**Motivation.** Corollary to story 12. Any automatic grouping will
misclassify some real duplicates. The tool's response shouldn't be
"try harder"; it should be "let the user fix it, and learn from the
correction."

**Acceptance.**
- The grouping UI (story 12) is the override mechanism.
- Explicit rejects of suggested pairs are persisted and respected.
- Drover's rejection-aware suggestion model tunes itself over time
  (post-v1).

**Status.** 📋 Planned · linked to story 12.

---

## 14. Trust verification — "prove it's working"

**As** a user new to drover,
**I want** observable, reviewable evidence that drover is doing what it
claims,
**so that** I can trust the pipeline with production data without
auditing the codebase line by line.

**Motivation.** Agent-driven tools demand higher trust floors than
manual ones. "It says it's streaming" isn't enough; the user needs
timestamps, reconciliation, and diagnostic narrative.

**Acceptance.**
- Absolute timestamps (not relative ages) on every live element.
- Reconciliation banner in the project drawer.
- Honest empty states ("no events yet" vs fabricating content).
- `LIVE` badge that reports connecting / live / idle / offline
  truthfully.
- Idle state carries a reason (no config, no events, etc.).

**Status.** ✅ Shipped in phases (1.29.x – 1.32.x). Reconciliation
banner is the current weak link — planned for enhancement.

---

## 15. Portfolio-level documentation narrative

**As** a manager watching drover across a portfolio of client sites,
**I want** a visible headline of drover's documentation activity,
**so that** the value story ("9 new errors caught today · 7 documented
· 2 marked as noise · 3 recalls from past solutions applied") is the
first thing I see — not just a scoreboard of open-error counts.

**Motivation.** Drover's differentiation isn't "another error
dashboard"; it's "an error-tracking system that accumulates
institutional memory." Manager-visible surfaces should lead with what
the memory is doing for the team, not with the raw error count.

**Acceptance.**
- A "today" strip (or similar) shows: new tickets filed, errors
  documented, recall suggestions applied, cards marked as noise.
- The numbers are honest (no fabricated activity on fresh installs).
- Historical trend available on hover or in a detail view.

**Status.** 💡 Backlog · spec'd, not yet built.

---

## 16. Dismiss as known noise

**As** an operator,
**I want** a one-click "this is noise, ignore forever" action on any
card,
**so that** false positives and known-but-unactionable errors
don't clog my documentation queue.

**Motivation.** Not every error deserves documentation. Some are
transient environmental noise. Some are known bugs in third-party code
that we've decided not to address. An error-tracking tool that forces
every ticket to be either "documented" or "still open" would drive the
team to ignore it or rubber-stamp noise as resolved. A first-class
"noise" terminal state is essential.

**Acceptance.**
- The card modal exposes a `Mark as known noise` button as a secondary
  action next to `Document`.
- Clicking prompts for a reason (required — "why is this noise?") and
  moves the card to `lane-noise`.
- Noise cards show `⌀ noise` in the action column and drop out of the
  "need documentation" count.
- A `noise-marked` pulse event records the action, origin, and reason
  so the feed shows this as real triage work.
- Noise cards remain queryable via the Lane facet for audit / undo.

**Status.** ✅ Shipped in 1.39.1.

---

## 17. Advisor-agent: suggest a solution from history

**As** an operator about to document a new error,
**I want** an advisor-agent to read my team's past documented solutions
and suggest what the root cause and fix are likely to be,
**so that** for errors we've seen before (even on different projects
or under slightly different fingerprints), the work is proofreading a
suggestion rather than starting from a blank form.

**Motivation.** Recall (§9) surfaces similar past *tickets*. An
advisor-agent goes one step further: given N past documentations of
similar errors, it proposes a consolidated hypothesis — "this error
pattern is caused by X; the fix is Y; commit Z had the canonical
change." That's the legitimate, in-scope agent role — using history as
data, not writing code.

**Acceptance.**
- When the capture modal opens on an undocumented card, the advisor
  runs `/api/recall` (or its agentic equivalent) and, if results are
  strong (≥0.75 confidence), posts a prefilled hypothesis into the
  capture form — not just a "here's a match" link, but an actual
  candidate `root_cause` / `fix_summary`.
- The operator reviews, edits, and saves. Edits feed back into the
  recall scorer's rejection-aware tuning (see §13).
- The advisor **never edits source**. It never creates worktrees. It
  never runs tests. It reads the bd database and writes structured
  text into a single card's body on the operator's behalf, pending
  their `Save` click.

**Status.** 📋 Planned · `/api/recall` exists as of 1.39.1 but agent
wrapper + prefill path not yet built.

---

## 18. Implementer-agent: opt-in, not the product

**As** a team experimenting with AI-assisted development,
**we want** the optional implementer-agent workflow to exist for teams
that want to try it,
**but we do not want** drover to position itself as a fix-writing tool
or to lead the UX with it.

**Motivation.** Writing code from an agent in a production codebase
requires granting the agent permissions drover does not ask for by
default (worktree create, source edit, DDEV exec, test runs). The
security and governance bar is high enough that auto-fix should never
be what drover markets itself as. An optional skill for teams that have
done that evaluation is fine; the default surface should not mention
it.

**Acceptance.**
- The `Lane` sidebar facet hides `lane-implementing` and
  `lane-awaiting-review` by default (shown only when a card is
  currently in one of them).
- The README + ONBOARDING describe the implementer-agent as an
  optional, opt-in capability under a clearly-labelled "experimental"
  section, not as the primary flow.
- The dashboard's row-level CTA is `Document`, not `Confirm fix`.
- Agent notes (Projected block) render in the modal as muted,
  de-emphasized reference material labeled `Agent notes (optional) —
  not drover's documentation`, clearly subordinate to the human's
  Documented block.

**Status.** ✅ Shipped in 1.39.1.

---

## Open questions / needs refinement

- **Solution propagation UX.** When a solution is documented on a
  group member, what does the prompt look like for applying it to
  siblings? (Affects story 12.)
- **Notifications policy.** Who gets pinged for what, and where?
  Slack vs. email vs. in-dashboard. Needs a story.
- **Rejection-aware recall.** Story 13 calls for the recall scorer to
  learn from operator rejections. The rejection-pair storage schema
  isn't designed yet.
- **Velocity boosting.** Should an accelerating error rate promote a
  card ahead of its threshold? Partially implemented (`velocity-rising`
  label) but not surfaced as a user story.
- **Team sharing of groups.** Groups currently live in
  `$CLAUDE_PLUGIN_DATA/drover-groups.json` — machine-local. Shareable
  across a team would require a different storage location (likely a
  shared repo). Requires a story.

---

## Contributing a new story

1. Pick the lowest-numbered `N+1`; add a heading `## N+1. <title>`.
2. Write the "As / I want / so that" with concrete roles (not
   "the user"; name the role). Reason is a testable outcome, not a
   feeling.
3. Write 3–6 acceptance bullets. Prefer observable behavior over
   implementation detail.
4. Set status to 💡 Backlog unless a specific cut of work is already
   under way.
5. Commit as `docs(drover): story N+1 <title>` with the motivation in
   the body.
