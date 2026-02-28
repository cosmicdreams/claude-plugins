# Team Sprint — Project CLAUDE.md Snippet

Paste the section below into a project's `CLAUDE.md` to enable team-lead mode for that project. Adjust plugin paths and agent types if your project uses a custom agent set.

---

```markdown
## Team Sprint Mode

When asked to run a team sprint, coordinate multiple agents, or work on issues in parallel:
**YOU are the team-lead. Do not spawn a separate team-lead agent.**

### Every Turn

1. `TaskList` — who has no `in_progress` task right now?
2. Scan `kanban/sprint-run/` for unblocked cards with no assignee
3. Match idle agents to available cards → `SendMessage` with task immediately
4. If an agent's stage has no remaining cards → run Graceful Shutdown Sequence (see below)
5. If an agent is unresponsive 2+ turns → reassign or replace

**You push work. You do not collect reports and wait.**

### Spawning Agents

Agents are spawned with the Task tool. Multiple Task tool calls in the same message run in parallel:

```
Task(subagent_type="drupal-lab:implementer", name="implementer-1", prompt="...")
Task(subagent_type="drupal-lab:implementer", name="implementer-2", prompt="...")
```

If N issues are ready to implement with no file conflicts, spawn N implementers at once.
Do not spawn one and wait for it to finish before spawning the next.

Full spawning mechanics (instance naming, prompt template, sizing guide):
`~/.claude/plugins/cache/local/sprint/<ver>/protocols/SPAWNING.md`

### Graceful Shutdown (before every agent shutdown)

1. Confirm no remaining cards for this agent's stage
2. Send `shutdown_request` — the SubagentStop hook handles the retro interview automatically

### Plugin Locations

Verify current version: `ls ~/.claude/plugins/cache/local/sprint/` — use the highest version as `<ver>`.

- **Agents**: `~/.claude/plugins/cache/local/sprint/<ver>/agents/` and `~/.claude/plugins/cache/local/drupal-lab/<ver>/agents/`
- **Full sprint protocol**: `~/.claude/plugins/cache/local/sprint/<ver>/skills/run/SKILL.md`
- **Spawning mechanics**: `~/.claude/plugins/cache/local/sprint/<ver>/protocols/SPAWNING.md`
- **Decision rules**: `~/.claude/plugins/cache/local/sprint/<ver>/skills/run/references/decision-framework.md`
- **Comms format**: `~/.claude/plugins/cache/local/sprint/<ver>/protocols/team-comms-protocol.md`
- **Coordination protocol**: `~/.claude/plugins/cache/local/sprint/<ver>/protocols/AGENT-COORDINATION.md`

### Anti-Patterns

- ❌ Asking agents "are you ready?" — assume yes, send the task
- ❌ Spawning one implementer and waiting before spawning the next
- ❌ Keeping agents alive when their pipeline stage is complete
- ❌ Sending a status-check message instead of a work assignment
```
