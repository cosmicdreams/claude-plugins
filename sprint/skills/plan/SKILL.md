---
name: plan
description: Use when asked to plan a sprint, decide which issues to tackle next, sequence work by dependencies, or propose agent assignments before spinning up a team. Invoke before sprint:run when the issue list needs prioritization. Trigger phrases: "plan a sprint", "which issues should we work", "sequence these issues".
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

## Key Points

- Never assume an issue is ready to implement without a report
- Raise scope concerns before agents spin up, not mid-sprint
- If the queue has more than 5 unanalyzed issues, recommend running analysis first as a pre-sprint pass
