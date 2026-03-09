---
name: plan
description: Prepare an ordered, dependency-aware work queue before launching a team sprint. Use when the user wants to plan a sprint, prioritize issues, sequence work by dependencies, or propose agent assignments. Trigger phrases include "plan a sprint", "which issues should we work on", "sequence these issues", "prioritize the backlog", "what order should we tackle these". Always invoke this before sprint:run when issues need analysis or ordering. Do NOT use for mid-sprint re-prioritization or retrospective planning -- those are separate concerns.
---

# Sprint Planning

Prepare an ordered work queue for the next team sprint. Run this before `sprint:run` to avoid discovering mid-sprint that issues are unanalyzed or misordered.

## Input

A list of issue numbers (or a Jira query / backlog reference). If none provided, ask the user.

## Workflow

### 1. Check for Existing Analysis Reports

For each issue, check `./analysis-reports/{issue_number}.md`:
- **Found**: Read complexity, effort estimate, and dependencies
- **Not found**: Mark as `[NEEDS ANALYSIS]` — these must be analyzed before implementation can start

### 2. Assess Complexity

If analysis reports exist, extract:
- Complexity level (Simple / Medium / Complex)
- Files affected
- Known blockers or dependencies on other issues
- Whether tests exist and need updating

### 3. Identify Dependencies

Look for issues where:
- One fix affects files another issue also touches
- An issue explicitly depends on a prior fix (noted in analysis report)
- Ordering could cause merge conflicts in the same worktree

### 4. Sequence the Queue

Order issues by:
1. **Dependency order first**: issues that unblock others go earlier
2. **Simpler before complex**: build momentum, de-risk blockers early
3. **Unrelated issues in parallel**: flag which ones can run simultaneously

### 5. Propose Agent Assignments

Map each issue to the agent roles that will handle it:

| Phase | Agent | When |
|---|---|---|
| Analysis (if needed) | `issue-analyzer` | Before implementation |
| Implementation | `implementer` | After analysis report exists |
| Validation | `reviewer` | After implementer marks done |

Note which issues can run in parallel and which must be sequential.

## Output

Present a sprint plan table for team-lead approval:

```
## Proposed Sprint Plan

| # | Issue | Complexity | Status | Parallel? | Assignee |
|---|-------|------------|--------|-----------|----------|
| 1 | #1234 | Simple     | Report ready | No (blocks #5678) | implementer |
| 2 | #5678 | Medium     | NEEDS ANALYSIS | After #1234 | issue-analyzer → implementer |
| 3 | #9012 | Simple     | Report ready | Yes (with #3456) | implementer |
...

## Notes
- #5678 cannot start until #1234 lands (shared file: ...)
- #9012 and #3456 can run in parallel
- Estimated issues per agent: implementer×3, reviewer×3
```

Wait for team-lead approval before handing off to `sprint:run`.

## Card Creation

Once the plan is approved, cards are created in the Beads sprint database (`.beads/sprint.db`). For each issue, create one card per pipeline stage with blocking dependencies using `bd create`:

```bash
# Initialize board if not already done
bd init --prefix sprint

# For each issue in the plan:
bd --db .beads/sprint.db create "Issue #1234: analyze <short-desc>" \
  -p 2 -t task \
  --labels "lane-backlog,stage-analyze,issue-1234" \
  --acceptance "<criteria from plan>"

bd --db .beads/sprint.db create "Issue #1234: implement <short-desc>" \
  -p 2 -t task \
  --labels "lane-backlog,stage-develop,issue-1234" \
  --deps "sprint-XXXX" \
  --acceptance "<criteria from plan>"

bd --db .beads/sprint.db create "Issue #1234: validate <short-desc>" \
  -p 2 -t task \
  --labels "lane-backlog,stage-validate,issue-1234,review-DYNAMIC_FULL" \
  --deps "sprint-YYYY" \
  --acceptance "<criteria from plan>"
```

Replace `sprint-XXXX`/`sprint-YYYY` with the actual IDs returned by prior `bd create` commands. Set `-p 1` for high-priority issues.

## Key Points

- Never assume an issue is ready to implement without a report
- Raise scope concerns before agents spin up, not mid-sprint
- If the queue has more than 5 unanalyzed issues, recommend running analysis first as a pre-sprint pass
