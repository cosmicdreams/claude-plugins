# Drover — Cross-Project Error Grouping Spec

Companion to `user-stories.md` §12–§13. This document describes the
full shape of user-curated cross-project error grouping: what it is,
how the UX works, how the data is persisted, and what remains to be
built.

---

## Why

Drover fingerprints errors to collapse duplicates into one ticket.
That works *within* a project. It breaks down across projects: the
same Drupal `DatabaseExceptionWrapper` on pncb.prod and on ahri.prod
typically produces two distinct fingerprints (because their URLs or
line numbers differ), which means two tickets that drover can't see as
related.

Fingerprinting is a heuristic; no fingerprint scheme will be perfect.
So rather than tune the fingerprint harder, we let the operator
commit: "these tickets are the same bug." Drover records that
commitment, treats the group as one thing for triage, and — for §17 —
lets an advisor-agent suggest similar candidates to add.

---

## Data model

### Canonical membership

Groups are stored in a single JSON file per drover installation:

```
$CLAUDE_PLUGIN_DATA/drover-groups.json
```

Shape:

```json
{
  "groups": [
    {
      "id": "grp-abc123",
      "name": "DatabaseExceptionWrapper · syntax error",
      "member_ids": [
        { "project": "pncb-main", "card_id": "sprint-abc" },
        { "project": "ahri-main", "card_id": "sprint-xyz" }
      ],
      "created_at": "2026-04-23T22:15:00Z",
      "rejected_pairs": []
    }
  ]
}
```

**Natural key:** `{project, card_id}` tuples. Bd prefixes are
per-database; `sprint-abc` is not unique across projects. The tuple
is.

### Bd-native membership

On group create, drover writes a `group-<grpId>` label onto every
member card in **its own project's** `.beads/drover.db` via
`bd update --add-label`. On dissolve, the label is removed via
`--remove-label`.

**Why both.** The JSON file holds cross-project metadata (the group
name, created_at, rejections). The bd labels make the grouping visible
to every bd consumer — the triage agent, `drover:recall`, `bd list`,
any future agent — without them needing to know the dashboard's JSON
exists. `bd list -l group-grp-abc --db <project>/.beads` returns the
members in that project.

### Write ordering

Bd labels land **before** the JSON write:

1. Build the group object + id.
2. Try to write `group-<grpId>` onto every member card via `bd update`.
3. On any failure, reverse the additions (`--remove-label`) and
   surface the error. Drop the group — don't write the JSON.
4. On success, append the group to the JSON and atomically write the
   file.
5. If the JSON write fails at this stage, reverse the labels. Drover
   never ends up in a state where on-disk says a group exists but bd
   says no.

Dissolve reverses: remove labels first, then remove from JSON. Partial
label-removal failures surface in the response as `label_errors` but
the group is still removed from JSON — an orphan label is strictly
less harmful than an orphan group record.

---

## UX

### Row selection

Every row in the error table has a leading checkbox. `stopPropagation`
on the checkbox so clicking it never opens the row modal. A header
`select-all` toggles every currently-visible row; its state is
`indeterminate` when the selection is partial.

### Bulk action bar

When selection count ≥ 1, a bar slides in above the table:

```
  N selected · [ Group selected ] · [ Clear ]
```

`Group selected` is disabled until N ≥ 2.

### Parent-row render

Grouped cards fold into one synthesized parent row, client-side:

- **Sev:** worst severity of any member.
- **Last seen:** max `lastSeenTs` across members.
- **Count:** sum of `occ` across members.
- **Lane:** most-advanced lane of any member (by `LANE_ORDER`
  position).
- **Project:** `Object.keys(projectSet).sort().join(' · ')` — e.g.
  `pncb · ahri`.
- **Envs:** union of members' `envs` (feeds the Env facet).
- **Error cell:** group name as the chip + `N errors · <projects>`.
- **Action cell:** no row-level `Document` button; groups open the
  group modal on row click.

The leftmost select column shows a `⊞` glyph (not a checkbox — a group
of a group is out of scope).

### Group modal

Click a group row → modal with:

- **Header:** `Group · <name>`.
- **Details:** member count, projects, total occurrences, first seen,
  last seen.
- **Members:** a list where each member shows `[SEV] [project] title
  fp:...` and is clickable — clicking opens the individual ticket's
  modal.
- **Actions:** `Dissolve group` (destructive, confirms via
  `window.confirm`).

### Ungrouping

From the group modal, `Dissolve group` deletes the group record and
pulls the `group-<id>` labels from all member cards. Members return to
their own rows in the table.

---

## Advisor — suggestion engine (planned)

When a group is created, drover should scan the remaining (ungrouped)
cards and propose similar candidates the operator might want to add.
Signals, each weighted, combined into a confidence score:

| Signal | Weight | Rationale |
|---|---|---|
| Exception class exact match | 0.35 | Strongest single signal |
| Message similarity (URL/ID-stripped, Levenshtein) | 0.25 | Catches "Failed to load %s" repeats |
| First stack frame (file + function) match | 0.20 | Localises the bug's origin |
| Source match (watchdog / apache-error / ...) | 0.10 | Different sources = different bug classes |
| Temporal co-occurrence (within 60s) | 0.10 | Often indicates a shared external trigger |

Tiers:

- **High** (≥ 0.75): "Almost certainly the same bug." Pre-checked;
  `Accept all high-confidence` button accepts in bulk.
- **Medium** (0.5–0.75): "Probably related." Unchecked; per-row
  review.
- **Low** (0.3–0.5): "Maybe worth a look." Collapsed by default.
- Below 0.3: not shown.

### Rejection-aware learning

Each per-suggestion reject records `{group_id, rejected_card_id,
ts}` in a `rejected_pairs` list. Drover never re-suggests a rejected
pair for the same group.

**Open design question:** whether rejections are group-scoped (as
above) or globally scoped (rejecting pncb.abc ≈ ahri.xyz once means
never suggesting that pair for any group). Leaning toward global for
the next design pass.

### Scope boundary

The advisor never commits to grouping. It always proposes; the
operator always decides. "The system simply will not have the access
it needs to perform the fix according to our developmental standards"
(from the rescoping conversation) applies one level up: drover won't
even auto-group, let alone auto-fix.

**Status:** 📋 Planned. `/api/recall` (a related endpoint) exists as
of 1.39.1; the suggestion-on-group-creation surface does not yet.

---

## Solution propagation (planned)

When an operator documents (§8) any member of a group, drover should
offer:

> "Also apply this documentation to the other 3 group members?"

`Yes` writes the same Actual block to each sibling's bd card. `No`
leaves siblings as-is (the operator will handle them individually).

**Open design question:** the prompt's default. For a high-confidence
group, default-yes is probably right. For a low-confidence or
mixed-state group, default-no. The advisor's confidence on the group's
creation could inform this — another reason to persist per-group
confidence metadata, not just the members.

**Status:** 📋 Planned.

---

## Testing

A group acceptance test (referenced in user-stories §12 acceptance
criteria) should exercise:

1. Seed the same fingerprint into two registered projects' bd
   databases via the existing `__test_event` endpoint.
2. Open the dashboard, select both rows, click `Group selected`.
3. Assert: parent row appears; child rows don't.
4. Assert: `bd list -l group-<grp-id> --db <project>/.beads` returns
   the member in each project's database.
5. Assert: Lane facet filter on `triage` still includes the group row.
6. Click `Dissolve`, confirm.
7. Assert: parent row is gone, children return, labels removed from
   bd, group absent from the JSON file.

Implementation target: `drover/tests/bats/grouping.bats` + a Playwright
spec for the UI flow. Neither is written yet.
