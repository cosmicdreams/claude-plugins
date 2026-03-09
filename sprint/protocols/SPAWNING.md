# Agent Spawning Protocol

How team-lead uses the Task tool to spawn, manage, and scale worker agents.

---

## How Agents Are Spawned

Agents are spawned using the **Task tool** with two required parameters:

```
Task(
  subagent_type = "plugin-name:agent-name",   # which agent definition to use
  name          = "unique-name-for-this-run",  # how to address this agent in messages
  prompt        = "specific task instructions"
)
```

The `name` parameter becomes the agent's identity for `SendMessage`. If you name an agent `implementer-1`, other agents and you send messages to `implementer-1`.

### Agent Type Format

Agents from plugins are referenced as `plugin:agent-name`:

| Plugin | Agent | Type string |
|--------|-------|-------------|
| drupal-lab | implementer | `drupal-lab:implementer` |
| drupal-lab | reviewer | `drupal-lab:reviewer` |
| drupal-lab | issue-analyzer | `drupal-lab:issue-analyzer` |
| drupal-lab | architect | `drupal-lab:architect` |
| drupal-lab | fixer | `drupal-lab:fixer` |
| drupal-lab | advisor | `drupal-lab:advisor` |
| drupal-lab | issue-planner | `drupal-lab:issue-planner` |
| drupal-lab | test-coverage-analyst | `drupal-lab:test-coverage-analyst` |
| sprint | reality-checker | `sprint:reality-checker` |
| sprint | deep-debugger | `sprint:deep-debugger` |
| sprint | code-quality-pragmatist | `sprint:code-quality-pragmatist` |
| sprint | process-improvement | `sprint:process-improvement` |
| sprint | team-lead | `sprint:team-lead` |
| sprint | ui-comprehensive-tester | `sprint:ui-comprehensive-tester` |
| sprint | claude-md-compliance-checker | `sprint:claude-md-compliance-checker` |

Project-specific agents (in `.claude/agents/`) use just the filename without a prefix.

---

## Parallel Spawning

**Multiple Task tool calls in the same message = parallel agents.**

To spawn 3 implementers simultaneously:

```
[Single message, three Task tool calls]

Task(subagent_type="drupal-lab:implementer", name="implementer-1",
     prompt="Work on issue #2901667. Analysis report: analysis-reports/2901667.md ...")

Task(subagent_type="drupal-lab:implementer", name="implementer-2",
     prompt="Work on issue #3302103. Analysis report: analysis-reports/3302103.md ...")

Task(subagent_type="drupal-lab:implementer", name="implementer-3",
     prompt="Work on issue #3395027. Analysis report: analysis-reports/3395027.md ...")
```

These three run concurrently. Do **not** spawn them sequentially (one, wait for it to finish, spawn the next). If the work is parallelizable, spawn all at once.

### When to Spawn Multiples

Spawn N instances when:
- N independent work items exist at the same pipeline stage
- Items share no files (no merge conflict risk)
- DDEV slot limit allows it (max 3 concurrent DDEV instances)

Sizing guide:

| Work items | Analyzers | Implementers | Validators |
|------------|-----------|--------------|------------|
| 1-2        | 1         | 1            | 1          |
| 3-5        | 1         | 2-3          | 2-3        |
| 6-10       | 2         | 3-4          | 3          |
| 10+        | Batch in waves of 5 |

> **Key rule**: 1 implementer waiting ≠ 1 implementer parallelizing. If you have 3 issues ready to implement and no file conflicts, spawn 3 implementers in one message.

---

## Instance Naming

When spawning multiple instances of the same agent type, append a number:

```
implementer-1, implementer-2, implementer-3
reviewer-1, reviewer-2
issue-analyzer-1, issue-analyzer-2
```

**Why names matter:**
- `SendMessage(recipient: "implementer-2", ...)` routes to that specific instance
- Board card assignee should use the instance name (set via `BD_ACTOR`)
- Shutdown requests must target the specific instance name

---

## What to Put in the Prompt

Each agent's spawn prompt should include:

1. **Role context**: "You are part of a team sprint working on Drupal issues."
2. **Board location**: `Board: bd`
3. **Specific assignment**: which issue or card this instance is starting on
4. **Protocol references**: comms format, coordination protocol paths
5. **Instance name**: explicitly tell the agent its own name so it can claim tasks correctly
6. **BD environment**: set `BD_ACTOR` to the agent's instance name before any `bd` call:
   `export BD_ACTOR=implementer-2`
   Board database: shared `.beads/` (auto-discovered). Sprint issues carry `-l board-sprint` label; use `bd list -l board-sprint` to scope queries.

Template:

```
You are part of a team sprint.

export BD_ACTOR=implementer-2
Board: bd
Your name: implementer-2
Your first assignment: <bd-card-id>
Analysis report: analysis-reports/3302103.md

Read your card: bd show <bd-card-id> --json
Claim it: bd update <bd-card-id> --claim --add-label lane-developing

Comms: ~/.claude/plugins/cache/local/sprint/<ver>/protocols/team-comms-protocol.md
Coordination: ~/.claude/plugins/cache/local/sprint/<ver>/protocols/AGENT-COORDINATION.md

After completing your first issue, check the board for the next available develop card:
bd ready --json --unassigned
Follow the pull protocol — claim unassigned cards matching your stage label.

ALLOWED FILES (you may ONLY write to these paths):
- <list exact file paths here — team-lead fills this in at spawn time>
Any edit to a file not in this list is strictly forbidden.
If the card spec requires editing a file not listed, STOP and message team-lead before proceeding.
```

---

## Managing Multiple Instances

Team-lead tracks instances by name. After spawning:

- Use `TaskList` to see which tasks each instance owns
- `SendMessage` by instance name to push work or send assignments
- When an instance reports `available | no pending tasks`, assign the next card or send shutdown

### Reassigning From a Slow Instance

If `implementer-2` is stuck on a hard issue and `implementer-3` finishes early:

```
SendMessage(recipient: "implementer-3",
  content: "implementer-2 is blocked on #3302103. Take #5678 next — it's unassigned.")
```

Don't wait. Reassign immediately.

---

## Shutdown Sequence

Per sprint:run Graceful Shutdown Sequence:

```
1. Verify no remaining cards for this agent's role
2. SendMessage(type: "shutdown_request", recipient: "implementer-2")
```

The agent writes its own retro interview before approving the shutdown request — team-lead does not send questions or save answers.

---

## Reference

- Agent definitions: `sprint/agents/` and `drupal-lab/agents/`
- Full sprint protocol: `sprint/<ver>/skills/run/SKILL.md`
- Decision rules (autonomous vs. escalate): `sprint/<ver>/skills/run/references/decision-framework.md`
- Retro interview templates: `sprint/<ver>/skills/retro-interviews/interview-templates.md`
