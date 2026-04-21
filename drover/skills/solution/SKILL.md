---
name: solution
description: >
  Capture the verified solution for a drover ticket. Prompts the user for root cause,
  fix summary, and commit SHA, writes a structured ## Solution > ### Actual block to
  the ticket, and closes it. Use when you've fixed a drover error (with or without
  drover:implementer running) and want that knowledge preserved for future recall.
triggers:
  - "drover:solution"
  - "capture drover solution"
  - "record drover fix"
  - "solved drover-"
  - "I fixed drover-"
allowed-tools: Bash, Read, AskUserQuestion
---

# drover:solution — Capture verified Actual solution

Writes a structured `## Solution > ### Actual` block to a drover ticket per the schema
in ADR `2026-04-21-drover-solution-capture-schema.md`. This is the **manual capture
path**: works whether or not drover:implementer ran. Use when you've fixed an error
yourself and want drover to remember how.

## Usage

```
/drover:solution <ticket-id>
```

Example: `/drover:solution drover-a1f`

## Step 1: Pre-flight

```bash
[ -f .claude/drover-config.json ] || { echo "No drover config. Run /drover:setup first."; exit 1; }
[ -f .beads/drover.db ] || { echo "No drover board at .beads/drover.db"; exit 1; }
```

If `<ticket-id>` is missing, prompt the user for it. Accept both `drover-xxx`
and plain `xxx` forms.

## Step 2: Read the ticket

```bash
export BD_DB=.beads/drover.db
bd show {TICKET_ID} --format markdown
```

Display the current ticket body. Extract:
- Fingerprint (from title or notes)
- Error message
- Existing Projected block (if implementer already wrote one)

If a `### Projected` block exists, show it to the user verbatim — they may want to
use its contents as a starting point for the Actual block, or override it if the
projected hypothesis was wrong.

## Step 3: Prompt for Actual fields

Ask the user for each field. Do NOT guess or fabricate. If the user gives brief
answers, write them verbatim; don't embellish.

Use AskUserQuestion (one question at a time, don't batch):

1. **root_cause** — what was the problem actually? (one or two sentences, general
   audience — no project-specific paths or customer identifiers)
2. **fix_summary** — what did you change to fix it? (one or two sentences)
3. **fix_commit_sha** — the commit SHA of the authoritative fix. Prompt for
   `git log --oneline -5` output if unsure. Accept "none" if the fix was configuration-only.
4. **divergence** — did the Projected block match reality?
   - `none` — projected was right
   - `minor` — projected was directionally correct, minor tweaks to root cause or fix
   - `major` — projected hypothesis was wrong; real fix is substantially different
   - Only ask if a Projected block exists.
5. **divergence_note** — one sentence on what was different. Only ask when divergence is minor|major.

## Step 4: Write the Actual block

```bash
export BD_DB=.beads/drover.db
export BD_ACTOR=user-solution-capture

bd update {TICKET_ID} --append-notes "
### Actual  (written: {ISO_NOW}, by: user)
- **root_cause:** {root_cause}
- **fix_summary:** {fix_summary}
- **fix_commit_sha:** {fix_commit_sha_or_'none'}
- **divergence:** {none|minor|major|'n/a no Projected block'}
- **divergence_note:** {divergence_note_or_omit}
- **effectiveness:** verified
- **verified_at:** {ISO_NOW}
- **captured_by:** user
- **evidence:** commit:{fix_commit_sha}
"
```

If no Projected block existed, omit the `divergence` and `divergence_note` lines.

## Step 5: Close the ticket

```bash
export BD_DB=.beads/drover.db
export BD_ACTOR=user-solution-capture
bd update {TICKET_ID} \
  --remove-label lane-triage,lane-ready,lane-implementing,lane-awaiting-review \
  --add-label lane-done \
  --status closed \
  --append-notes "{ISO_NOW}: Solution captured and verified by user. Closed."
```

## Step 6: Confirm to user

Print a short confirmation:

```
Solution captured for {TICKET_ID} ({fingerprint}).
Effectiveness: verified. Ticket closed, lane-done.
Searchable via /drover:recall "{first 5 words of root_cause}".
```

## Notes

- **Don't fabricate.** If the user doesn't know something, write "unknown" rather
  than a plausible-sounding guess. Recall quality depends on Actual blocks being
  trustworthy.
- **Scope.** This skill is the manual capture path. Automated capture via commit
  trailers (`Fixes: drover-xxx`) and Jira comment mining are separate skills
  scheduled post-demo.
- **ADR reference:** `2026-04-21-drover-solution-capture-schema.md`
