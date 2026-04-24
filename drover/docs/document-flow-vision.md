# Drover — The Document Flow Vision

Companion to `user-stories.md` §8, §9, §12 and `grouping-spec.md`. This
document describes the full user experience of documenting errors in
drover — from the moment an operator looks at the error table through
the save that propagates knowledge to every affected card.

**Status:** Vision doc, pre-implementation. Current UX is a basic
modal with two textareas + a commit-SHA field, opened one card at a
time. This spec describes the target we're designing toward.

---

## Why this doc was revised

An earlier draft treated Document as a single-card action — click a
row, fill a form, save. That worked for isolated errors. It breaks
down — in fact, it actively undermines — the cross-project grouping
flow we ship today.

The broken case: an operator groups five cards representing the same
DB reserved-word bug across three projects. They click Document on
one member. They write the fix. The sheet closes. The **other four
cards are still undocumented.** The operator has to open each sibling
and either retype the solution or click "Apply from sibling" — an
action that doesn't exist. *Grouping promised them one bug to manage;
documenting made it five chores.*

This revision fixes that by making **the group itself a documentable
thing.** One solution, captured once, written to every member. The
per-item document path remains — it's the right flow for ungrouped
cards — but it's no longer the only path.

A second gap the earlier draft had: it started mid-flow, at the
moment the operator clicks Document. Nothing about how the operator
got there — the triage, the scanning, the recognition, the decision
to commit to a path. Those stages are where the product's perceived
intelligence lives, and they're where the grouping path begins.

This revision adds them.

---

# Part I — Before Document: the triage loop

Documentation is the *output* of a process that starts the moment the
operator opens the dashboard. If the triage surface doesn't support
scanning, pattern-recognition, and selection, everything downstream
is harder than it needs to be.

## Stage 0 — Scan

The operator arrives at the dashboard and asks: *what's on fire?*
The table answers this with:

- **Severity color in the leading glyph** (critical/alert/error/warn).
- **Occurrences** (the number beside the message).
- **Last seen relative time** (tabular figures, right-aligned).
- **Project + env chips** on the right.
- **Lane** as a row-state treatment (row tint for `documented`, muted
  opacity for `noise`, bold for `triage`).
- **Sidebar facets** (Severity, Project, Lane, Env) with counts.

The Scan UX rules (from ui-ux-pro-max):

- `visual-hierarchy` — rank is established by size + weight, not by
  color alone. Severity color is *supplemental*.
- `number-tabular` — occurrence counts and relative times use tabular
  figures so the eye can scan down columns without re-aligning.
- `content-priority` — error text gets the widest column on every
  viewport; metadata compresses first on narrow screens.
- `virtualize-lists` — rendering stays smooth past 1000 rows (the
  current table starts hitching around 300).

Nothing clickable in Stage 0. The operator is looking, not deciding.

## Stage 1 — Recognize

The operator's brain starts pattern-matching: *that looks like the
cron error I saw yesterday* or *that exception class is showing up on
three different projects.* The surface helps with:

- **Fingerprint siblings indicator** — a small pill next to the error
  title: `also on pncb · ahri` when the same fingerprint appears in
  multiple projects' tickets. Click the pill → facet-filter to siblings.
- **Recall preview on hover** (desktop) — hovering a row for >500ms
  surfaces a popover: *"2 past matches — chris · 3d ago, jane · 1mo
  ago."* A prompt that recall exists without forcing the operator to
  open the sheet.
- **Group badges** — grouped cards render as a single parent row with
  `⊞ N errors · <projects>` in the error cell. Click-through opens
  the group modal.

Stage 1 is where the operator decides which path they're on:

- **Single** — one error, isolated. They'll click Document on the row.
- **Group-existing** — a group they've already created. They'll open
  the group, then Document the group.
- **Group-new** — they recognize two or more separate rows as the
  same bug. They'll multi-select → Group → (then Document the new
  group).
- **Noise** — they recognize the row as a known false-positive.
  They'll mark-as-noise directly from the row action menu.

Decisions are faster when the surface tells them which siblings, groups,
or recalls already exist for what they're looking at. This is the entire
purpose of Stage 1.

## Stage 2 — Select

The left-most column of the table is a **selection checkbox** per row.
Selecting triggers the bulk-action bar.

Selection rules:

- `touch-target-size` — checkbox hit area is 44×44pt minimum; the
  visual checkbox can be smaller but the hit zone extends to the row's
  left padding.
- `keyboard-nav` — `Space` on a focused row toggles selection;
  `Shift+Click` or `Shift+Space` extends a range; `Esc` clears.
- `state-clarity` — selected rows get a 3-4px left accent bar and a
  subtle surface tint (not a color-only signal).
- `indeterminate` on the header select-all when the selection is
  partial.

### The bulk-action bar

Appears above the table when selection count ≥ 1. Slides in (not
drops, not fades — slide preserves spatial continuity per `continuity`
rule). Sticky at the top of the table, below the main header.

```
┌────────────────────────────────────────────────────────────┐
│  3 selected                                                 │
│  [ Group & Document… ]   [ Group without documenting ]      │
│  [ Mark as noise ]       [ Clear selection ]                │
└────────────────────────────────────────────────────────────┘
```

**Primary CTA** (`primary-action` rule): *Group & Document…* —
combined because the common case is "I just noticed these are the
same; I want to handle them together." The ellipsis signals that a
sheet opens; no action is taken yet.

**Secondary**: *Group without documenting* — for operators who want
to group now and document later.

**Tertiary**: *Mark as noise* — bulk-silence without a solution.

**Quiet**: *Clear selection* — right-aligned, low-emphasis.

Disabled rules:
- Selection of 1 → `Group & Document` label changes to `Document…`
  (same button, same position, no group created).
- Selection of 0 → bulk bar is hidden entirely.
- Selection mixing already-documented and undocumented cards →
  button label becomes `Document selection…` (same destination — the
  sheet applies groupthink semantics; see §IV).

## Stage 3 — Decide

One click on the primary CTA commits the operator to the Document
flow. The decision point is intentionally simple: everything more
nuanced (propagation, playbook promotion) happens *inside*
the sheet, where the operator has the material in front of them.

`progressive-disclosure` — don't make the operator answer five
questions on the table to open the sheet. Open the sheet; answer the
questions in context.

---

# Part II — Three paths into Document

All three paths land on the same Document sheet, which **adapts its
shape** to what it's documenting. This is the core design move: one
surface, three entry points, unified save behavior.

### Path A — Single card (no group)

- Entry: click `Document` on a row's action cell, or select 1 row and
  click the bulk-bar button, or press `D` on a focused row.
- Sheet opens in **single-mode**.
- Save writes one Actual block to one bd card.

### Path B — New group

- Entry: select 2+ rows → click `Group & Document…`
- Behind the scenes: drover creates the group (bd labels + JSON
  write, per `grouping-spec.md` ordering rules). On success, the
  sheet opens in **group-mode**, titled with the new group's auto-
  generated name (which the operator can edit in the sheet header).
- On rollback (bd label write fails for any member): sheet does not
  open. An inline error appears on the bulk bar with `error-recovery`
  guidance: *"Couldn't group — pncb-test is unreachable. Retry when
  online."*
- Save writes one Actual block to N bd cards (the group members).

### Path C — Existing group

- Entry: click a group parent row in the table. The group modal that
  exists today is replaced by the Document sheet in group-mode,
  header titled with the existing group name.
- If the group already has an Actual block → the sheet opens in
  **read-mode** (not write-mode), showing the current group
  documentation with an `Edit documentation` button that flips to
  write-mode. `read-only-distinction` rule.
- Prior per-member documentation on any member is irrelevant to the
  display — joining a group superseded it. See *Groupthink:
  supersede-on-join, fork-on-leave* in §IV.

All three paths share: header, Understand column, Capture column,
keyboard model, save behavior shell. The differences are the **header
stats, the member list, and the save semantics.**

---

# Part III — The insight (unchanged)

Documenting isn't closing a ticket. It's **knowledge capture**. The
operator is taking something they've just understood and transmitting
it to their future self, their teammates, and the agent-advisor that
will propose answers to the next similar error.

Once you see the act as knowledge capture, the surface reorganizes
around one question: **what does the operator need, in sequence, to
capture something useful?**

And once you accept that groups exist as first-class citizens, the
question expands: **what does the operator need to capture something
useful that applies to N related errors at once?**

---

# Part IV — The Document sheet (unified)

The sheet is a **right-side full-height panel** docked over a dimmed
table. Two columns inside: **Understand** (read-only, ~45% width) and
**Capture** (write, ~55% width). Both independently scrollable. The
sheet's behavior differs by mode; the shell does not.

## Header (mode-aware)

**Single-mode:**
```
Document: DatabaseExceptionWrapper           ✕
1 error · pncb · test · first seen 3d ago
```

**Group-mode (new or existing):**
```
Document group: "DB reserved-word" ⟶ [ Rename ]   ✕
5 errors · 3 projects · first seen 5d ago · 47 occurrences
[ Members (5) ▾ ]   [ Ungroup ]
```

Header rules:
- `truncation-strategy` — group name truncates with ellipsis; full
  name on hover.
- `primary-action` — the close button (`✕`) is visually subordinate
  to the save button further down; it never pulls focus.
- `confirmation-dialogs` — close with unsaved changes prompts before
  dismissing (`sheet-dismiss-confirm` rule).

## Understand column (mode-aware)

**Single-mode:** the card's own error data — class, message,
sparkline, URL, hook, source, env, stack, surrounding log,
one-click openers, scratch notes. This is the ~45% left column from
the original sketch.

**Group-mode:** *the group's aggregate data plus a member list.*

```
UNDERSTAND (group, 45%)
────────────────────────
Shared across members:
  Class      DatabaseException…   (5 of 5 match)
  Msg shape  "syntax error near…" (5 of 5 match)
  Source     other (watchdog)      (5 of 5 match)
  Category   — (set below)
  Env mix    test (3), prod (2)

Occurrence trend (all members, 7d)
  ╭──────.─────────╮
  ↑ 47 total · peak 14 (yesterday)

Members (5) ─────────────────────
  • pncb-test  · sprint-abc · 14 occ · last 2m  ▸
  • ahri-prod  · sprint-def · 12 occ · last 9m  ▸
  • pncb-prod  · sprint-ghi ·  8 occ · last 1h  ▸
  • sch-test   · sprint-jkl ·  7 occ · last 2h  ▸
  • ahri-test  · sprint-mno ·  6 occ · last 3h  ▸
  (click a member to jump to its individual error data)

Combined log context (60s window, all members) ▾
Combined stack fingerprints (3 shapes) ▾

[ Open all approots ]  [ Acquia logs for 3 envs ]
[ git blame (first member) ]
```

Key patterns:

- **Shared fields** are shown once with a "(N of M match)" badge.
  When a field *doesn't* match across all members (e.g. URL differs),
  it moves to a per-member expansion.
- **Members list** uses 44pt row height minimum (`touch-target-size`)
  with a click-to-drill-in chevron. Drilling in *does not close the
  sheet* — it switches the Understand column to that member's data
  temporarily, with a `[ Back to group overview ]` button. The
  Capture column stays in group-mode. `state-preservation` rule.
- **Aggregate actions** (`Open all approots`) are offered when they
  make sense. Drover does not open 5 Finder windows without a
  confirmation (`confirmation-dialogs`) when count > 3.

## Capture column (mode-aware)

**Single-mode** keeps the fields from the original vision:

- Have-we-seen-this (recall)
- Category picker
- Root cause textarea
- Fix summary textarea
- Commit/PR/Links slots
- Tags multi-select
- Preview pane

**Group-mode** changes the semantics:

```
CAPTURE (group, 55%)
────────────────────

[ Have we seen this? 3 ▾ ]       ← recall scoped to the group shape
↳ ahri-prev · 100% · chris · 3d ago
  "Reserved word, backticks." [Apply to group]

Category: [ DB issue ▾ ]          ← applied to all 5 members

Root cause ────────────────────
┃ Template hint: DB issue — name
┃ the query pattern + version.
(the solution you write here is the group's solution)

Fix summary ────────────────────
┃

Commit / PR / Links   + add      ← applied to all 5 members
Tags: drupal-core · mysql-8      ← applied to all 5 members

┌─ Writes to (all 5 members) ─────────────────┐
│ ☑ pncb-test  · sprint-abc                   │
│ ☑ ahri-prod  · sprint-def                   │
│ ☑ pncb-prod  · sprint-ghi                   │
│ ☑ sch-test   · sprint-jkl                   │
│ ☑ ahri-test  · sprint-mno                   │
│                                             │
│ Uncheck to ungroup a member before saving.  │
│ Groups commit to one truth; see Groupthink. │
└─────────────────────────────────────────────┘

Preview — how this reads when recalled
┃ DatabaseException (DB issue)
┃ Root cause: …
┃ Fix: …
┃ Applies to: 5 grouped errors

☐ Notify @jane (last-edited affected file)
☐ Add to playbook: DB reserved-word

[ Save group documentation ]
[ Mark group as known noise ]
```

Design decisions in group-mode:

### One solution, captured once, default applies to all

The propagation block is **default-on, every member checked.** This
inverts the earlier draft's "opt-in at save" framing. If you grouped
these cards, you are asserting they share a root cause; the sheet
should assume one solution covers them unless you say otherwise.
`primary-action` rule — the save button says *"Save group
documentation"*, not *"Save and apply to N"*, because applying is
the point of group-mode, not a modifier.

### No per-member overrides — if they differ, ungroup

Unchecking a row in the *Writes to* list is **not** "skip this one"
— it means *"remove this member from the group before I save."* The
save then writes the group doc to the remaining checked members and
the unchecked card becomes a plain single-mode card, forked from the
in-progress group doc (see *Groupthink* below).

There is no per-member override and no variant-of-the-group-solution
sub-sheet. If the fixes differ, the cards weren't the same bug; they
should ungroup. The design refuses to hedge against the operator's
own grouping decision.

### Recall is scoped to the group shape

Recall input in group-mode uses the **shared fields** (class + msg
shape + source) to query, not any single member. The results are
scored as usual but tagged with *"matches N of the group's 5
members"* so the operator knows how confidently they're importing.

### Groupthink: supersede-on-join, fork-on-leave

Grouping is a commitment to one truth. Drover enforces it with two
symmetric rules.

**Supersede on join.** When a card joins a group — at creation or
added later — its independent Actual block, if any, is marked
superseded and retained in history. Display switches to the group's
Actual block immediately. The operator does not reconcile; the
group wins.

**Fork on leave.** When a card leaves a group (single-member ungroup
or full dissolve), it is initialized with the group's current Actual
block as its own. The satellite is frozen at the moment of fork —
future group edits do not propagate to it, and satellite edits do
not flow back. From that moment the card is a plain single-mode
card, allowed to live its own life.

If a group never had an Actual block, members that leave are
initialized empty. Pre-join superseded docs are **not** auto-restored
— joining was the commitment; history is retrievable (via the
superseded record), not default.

The satellite records a `forked_from_group` lineage pointer for
recall and analytics. It's metadata, not behavior.

### Concurrent edits

If a group save lands while a member's per-member Actual block was
edited in another tab, the group save wins — the concurrent edit is
superseded along with any pre-join history. No conflict dialog, no
merge ceremony. The operator who grouped the cards is asserting
groupthink; concurrent per-member writes don't get a veto.

---

# Part V — The six-stage journey (reframed)

The six-stage journey from the earlier draft still holds. In
group-mode, the stages map onto the group as a whole:

1. **Understand** — the group's aggregate data + member list, not a
   single card's fields.
2. **Investigate** — one-click openers for each affected project's
   approot, Acquia logs, git blame of the first member. Scratch
   notes persist per-group (localStorage key = group id).
3. **Write** — one Category, one Root cause, one Fix summary, one
   set of Tags. The group speaks with one voice.
4. **Commit with intent** — the propagation block defaults to all-on;
   the save button's text communicates that this is a group write.
   `Save & notify` and `Save & add to playbook` are available as
   before.
5. **Feel the contribution** — the toast changes: *"Documented 5
   errors with one solution. Your notes will help the next operator
   who sees any of these."* The header counter becomes *"You've
   documented 7 this week (including 1 group of 5)."*
6. **Reap the reward** — recalls that match any member of the group
   surface the group's documentation, credit the original author,
   and show *"applies to 5 grouped errors"* so the next operator
   understands the scope of the solution they're importing.

For single-mode, the six stages behave exactly as the earlier draft
described. Same shell, different data.

---

# Part VI — Sketch (single & group)

## Single-mode sketch

```
┌─── Document: DatabaseExceptionWrapper ───────────────────── ✕ ┐
│                                                                │
│  UNDERSTAND (read-only, 45%)    │   CAPTURE (write, 55%)       │
│  ─────────────────────────────  │   ──────────────────────     │
│  Class: DatabaseException…      │   [ Have we seen this? 2 ▾ ] │
│  Msg:   syntax error near…      │   ↳ ahri · 100% · chris ·    │
│                                 │     3d ago [Apply this]      │
│  First seen 2026-04-20 14:02    │                              │
│  Last seen  2026-04-23 15:59    │   Category: [ DB issue  ▾ ]  │
│  Occurrences 47 ╭───.─╮         │                              │
│                                 │   Root cause ────────────    │
│  Project · Env  pncb · test     │   ┃                          │
│  URL   /career-pathways/…       │                              │
│  Hook  simple_cron              │   Fix summary ───────────    │
│  Source other (watchdog)        │   ┃                          │
│                                 │                              │
│  Stack (12 frames)        ▾     │   Commit / PR / Links  + add │
│  Surrounding log (60s)    ▾     │   Tags: drupal-core · cron   │
│                                 │                              │
│  [ Open approot ]  [ Acquia ]   │   Preview —                  │
│  [ git blame ]     [ Jira ]     │   ┃ DatabaseException        │
│                                 │   ┃ Root cause: …            │
│  Scratch notes:                 │                              │
│  (your working thoughts…)       │   ☐ Notify @jane             │
│                                 │   ☐ Add to playbook          │
│                                 │                              │
│                                 │    [ Save documentation ]    │
│                                 │    [ Mark as known noise ]   │
└────────────────────────────────────────────────────────────────┘
```

## Group-mode sketch

```
┌─── Document group: "DB reserved-word"   [ Rename ]  ─────  ✕ ┐
│    5 errors · 3 projects · 47 occurrences · first seen 5d   │
│    [ Members (5) ▾ ]   [ Ungroup ]                          │
│                                                              │
│  UNDERSTAND (group, 45%)        │   CAPTURE (group, 55%)     │
│  ─────────────────────────────  │   ──────────────────────   │
│  Shared across members:         │   [ Have we seen this? 3 ▾]│
│  Class    DatabaseException…    │   ↳ ahri-prev · 100% ·     │
│           (5 of 5 match)        │     chris · 3d ago         │
│  Msg      syntax error near…    │     [ Apply to group ]     │
│           (5 of 5 match)        │                            │
│  Source   other (watchdog)      │   Category: [ DB issue ▾ ] │
│           (5 of 5 match)        │   (applied to all 5)       │
│  Env mix  test 3 · prod 2       │                            │
│                                 │   Root cause ────────────  │
│  Trend (7d, all members)        │   ┃ Group solution —       │
│  ╭────────.─────╮  47 total     │   ┃ one write, all members │
│  peak 14 yesterday              │                            │
│                                 │   Fix summary ───────────  │
│  Members (5) ─────────────────  │   ┃                        │
│  • pncb-test · 14 occ · 2m   ▸  │                            │
│  • ahri-prod · 12 occ · 9m   ▸  │   Commit / Links  + add    │
│  • pncb-prod ·  8 occ · 1h   ▸  │   Tags: drupal · mysql-8   │
│  • sch-test  ·  7 occ · 2h   ▸  │                            │
│  • ahri-test ·  6 occ · 3h   ▸  │   ┌ Writes to ───────────┐ │
│                                 │   │ ☑ all 5 members      │ │
│  Combined log (60s)       ▾     │   │ uncheck = ungroup    │ │
│  Stack shapes (3 forms)   ▾     │   └──────────────────────┘ │
│                                 │                            │
│  [ Open all approots ]          │   Preview —                │
│  [ Acquia · 3 envs ]            │   ┃ (group) DatabaseExc…   │
│  [ git blame (first) ]          │   ┃ Applies to 5 errors    │
│                                 │                            │
│  Scratch notes (group):         │   ☐ Notify @jane           │
│  (your working thoughts…)       │   ☐ Add to playbook        │
│                                 │                            │
│                                 │  [ Save group docs (5) ]   │
│                                 │  [ Mark group as noise ]   │
└──────────────────────────────────────────────────────────────┘
```

## Keyboard model (unified)

- `Tab` / `Shift+Tab` — moves within Capture column only; Understand
  is scroll + collapse, not in the tab order.
- `Cmd/Ctrl+Enter` — saves (group-mode: saves to all checked members).
- `Esc` — dismisses; prompts if unsaved changes.
- `↑` / `↓` on recall matches — focus traversal; `Enter` — Apply.
- `[` / `]` on the members list (group-mode) — prev/next member drill.
- `G` — jumps focus to the group header (for rename, ungroup).

All destructive actions (Ungroup, Mark as noise, Overwrite peer doc)
are `confirmation-dialogs` gated, `destructive-emphasis` styled.

## Why a sheet, not a modal

- Modals imply a blocking decision. Documentation — especially group
  documentation — is iterative: read, investigate, write, read again.
- The sheet keeps the rest of the queue visible behind the scrim
  (`modal-escape` + peripheral awareness).
- Group-mode especially benefits: the operator can see *other* groups
  on the queue behind the scrim and judge priority without closing.
- A sheet's aspect ratio supports the two-column Understand / Capture
  split the earlier draft established.

---

# Part VII — Post-save iteration

The forward loop from the earlier draft, extended for groups:

- **The group is recalled.** When a fingerprint matching any member's
  shape recurs — on an existing member, or on a brand-new ticket —
  drover surfaces the group's Actual block as a recall match. The
  match's header reads *"Documented as part of DB reserved-word group
  (5 errors)"* and the Apply action writes the solution onto the new
  card with a link back to the group.
- **A member is detached.** If the operator ungroups later, each
  former member keeps the group's Actual block as its own (the
  documentation persists; only the group membership is gone). Future
  recalls treat each detached card as a sibling of the others via
  fingerprint, not via group id.
- **A member is documented separately after group save.** The per-
  member Actual block coexists with the group's; on display, the
  per-member block wins locally but the group block remains the
  canonical description of the bug class. Recalls surface both, with
  the per-member one labeled *"variant"*.
- **The group is promoted to a playbook.** Only available when the
  group has ≥3 members with a shared category. The playbook's
  authored-by field credits the operator who wrote the group doc.
- **The group is dissolved but members keep retroactive lineage.**
  Each former member's Actual block gains a `documented_as_part_of`
  reference so history isn't lost.

Each of these events emits a pulse event.

---

# Part VIII — Data model implications

Extending the earlier draft's `actual` block:

```
### Actual  (captured: <ts>, by: <operator>)
- mode:              "single"   |  "group"
- group_id:          null        |  "grp-abc123"
- group_snapshot:    null        |  { name, member_count, member_ids[] }
- forked_from_group: null        |  { group_id, forked_at, parent_doc_version }
- category:          "db-issue"
- root_cause:        "…"
- fix_summary:       "…"
- fix_commit_sha:    "…"
- tags:              ["drupal-core", "cron", "mysql-8"]
- links:             [{"kind":"pr","url":"…"}]
- playbook:          null  |  "db-reserved-word"
- recalls:           [ { ts, applied_by, on_card, on_project } ]
- superseded_by:     null  |  { version, ts, author, reason }
- propagate_targets: [ { project, card_id } ]
- notify:            [ { kind:"slack", target:"jane", ts } ]
```

On a group save, drover writes the same Actual block to each
propagate target card in bd, with `mode: "group"` and `group_id` set.
Each write is independent (atomic per card, not atomic across the
group — partial failures surface as `member_errors` in the save
response and the operator sees a retry dialog for failed members).

On group **join**, any prior per-card Actual block is moved to
`superseded_by` (`reason: "joined-group"`) and the card's current
display block is the group's. On group **leave**, the satellite
inherits the group's current Actual block frozen, records
`forked_from_group`, and from then on is a plain single-mode card.

Backwards-compatible: all new fields optional. Existing card bodies
parse as `mode: "single"` implicitly.

---

# Part IX — Phases

**Phase 1 — Sheet shell (single-mode only).** Swap modal for sheet.
Split into Understand / Capture columns. Move recall to top of
Capture. Keep existing fields. No new data collected. ~3 hours.

**Phase 2 — Triage prelude.** Row selection checkboxes + bulk-action
bar with `Document…` (single) / `Group & Document…` (multi) /
`Mark as noise` / `Clear`. Keyboard support for selection. ~4 hours.

**Phase 3 — Single-mode context-in-reach.** Parsed error rendering
in Understand, collapsed stack + surrounding-log, one-click openers
(approot / Acquia / git blame), scratch notes. ~4 hours.

**Phase 4 — Single-mode scaffolded capture.** Category picker,
template hints, tags, structured links, live preview. ~4 hours.
Requires data model extension for category + tags + links.

**Phase 5 — Group-mode shell.** Sheet adapts header + Understand +
Capture for group. Members list with drill-in. Shared-fields rollup
with "(N of M match)" badges. Aggregate openers. No propagation yet
— save still writes per-card one at a time via existing machinery.
~5 hours.

**Phase 6 — One-save-to-many + groupthink rules.** Backend: single
save endpoint accepts `group_id` + propagate targets + single Actual
block, writes N bd cards atomically-per-card with error rollup.
Supersede-on-join runs at group creation / add-member (move each
member's prior Actual block to `superseded_by`). Fork-on-leave runs
at ungroup / dissolve (freeze group block into satellite, set
`forked_from_group`). Frontend: *Writes to* checklist (default-on,
uncheck = ungroup), save button label update, error dialog for
partial failures with per-member retry. ~6 hours. **This is the
phase that fixes the broken case.**

**Phase 7 — Intent at save.** Notify checkbox (Slack), add-to-
playbook checkbox. ~3 hours.

**Phase 8 — Contribution feedback.** Post-save toast (single + group
variants), row-state transformations, header counter, recalls-yet
counter on documented rows/groups. ~2 hours.

**Phase 9 — The reap loop.** Apply-history, authorship on recall
matches (group-aware), supersede flow, playbook promotion. ~8 hours.

Phases 1–6 get the broken case working. Phases 7–9 are the payoff
loop.

---

# Part X — What this replaces

- The current per-row modal → retired (replaced by single-mode sheet).
- The current group modal (from `grouping-spec.md` §UX) → retired
  (replaced by group-mode sheet; it becomes the canonical group
  surface).
- The current `drover:solution` skill's primary surface → retired on
  the UI side; the skill remains available as a CLI fallback but is
  no longer the blessed path.
- The standalone `Propagate to group?` post-save prompt in the
  earlier draft → retired. Propagation is now a default-on first-
  class control inside the sheet, not a trailing confirmation.

---

# Part XI — Open questions

- **Ungroup semantics during a group save.** If the operator clicks
  Ungroup mid-compose in group-mode, what happens to the half-written
  Capture content? Lean: confirm dismiss; if accepted, move the
  unfinished Capture content into a single-mode draft on the first
  member, operator continues there.
- **Rename vs. auto-name.** Group names autogenerate from exception
  class + msg shape. If the operator renames, does the autogeneration
  stop forever? Lean: yes. Rename is a commitment.
- **Playbook promotion threshold.** A group of 2 is not a pattern. At
  what member-count (and/or recall-count-since-creation) should the
  `Add to playbook` checkbox default to checked? Lean: 3 members OR
  2 recalls, whichever first.
- **Single-member group.** Can a group of 1 exist (e.g. after 4
  members are ungrouped)? Lean: no — the group auto-dissolves when
  it drops to 1 member. The remaining card forks on the way out,
  inheriting the group's last Actual block as its own.
- **Who gets the recall digest for group docs?** The original author
  of the group doc, not any subsequent editor. Editors get an "edited
  by you" secondary digest line.

---

# Part XII — Relationship to existing stories

- **§8 Document every resolved error** — this spec defines the
  Document flow the story describes, extended to cover groups.
- **§9 Recall** — recall lives at the top of the Capture column in
  both single- and group-mode. Group-mode recall queries by shared-
  fields only. Post-save recall surfaces group authorship + scope.
- **§12 Grouping** — the `[ Group & Document… ]` button on the
  bulk-action bar is the first-class entry point the grouping story
  has been waiting for. The group modal described in
  `grouping-spec.md` is superseded by this sheet.
- **§17 Advisor-agent** — the "have we seen this before?" top
  section is where the advisor's prefill lands. In group-mode the
  advisor operates on the shared-fields query.
- **§18 Implementer-agent opt-in** — the left-column `Agent notes`
  disclosure is where the Projected block renders when the optional
  implementer-agent has run. Not available in group-mode for now;
  the agent doesn't yet reason across groups.

---

# Part XIII — The core takeaway

**Each documented error is a letter to a future operator. Each
documented group is a letter about an entire class of errors.**

Drover's job is to make writing that letter easy, writing it well
easier still, and reading it later — when any similar error recurs,
on any project — automatic.

Every UX choice in the document flow should be tested against that
sentence. If a field, a button, an animation, or a layout decision
doesn't help the operator write a better letter, doesn't help a
future operator read it more effectively, or doesn't respect the
fact that one letter can be about many errors at once — it shouldn't
ship.
