# Questions for Chris — midnight-burn session

A durable backlog of questions, decisions-in-flight, and things I might
have gotten wrong. Claude writes to the top of each section; Chris
answers inline or at his next check-in. Anything marked **BLOCKING**
means I've stopped work until Chris answers.

Last updated: 2026-04-24 (post-1.41.0 merge)

---

## BLOCKING (halts work)

*none*

---

## Design decisions I want confirmed (non-blocking)

### Q1 — Group sheet retires the centered group modal?
The vision doc says yes, and you approved it. I'm going to do it in
Slice B. If you'd rather keep the centered group modal as a secondary
entry for a simpler "just see members" view, tell me before I delete.

**My read: delete it.** One surface per flow.

### Q2 — Category picker taxonomy
I'm going with: `db-issue · permission · config · third-party · deployment · performance · security · other`. Open to additions / renames.
Stored as a single-select on the Actual block as `category`.

### Q3 — Tags storage shape
`tags: ["drupal-core", "mysql-8", "cron"]` on the Actual block. Free-form strings with a typeahead over past-used tags. Persisted per-save; no normalization.

### Q4 — Notify checkbox scope
For tonight: *Save & notify* posts a `notify-requested` pulse event; no actual Slack wiring. Later work plugs in the transport. OK?

### Q5 — Playbook checkbox scope
For tonight: *Save & add to playbook* writes a `playbook` field on the Actual block naming the category. No separate playbook data surface yet. Later work materializes playbooks as their own entity.

### Q6 — Parsed error UI
Drupal watchdog titles come in as `host | hook | url | class: message`. I'll parse into `{class, message, hook, url}` and render as four labeled fields in Understand. If you want the raw title preserved, I'll include it behind a "show raw" toggle.

### Q7 — One-click openers — which ones are in scope tonight?
Candidates: *Open approot in Finder* (easy), *Open file:line in PhpStorm* (jetbrains URL scheme), *Open Acquia logs* (requires env → org/site mapping — tricky), *git blame* (needs path + commit, tricky). Plan: ship Finder + PhpStorm tonight, punt Acquia + blame to follow-up.

---

## Vertical slices — remaining work, ordered

Ordered by demo-value per hour × low-risk. Est. times are honest.

| # | Slice | Est. | Notes |
|---|-------|------|-------|
| B | **Group sheet** — retire centered group modal, open group in the right-docked sheet with aggregate Understand + group Capture. Biggest single visual upgrade. | 3h | Retires `openGroupModal` + `openGroupDocumentForm` for new-entry paths; keeps the helpers that compute members/aggregates. |
| A | **Bulk bar CTAs** — rename *Group selected* → *Group & Document…* (primary), add *Group* (secondary) and *Mark as noise* (tertiary). Keyboard: Space toggles selection. | 1h | Selection already exists; this is CTA relabeling + wiring. |
| C | **Parsed error in Understand** — split watchdog pipe soup into labeled fields: Class, Message, Hook, URL. Keep raw behind a toggle. | 1.5h | Pure display; no data schema change. |
| F | **Open approot + Open in PhpStorm** — two buttons in Understand. | 1h | URL scheme for PhpStorm; `open` CLI for approot. Requires `approot` on the card — already captured? Investigate. |
| D | **Category picker** — 8-option dropdown in Capture; writes `category` on Actual. Template hints below the root-cause textarea driven by category. | 1.5h | New field on Actual block. Backwards-compatible (absent = untagged). |
| E | **Tags + Links** — tags multiselect over past-used strings; links as structured slots (`kind` + `url`). | 1.5h | New Actual fields. |
| G | **Save & notify / Save & add to playbook** — checkboxes at save; both fire pulse events + write metadata. No transport wiring tonight. | 1h | |
| H | **Scratch notes in Understand** — localStorage-keyed per card id, auto-cleared on save. | 45m | |

**Expected arc:** tonight covers B + A + C + F. D + E + G + H are stretch.

---

## Open technical questions (I'll answer these myself or ask when stuck)

### OT1 — Where does `approot` come from for a card?
Need to check if the card body captures the project's approot. If not,
the *Open approot* button uses the project's registered path from
`projects.json`. Not blocking; I'll investigate when Slice F starts.

### OT2 — Does PhpStorm URL scheme work when the repo isn't the current project?
The `phpstorm://open?file=<path>&line=<N>` scheme opens in whatever
instance is running. Fine.

### OT3 — Template hints text bank
Category-specific hints need short drafts. I'll write them in Slice D
and let you edit after.

### OT4 — Group-sheet Understand column for large groups
If a group has 20 members, the members list gets long. Plan: virtualize
only if >10; otherwise full list with drill-in chevrons. Acceptable
edge case; no special handling tonight.

---

## Things I've noticed that aren't in scope but worth naming

### N1 — The centered group modal's "dissolve" red button gets an
inconsistent treatment compared to other destructive actions elsewhere
in the UI. Worth a pass after the sheet rework.

### N2 — `lane-done` and similar literals are stringly-typed throughout
the server. A named-constant refactor later would help; not tonight.

### N3 — The `buildActualForm` helper and the new group Document form's
`field()` inner helper are near-duplicates. I kept them separate because
they live in different surfaces with different save wiring; but the
`field()` shape alone could factor to a shared `solutionField` helper.
~30 min refactor; noted for a lull.

### N4 — Pulse events use string types (`group-documented`, `group-
created`, `error-documented`). Not yet a named union. If the pulse
feed surface grows, types should centralize.

---

## Session log

### 2026-04-24 00:xx — Post-merge of 1.41.0

- Shipped B (Phase 6), Phase 9, Phase 1, plus the shared-helper refactor.
- About to start Slice B (group sheet).
- No blockers.

### 2026-04-24 03:xx — Midnight burn results

Six slices shipped after the 1.41.0 merge, in this order:

1. **Slice B — Group sheet (1.42.0).** Retires the centered group modal. Click a group row → right-docked sheet, Understand (Details · Shared-across-members with (N of M match) badges · Members list with drill-in) + Capture (recall seeded with first member · Writes-to checklist · fields). ~227 lines of dead code removed.
2. **Slice A — Bulk-bar CTAs (1.43.0).** Primary *Group & Document…* button (swaps to *Document…* at N=1, grouping before opening). Secondary *Group* (no sheet). Tertiary *Mark as noise* with serial POST fanout. Right-aligned *Clear*. Space on focused row toggles selection; Enter still opens.
3. **Slice C — Parsed error view (1.44.0).** Structured fields in Understand — Class, Message, Hook, URL — with raw title behind *▸ Show raw title*. `parseWatchdogTitle` handles the ` · `-separated format.
4. **Slice F — One-click openers (1.45.0).** *Open approot* + *Open in PhpStorm* buttons. Server endpoints gate against registered projects only; file paths must live inside the approot.
5. **Slice D — Category picker + hints (1.46.0).** Select with the Q2 taxonomy; selecting surfaces a scaffolding hint below. Extends the Actual block with `category`.
6. **Slice E + H — Tags + Scratch notes (1.47.0).** Comma-separated tags on both forms, stored on the Actual block. Scratch notes in Understand (dashed border, italic, localStorage-keyed, auto-cleared on save).

Dropped from tonight's scope (deferred to post-demo):
- **Links** — needs a proper structured input, not `kind:url` per line.
- **Notify / Add-to-playbook checkboxes** — without real Slack transport and a playbook data surface, they'd be stub-theater.
- **Typeahead over past-used tags** — Slice E's next step.

No blockers encountered. All smoke-tested end-to-end where a real bd write didn't risk user data.

<!-- Append new sections at the top of `Design decisions` / `Open
technical questions` as they arise; keep this log append-only. -->
