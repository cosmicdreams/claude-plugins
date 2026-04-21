---
name: verify
description: >
  One-click promotion of a drover ticket's Projected solution to Actual. Use when
  the implementer agent's projected fix was correct and you want to confirm it
  without retyping the fields. Copies Projected fields into Actual with
  divergence=none, effectiveness=verified, captured_by=user.
triggers:
  - "drover:verify"
  - "confirm drover fix"
  - "projected was right"
  - "verify drover-"
allowed-tools: Bash, Read
---

# drover:verify — Promote Projected to Actual

Lightweight verification skill for the common case: drover:implementer wrote a
Projected block, the fix worked as hypothesized, and you want to mark it verified
without walking the full `/drover:solution` prompt flow.

For fixes that **diverge** from the Projected hypothesis, use `/drover:solution`
instead — it lets you record a root_cause that differs from the hypothesis.

## Usage

```
/drover:verify <ticket-id>
```

## Step 1: Pre-flight and read

```bash
[ -f .beads/drover.db ] || { echo "No drover board at .beads/drover.db"; exit 1; }
export BD_DB=.beads/drover.db
bd show {TICKET_ID} --format markdown
```

If the ticket has no `### Projected` block, abort with a message suggesting
`/drover:solution <ticket-id>` instead.

## Step 2: Extract Projected fields

Parse the Projected block and extract:
- `hypothesis` → becomes Actual's `root_cause`
- `proposed_fix` → becomes Actual's `fix_summary`
- `fix_commit_sha` → carries over verbatim

## Step 3: Write Actual block

```bash
export BD_DB=.beads/drover.db
export BD_ACTOR=user-verify

bd update {TICKET_ID} --append-notes "
### Actual  (written: {ISO_NOW}, by: user)
- **root_cause:** {hypothesis}
- **fix_summary:** {proposed_fix}
- **fix_commit_sha:** {fix_commit_sha}
- **divergence:** none
- **effectiveness:** verified
- **verified_at:** {ISO_NOW}
- **captured_by:** user
- **evidence:** promoted from Projected block; implementer hypothesis was correct.
"
```

## Step 4: Close the ticket

```bash
export BD_DB=.beads/drover.db
export BD_ACTOR=user-verify
bd update {TICKET_ID} \
  --remove-label lane-awaiting-review,lane-ready,lane-implementing \
  --add-label lane-done \
  --status closed \
  --append-notes "{ISO_NOW}: Projected → Actual (verified by user). Closed."
```

## Step 5: Confirm

```
Verified {TICKET_ID}: Projected promoted to Actual.
Effectiveness: verified. Ticket closed, lane-done.
```

## Notes

- If the fix needed corrections vs the Projected hypothesis, **don't** use this skill
  — use `/drover:solution <ticket-id>` and record the real root_cause with
  `divergence: minor|major`. That's how drover learns when the implementer was wrong.
- ADR reference: `2026-04-21-drover-solution-capture-schema.md`.
