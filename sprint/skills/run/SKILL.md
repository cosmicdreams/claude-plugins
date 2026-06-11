---
name: run
description: >
  Executes a team sprint using the vertical slice model: one Workflow pipeline per sprint,
  one slice-worker agent per bead, optional cross-review stage.
  Use when the user wants to START EXECUTING work — beads are being worked,
  and the pipeline is actively running. Trigger phrases: "run a team sprint", "spin up
  agents", "work on these issues as a team", "team validate these patches", "start the sprint",
  "let's kick off the pipeline", "run these issues in parallel".
  Do NOT use for: deciding which issues to tackle or sequencing the backlog (use sprint:plan),
  reading board state only (sprint:board), or running a retrospective (retro:session).
  Key distinction from sprint:plan — sprint:run EXECUTES; sprint:plan DECIDES.
allowed-tools: Bash, Read, Write, Workflow
---

# Team Sprint

Orchestrate parallel issue work using the Workflow tool. One slice-worker per bead, end-to-end.
No team-lead loop. No SendMessage choreography.

Board state lives in `.beads/sprint.db`. Cards are Beads issues with status and lane labels.

## Card Structure

See `sprint:board` for lane definitions, card fields, and DDEV slot rules. Create cards with `bd create`:

```bash
bd create "Issue #2901667: jQuery removal in toggleEditMode" \
  --prefix sprint \
  -p 2 -t task \
  --labels "board-sprint,lane-backlog,issue-2901667,cross-review-yes" \
  --description "$(cat <<'EOF'
## Phase Checklist
- [ ] Analyzed — root cause identified
- [ ] Implemented — fix written in worktree
- [ ] Tests written — failing test first, then passing
- [ ] phpcs/phpstan — clean
- [ ] phpunit — passing

## Issue
- d.o link: https://www.drupal.org/project/drupal/issues/2901667
- Module: settings_tray

## What to change
- File: core/modules/settings_tray/js/settings_tray.js
  - Remove jQuery dependency from toggleEditMode function

## What NOT to change
- Do not modify the PHP side of Settings Tray

## Acceptance Criteria
- AC-1: Given the toggleEditMode function, When it is called, Then it uses native JS instead of jQuery
- AC-2: Given all existing tests, When phpunit runs, Then all tests pass

## Narrative
- YYYY-MM-DD: Card created.
EOF
)"
```

## Prerequisites

```bash
# Verify DDEV health
timeout 10 ddev list -A 2>/dev/null && echo "DDEV healthy" || echo "DDEV unhealthy -- static analysis only"

# Verify board has cards
bd ready -l board-sprint --json --unassigned
```

## Running the Sprint

Invoke the Workflow tool with the sprint-run script:

```javascript
Workflow({
  scriptPath: "sprint/skills/run/scripts/sprint-run.js",
  args: {
    sprint_name: "<sprint-name>",
    sprint_date: "<YYYY-MM-DD>",
  }
})
```

The script:
1. Reads all ready, unassigned beads from the sprint board
2. Launches one slice-worker agent per bead via `pipeline()`
3. Enforces a max of 3 concurrent DDEV-flagged beads (chunked batches for ddev-labeled beads; non-ddev beads run fully in parallel)
4. Runs cross-review as an adversarial verify stage for beads labeled `cross-review-yes`
5. Writes structured results to `analysis-reports/retro-session/<date>+<sprint>/results.json`

## Results

`results.json` contains all slice-worker and cross-reviewer structured output, including retro interview fields. Pass this to `retro:session` at sprint end.

## Cross-Review

The cross-review stage is an adversarial verify pass — a fresh-context agent re-runs quality gates and inspects for test theater, stubs, and correctness issues. It operates on the same pipeline with no barrier; beads not labeled `cross-review-yes` skip it.

Cross-review risk heuristics (set the label during planning):

| Situation | Cross-review? |
|-----------|---------------|
| Single-file fix to well-tested code | `cross-review-no` |
| Multi-file changes | `cross-review-yes` |
| Unfamiliar module or complex logic | `cross-review-yes` |
| New test file added (no existing coverage) | `cross-review-yes` |
| Trivial config/comment change | `cross-review-no` |

## Teams for Genuine Cross-Talk

Workflow is the default. Use `TeamCreate` only when slice-workers need to message *each other* mid-flight (rare). If workers only report results upward, Workflow is correct.

## After the Sprint

Check `results.json` for `outcome: "escalated"` entries — those beads defeated the slice-worker's three-fix limit. Spawn `sprint:deep-debugger` for each, with the bead id and the findings the worker appended to the card narrative. Failed outcomes go back to the board for replanning.

```bash
# View results
cat analysis-reports/retro-session/<date>+<sprint>/results.json | jq '.results[].outcome'

# Write release notes
sprint:project-notes

# Run retrospective
retro:session
```

## Quick Reference

| Action | Command |
|--------|---------|
| View board | `bd list --json` |
| Ready work | `bd ready -l board-sprint --json --unassigned` |
| Show blocked | `bd blocked` |
| DDEV slot count | `bd list --metadata-field ddev=true --json \| jq 'length'` |
| Init board | `bd init --prefix sprint` |
| Resume workflow | Re-invoke Workflow with `resumeFromRunId` |
