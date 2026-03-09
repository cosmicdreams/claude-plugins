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
bd create "Issue #1234: analyze <short-desc>" \
  --prefix sprint \
  -p 2 -t task \
  --labels "board-sprint,lane-backlog,stage-analyze,issue-1234" \
  --acceptance "<criteria from plan>"

bd create "Issue #1234: implement <short-desc>" \
  --prefix sprint \
  -p 2 -t task \
  --labels "board-sprint,lane-backlog,stage-develop,issue-1234" \
  --deps "sprint-XXXX" \
  --acceptance "<criteria from plan>"

bd create "Issue #1234: validate <short-desc>" \
  --prefix sprint \
  -p 2 -t task \
  --labels "board-sprint,lane-backlog,stage-validate,issue-1234,review-DYNAMIC_FULL" \
  --deps "sprint-YYYY" \
  --acceptance "<criteria from plan>"
```

Replace `sprint-XXXX`/`sprint-YYYY` with the actual IDs returned by prior `bd create` commands. Set `-p 1` for high-priority issues.

## Card Body Standard

Every card created by `sprint:plan` should follow this schema in its `--description` body. This is a **convention** — there is no enforcement gate. Consistent card bodies make implementation unambiguous and retrospective analysis meaningful.

### Card Body Schema

```
## What to change
- File: <path relative to plugin root>
  - <specific change description>
  - <another change in the same file>
- File: <another path>
  - <change description>

## What NOT to change
- <guardrail: files or behaviors explicitly out of scope>

## Acceptance Criteria
- AC-1: Given <precondition>, When <action>, Then <expected outcome>
- AC-2: Given <precondition>, When <action>, Then <expected outcome>
- AC-3: Given <precondition>, When <action>, Then <expected outcome>
```

### Acceptance Criteria Format

ACs use numbered BDD Given/When/Then format:

- **Numbered**: AC-1, AC-2, AC-3 — enables precise pass/fail tracking in SUMMARY comments
- **BDD structure**: `Given <context>, When <action>, Then <result>` — removes interpretation ambiguity
- **Independently testable**: each AC can be verified on its own without depending on another AC passing first

### Example

For a card titled "Add retry logic to API client":

```
## Acceptance Criteria
- AC-1: Given the API returns a 5xx error, When the client sends a request, Then it retries up to 3 times with exponential backoff
- AC-2: Given all retries are exhausted, When the final attempt fails, Then the client raises a RetryExhaustedError with the last response attached
- AC-3: Given the API returns a 4xx error, When the client sends a request, Then it does NOT retry and raises immediately
```

### Generating ACs from a Card Description

When writing cards, derive ACs directly from the "What to change" section:
1. Each distinct behavior change becomes one AC
2. Each "What NOT to change" guardrail can become a negative AC (Then it does NOT...)
3. Aim for 2-5 ACs per card — fewer means the card may be underspecified, more means it should be split

## Key Points

- Never assume an issue is ready to implement without a report
- Raise scope concerns before agents spin up, not mid-sprint
- If the queue has more than 5 unanalyzed issues, recommend running analysis first as a pre-sprint pass
