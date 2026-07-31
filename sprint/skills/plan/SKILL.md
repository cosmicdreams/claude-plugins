---
name: plan
description: >
  Order a dependency-aware work queue and create the Beads cards for a sprint, proposing
  agent assignments. DECIDES only — it never starts agents; sprint:run executes. Not for
  mid-sprint re-prioritization.
allowed-tools: Bash, Read, Write
---

# Sprint Planning

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Prepare an ordered, dependency-aware work queue and create Beads cards before launching a team sprint. Use when the user wants to plan a sprint, prioritize issues, sequence work by dependencies, order the backlog, or propose agent assignments. Trigger phrases include "plan a sprint", "which issues should we work on", "sequence these issues", "prioritize the backlog", "order the backlog by dependencies", "what order should we tackle these". This skill ONLY plans and creates cards — it does NOT execute agents or start work. Use sprint:run to actually execute the sprint after planning. Do NOT use for mid-sprint re-prioritization, retrospective planning, or when the user asks to start/run/work on issues immediately.

Prepare an ordered work queue for the next team sprint.

## Input

A list of issue numbers (or a Jira query / backlog reference). If none provided, ask the user.

## Workflow

### 1. Check for Existing Analysis Reports

For each issue, check two sources:

1. **Beads board**: `bd list -l issue-{issue_number} --json` — if a card already exists for the issue, analysis may have already been done (check the card's lane and narrative)
2. **File report**: `./analysis-reports/{issue_number}.md` — legacy analysis output; read for complexity, effort estimate, and dependencies if present

- **Card or report found**: Extract complexity, effort estimate, and dependencies
- **Neither found**: Mark as `[NEEDS ANALYSIS]` — the slice-worker will analyze as its first phase

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

### 5. Assess Cross-Review Need

For each issue, recommend cross-review based on risk:

| Situation | Cross-review? |
|-----------|---------------|
| Single-file fix to well-tested code | `cross-review-no` |
| Multi-file changes | `cross-review-yes` |
| Unfamiliar module or complex logic | `cross-review-yes` |
| New test file added (no existing coverage) | `cross-review-yes` |
| Trivial config/comment change | `cross-review-no` |

## Output

Present a sprint plan table for team-lead approval:

```
## Proposed Sprint Plan

| # | Issue | Complexity | Status | Parallel? | Cross-review? |
|---|-------|------------|--------|-----------|---------------|
| 1 | #1234 | Simple     | Report ready | No (blocks #5678) | No |
| 2 | #5678 | Medium     | NEEDS ANALYSIS | After #1234 | Yes |
| 3 | #9012 | Simple     | Report ready | Yes (with #3456) | No |
...

## Notes
- #5678 cannot start until #1234 lands (shared file: ...)
- #9012 and #3456 can run in parallel
- Slice-workers needed: 3 (2 parallel + 1 after dependency)
```

Wait for team-lead approval before handing off to `sprint:run`.

## Card Creation

Once the plan is approved, cards are created in the Beads sprint database (`.beads/sprint.db`). Before creating cards, check whether cards already exist for each issue to avoid duplicates:

```bash
# Check for existing cards (skip creation if cards already exist for this issue)
bd list -l board-sprint -l issue-1234 --json
```

For each issue with no existing cards, create **one card** with the full phase checklist:

```bash
bd create "Issue #1234: <short-desc>" \
  --prefix sprint \
  -p 2 -t task \
  --labels "board-sprint,lane-backlog,issue-1234,cross-review-<yes|no>" \
  --description "$(cat <<'EOF'
## Phase Checklist
- [ ] Analyzed — root cause identified
- [ ] Implemented — fix written in worktree
- [ ] Tests written — failing test first, then passing
- [ ] phpcs/phpstan — clean
- [ ] phpunit — passing

## Issue
- d.o link: <url>
- Module: <module>

## What to change
- File: <path>
  - <specific change>

## What NOT to change
- <guardrail>

## Acceptance Criteria
- AC-1: Given <context>, When <action>, Then <result>
- AC-2: Given <context>, When <action>, Then <result>

## Narrative
- YYYY-MM-DD: Card created. (by @team-lead)
EOF
)"
```

Dependencies are between **issues** only (not between phases). Use `--deps` when issue B genuinely depends on issue A's code changes.

Set `-p 1` for high-priority issues. The `cross-review-yes` / `cross-review-no` label is set based on the risk assessment above.

## Card Body Standard

Every card created by `sprint:plan` should follow this schema in its `--description` body. This is a **convention** — there is no enforcement gate. Consistent card bodies make implementation unambiguous and retrospective analysis meaningful.

### Acceptance Criteria Format

ACs use numbered BDD Given/When/Then format:

- **Numbered**: AC-1, AC-2, AC-3 — enables precise pass/fail tracking in SUMMARY comments
- **BDD structure**: `Given <context>, When <action>, Then <result>` — removes interpretation ambiguity
- **Independently testable**: each AC can be verified on its own without depending on another AC passing first

### Generating ACs from a Card Description

When writing cards, derive ACs directly from the "What to change" section:
1. Each distinct behavior change becomes one AC
2. Each "What NOT to change" guardrail can become a negative AC (Then it does NOT...)
3. Aim for 2-5 ACs per card — fewer means the card may be underspecified, more means it should be split

## Key Points

- Raise scope concerns before the sprint runs, not mid-sprint
- With vertical slices, each slice-worker handles analysis as its first phase — unanalyzed issues are fine
