# Team Sprint — Project CLAUDE.md Snippet

Paste the section below into a project's `CLAUDE.md` to enable sprint mode for that project.

---

```markdown
## Team Sprint Mode

When asked to run a team sprint, coordinate multiple agents, or work on issues in parallel:
**YOU are the team-lead. Do not spawn a separate team-lead agent.**

### Running a Sprint

1. **Plan** — run `sprint:plan` to create and sequence beads if not already done.
2. **Run** — run `sprint:run`. It invokes the Workflow tool, which reads ready beads,
   launches one slice-worker per bead, and optionally runs cross-review as an adversarial
   verify stage. Results land in `analysis-reports/retro-session/<date>+<sprint>/results.json`.
3. **Retro** — run `retro:session` to read results.json and generate the retrospective report.

No team-lead loop. No SendMessage choreography. No shutdown ceremonies.
The Workflow harness handles parallelism, retro interview collection, and completion.

### Spawning Agents Directly

When running agents outside sprint:run (e.g., a one-off deep-debug):

```
Agent(subagent_type="sprint:slice-worker", name="worker-1", prompt="...")
Agent(subagent_type="sprint:deep-debugger", name="debugger-1", prompt="...")
Agent(subagent_type="drupal-lab:issue-worker", name="issue-1", prompt="...")
Agent(subagent_type="drupal-lab:reviewer", name="reviewer-1", prompt="...")
```

Spawn N agents at once when N items are ready — never sequentially.

### Plugin Locations

Verify current version: `ls ~/.claude/plugins/cache/local/sprint/` — use the highest version as `<ver>`.

- **Agents**: `~/.claude/plugins/cache/local/sprint/<ver>/agents/`
- **Full sprint skill**: `~/.claude/plugins/cache/local/sprint/<ver>/skills/run/SKILL.md`
- **Decision rules**: `~/.claude/plugins/cache/local/sprint/<ver>/skills/run/references/decision-framework.md`

### Anti-Patterns

- ❌ Asking agents "are you ready?" — assume yes, send the task
- ❌ Spawning one agent and waiting before spawning the next
- ❌ Keeping agents alive after their work is complete
- ❌ Sending status-check messages instead of work assignments
```
