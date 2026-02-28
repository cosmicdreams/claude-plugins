# Agent Coordination Protocol

Standard task coordination behavior for all agents participating in team sprints.
This protocol keeps team-lead's TaskList accurate as the source of truth.

## Required Tools

All team sprint agents must have these tools in their frontmatter:
```
SendMessage, TaskUpdate, TaskList, TaskGet
```

Team-lead additionally needs: `TaskCreate`

## On Task Start

```
1. TaskUpdate(taskId, status: in_progress, owner: "your-agent-name")
2. Begin work immediately
```

Claim before starting. Do not start work on an unclaimed task.

## On Task Complete

```
1. TaskUpdate(taskId, status: completed)
2. SendMessage(type: message, recipient: "team-lead", content: "[your completion summary]")
3. TaskList → check for next assigned task
4. If no next task: SendMessage(team-lead, "your-agent-name available | no pending tasks")
```

Always update the task BEFORE messaging team-lead. The task state is ground truth.

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

## Reference

- Team comms format: `.claude/team-comms-protocol.md`
- Team-lead decision rules: `.claude/skills/sprint-run/references/decision-framework.md`
- Sprint protocol: `.claude/skills/sprint-run/SKILL.md`
