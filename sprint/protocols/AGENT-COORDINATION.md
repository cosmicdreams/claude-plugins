# Agent Coordination Protocol

Standard task coordination behavior for all agents participating in team sprints.
This protocol keeps team-lead's TaskList accurate as the source of truth.

## Required Setup

All team sprint agents must set `BD_ACTOR` before any `bd` call:
```bash
export BD_ACTOR=<your-agent-name>
```

Board database: `.beads/sprint.db` (use `--db .beads/sprint.db` flag on all bd commands).

All team sprint agents must have these tools in their frontmatter:
```
SendMessage, TaskUpdate, TaskList, TaskGet
```

Team-lead additionally needs: `TaskCreate`

## On Task Start

```
1. TaskUpdate(taskId, status: in_progress, owner: "your-agent-name")
2. Claim the board card: BD_ACTOR=<your-name> bd --db .beads/sprint.db update <card-id> --claim --add-label lane-<your-lane>
3. Begin work immediately
```

Claim before starting. Do not start work on an unclaimed task or unclaimed board card.

## On Task Complete

```
1. Transition the board card:
   - If passing to next lane: bd --db .beads/sprint.db update <id> --status open --assignee "" --remove-label lane-<current> --add-label lane-<next>
   - If done: bd --db .beads/sprint.db close <id> --reason "Review passed."
2. Append narrative: bd --db .beads/sprint.db update <id> --append-notes "YYYY-MM-DD: <summary> (by @your-name)"
3. TaskUpdate(taskId, status: completed)
4. SendMessage(type: message, recipient: "team-lead", content: "[your completion summary]")
5. TaskList → check for next assigned task
6. If no next task: SendMessage(team-lead, "your-agent-name available | no pending tasks")
```

Always update the board card and task BEFORE messaging team-lead. The task state is ground truth.

## If Blocked

```
SendMessage(type: message, recipient: "team-lead", content: "Blocked #[task]: [reason] | need: [what]")
```

Do this immediately — do not wait, do not try to work around it silently.

## Never

- Skip `TaskUpdate` — it is how team-lead detects your state without polling
- Go idle without sending a completion or availability message
- Wait for team-lead to ask if you're done — report proactively
- Send a status update without also updating the task

## Why This Matters

Team-lead uses `TaskList` as its source of truth for who has work. If you skip `TaskUpdate`,
team-lead sees your task as still `in_progress` and will not assign you new work. You will
appear busy when you are idle. This is the root cause of the idle-agent problem.

The message to team-lead triggers assignment of your next task. Without it, team-lead
does not know you are available — even if it has work ready for you.

## Completion Message Formats by Role

| Role | Format |
|------|--------|
| issue-analyzer | `📝 #[iss] ana done \| rpt: [path] \| complexity: [level] \| effort: [est]` |
| implementer | `✅ #[iss] impl done \| phpcs: [ok\|nok] \| phpunit: [ok\|nok] \| wrk: [path]` |
| reviewer (pass) | `review pass \| #[iss] \| phpcs: ok \| phpstan: ok \| phpunit: ok` |
| reviewer (fail) | `review fail \| #[iss] \| [gate]: [N errors] \| [file:line]` |
| process-improvement | `✅ [improvement] \| [what changed] \| [expected impact]` |
| any agent available | `[agent-name] available \| no pending tasks` |

## Cross-Agent Standards

### File Reference Format

Always cite code locations as `file_path:line_number`. Never cite a file without a line number
when referring to a specific finding.

### Agent Reference Format

When recommending another agent's involvement, use `@agent-name`:
```
Consider consulting @code-quality-pragmatist before finalizing this approach.
```

Only recommend agents when genuinely warranted — not as a reflexive sign-off.

### Severity Levels

| Level | Meaning |
|---|---|
| Critical | Blocks submission; must fix before proceeding |
| High | Significant impact; should fix in current sprint |
| Medium | Notable issue; address in follow-up |
| Low | Minor; optional improvement |

### Findings Handoff Format

When passing findings to another agent via SendMessage:
```
Issue: [description]
File: [file_path:line_number]
Severity: [Critical|High|Medium|Low]
Action needed: [what the receiving agent should do]
```

### Tool Capabilities by Role

| Agent Type | Can Edit/Write | Can Run Bash | Examples |
|---|---|---|---|
| Analyst (read-only) | No | No | architect |
| Validator | No | Yes | reviewer, claude-md-compliance-checker |
| Reviewer | Yes | Yes | reality-checker, code-quality-pragmatist |
| Developer | Yes | Yes | implementer, fixer, advisor, issue-analyzer |
| Strategist | Yes | Yes | process-improvement, issue-planner |
| Specialist | Yes | Yes | deep-debugger (opus), ui-comprehensive-tester |

### Common Collaboration Chains

For comprehensive review of a complex implementation:
```
1. @reality-checker — does it match the spec, actually work?
2. @code-quality-pragmatist — is it unnecessarily complex?
3. @claude-md-compliance-checker — does it follow project rules?
```

Use the full chain only for high-stakes changes. Use individual agents for targeted reviews.

### When NOT to Recommend Another Agent

- You can fix it yourself → fix it
- The finding is out of scope → note in output, don't spawn a chain
- Issue is already tracked on the board → update the card via `bd update`, don't message

## Reference

- Board database: `bd --db .beads/sprint.db`
- Team comms format: `.claude/team-comms-protocol.md`
- Team-lead decision rules: `.claude/skills/sprint-run/references/decision-framework.md`
- Sprint protocol: `.claude/skills/sprint-run/SKILL.md`
