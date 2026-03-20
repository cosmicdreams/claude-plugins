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

The `name` parameter becomes the agent's identity for `SendMessage`. If you name an agent `slice-1`, other agents and you send messages to `slice-1`.

### Agent Type Format

Agents from plugins are referenced as `plugin:agent-name`:

| Plugin | Agent | Type string |
|--------|-------|-------------|
| sprint | slice-worker | `sprint:slice-worker` |
| sprint | cross-reviewer | `sprint:cross-reviewer` |
| sprint | deep-debugger | `sprint:deep-debugger` |
| sprint | team-lead | `sprint:team-lead` |
| improve | process-engineer | `improve:process-engineer` |
| drupal-lab | implementer | `drupal-lab:implementer` |
| drupal-lab | reviewer | `drupal-lab:reviewer` |
| drupal-lab | issue-analyzer | `drupal-lab:issue-analyzer` |
| drupal-lab | architect | `drupal-lab:architect` |
| drupal-lab | fixer | `drupal-lab:fixer` |
| drupal-lab | advisor | `drupal-lab:advisor` |
| drupal-lab | issue-planner | `drupal-lab:issue-planner` |
| drupal-lab | test-coverage-analyst | `drupal-lab:test-coverage-analyst` |

Project-specific agents (in `.claude/agents/`) use just the filename without a prefix.

---

## Required Tools Per Agent Role

Every agent definition's `tools:` frontmatter is a **strict allowlist**. Any tool not declared is unavailable — there is no silent fallback. Missing tools cause agents to either fail outright or make bad decisions (e.g. falling back to OS scheduling when CronCreate is missing).

Minimum required tools by role:

| Role | Required Tools | Why |
|------|---------------|-----|
| Any agent running a cron loop | `CronCreate`, `CronDelete`, `CronList`, `SendMessage` | Compaction recovery restores its own loop via CronCreate; uses SendMessage to notify team-lead |
| Any agent that spawns subagents | `Agent` | Cannot spawn without it |
| Team-lead / coordinator | `TeamCreate`, `SendMessage`, `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet` | Core coordination tools |
| Slice-worker | `Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, `LSP`, `SendMessage`, `TaskUpdate`, `TaskList`, `TaskGet` | Full file operations + coordination |
| Cross-reviewer | `Read`, `Bash`, `Grep`, `Glob`, `SendMessage`, `TaskUpdate`, `TaskList`, `TaskGet` | Read-only code access + validation + coordination |

> **Compaction recovery silent failure**: If `CronCreate` is missing from a loop agent's tools list, the agent goes permanently idle after context compaction — the loop is never restored and no error is surfaced.

### Shell Aliases Are Not Available in Bash Scripts

If you have a shell alias (e.g. `clauded` → `claude --dangerously-skip-permissions "$@"`), it is **not available** inside `#!/bin/bash` scripts. Always inline the full command with explicit flags:

```bash
# ❌ Will fail in a script
clauded --agent team-lead "prompt"

# ✅ Use the full invocation
claude --dangerously-skip-permissions --agent team-lead "prompt"
```

---

## Parallel Spawning

**Multiple Task tool calls in the same message = parallel agents.**

To spawn 3 slice-workers simultaneously:

```
[Single message, three Task tool calls]

Task(subagent_type="sprint:slice-worker", name="slice-1",
     prompt="Work on issue #2901667 end-to-end. Card: sprint-a1b2 ...")

Task(subagent_type="sprint:slice-worker", name="slice-2",
     prompt="Work on issue #3302103 end-to-end. Card: sprint-c3d4 ...")

Task(subagent_type="sprint:slice-worker", name="slice-3",
     prompt="Work on issue #3395027 end-to-end. Card: sprint-e5f6 ...")
```

These three run concurrently. Do **not** spawn them sequentially (one, wait for it to finish, spawn the next). If the work is parallelizable, spawn all at once.

### When to Spawn Multiples

Spawn N instances when:
- N independent issues exist in the backlog
- Issues share no files (no merge conflict risk)
- DDEV slot limit is respected for the test phase (not the spawn phase)

Sizing guide:

| Issues | Slice-workers | Cross-reviewers | Deep-debugger |
|--------|--------------|-----------------|---------------|
| 1 | 1 | 0-1 (risk-based) | On demand |
| 2-3 | 2-3 | 1-2 | On demand |
| 4-6 | 4-6 | 2-3 | On demand |
| 7+ | Batch in waves (DDEV cap) | 2-3 | On demand |

Cross-reviewers are spawned late — only when slices start completing.

> **Key rule**: If you have 3 issues ready and no file conflicts, spawn 3 slice-workers in one message. DDEV contention is managed by the agents themselves during the test phase.

---

## Instance Naming

When spawning multiple instances of the same agent type, append a number or issue number:

```
slice-1, slice-2, slice-3
slice-2901667, slice-3302103  (issue-number style)
cross-reviewer-1, cross-reviewer-2
```

**Why names matter:**
- `SendMessage(recipient: "slice-2", ...)` routes to that specific instance
- Board card assignee should use the instance name (set via `BD_ACTOR`)
- Shutdown requests must target the specific instance name

---

## What to Put in the Prompt

Each agent's spawn prompt should include:

1. **Role context**: "You are part of a team sprint. You own this issue end-to-end."
2. **Board location**: `Board: bd`
3. **Specific assignment**: card ID and issue URL
4. **Protocol references**: comms format, coordination protocol paths
5. **Instance name**: explicitly tell the agent its own name
6. **BD environment**: set `BD_ACTOR` to the agent's instance name

### Slice-Worker Spawn Template

```
You are part of a team sprint. You own this issue end-to-end: analyze, implement, test, validate.

export BD_ACTOR=slice-1
Board: bd
Your name: slice-1
Your assigned card: <bd-card-id>
Issue: <d.o URL>

Read your card: bd show <bd-card-id> --json
Claim it: bd update <bd-card-id> --claim --add-label lane-in-progress

Comms: ~/.claude/plugins/cache/local/sprint/<ver>/protocols/team-comms-protocol.md
Coordination: ~/.claude/plugins/cache/local/sprint/<ver>/protocols/AGENT-COORDINATION.md

DDEV limit: 3 concurrent (check ddev metadata on cards before claiming a slot).
Retro folder: analysis-reports/retro-session/<YYYY-MM-DD>+<team-name>/interviews/slice-1.md

Before closing a card, write a SUMMARY comment:
bd update <bd-card-id> --append-notes "SUMMARY: <what was fixed> / <ACs: AC-1 PASS, AC-2 PASS> / <deferred> (by @slice-1)"

After completing your first issue, check the board for the next available card:
bd ready -l board-sprint --json --unassigned

ALLOWED FILES (you may ONLY write to these paths):
- <list exact file paths here — team-lead fills this in at spawn time>
Any edit to a file not in this list is strictly forbidden.
If the card spec requires editing a file not listed, STOP and message team-lead before proceeding.
```

### Cross-Reviewer Spawn Template

```
You are reviewing a completed slice-worker's work.

export BD_ACTOR=cross-reviewer-1
Board: bd
Your name: cross-reviewer-1
Your assigned card: <bd-card-id>
Worktree to review: <worktree-path>

Read the card: bd show <bd-card-id> --json
Claim it: bd update <bd-card-id> --claim --remove-label lane-needs-cross-review --add-label lane-cross-reviewing

Run quality gates independently. Deliver APPROVED or REJECTED with file:line evidence.

Comms: ~/.claude/plugins/cache/local/sprint/<ver>/protocols/team-comms-protocol.md
```

---

## Managing Multiple Instances

Team-lead tracks instances by name. After spawning:

- Use `TaskList` to see which tasks each instance owns
- `SendMessage` by instance name to push work or send assignments
- When an instance reports `available | no pending tasks`, assign the next card or send shutdown

### Reassigning From a Slow Instance

If `slice-2` is stuck and `slice-3` finishes early:

```
SendMessage(recipient: "slice-3",
  content: "Take card sprint-x1y2 next — it's unassigned in backlog.")
```

Don't wait. Reassign immediately.

---

## SUMMARY Write Step

Before a slice-worker closes a card (or moves to cross-review), it writes a structured SUMMARY as a `bd` card comment. This is a **convention** — there is no `bd` label gate enforcing it.

### Why

SUMMARYs create a traceable record of what each card delivered, which ACs passed, and what (if anything) was deferred. This feeds into retrospective analysis and makes card outcomes auditable without reading diffs.

### Template

```
SUMMARY: <what was fixed> / <which ACs passed> / <what was deferred> (by @<agent-name>)
```

### Command

```bash
BD_ACTOR=slice-1 bd update <card-id> --append-notes "SUMMARY: Replaced jQuery once() with native addEventListener in toggleEditMode / AC-1 PASS, AC-2 PASS / Nothing deferred. (by @slice-1)"
```

The SUMMARY must be written **before** `bd close` or lane transition. The agent loop order is: work → write SUMMARY → close/transition card.

## Shutdown Sequence

Per sprint:run Graceful Shutdown Sequence:

```
1. Verify no remaining cards for this agent
2. SendMessage(type: "shutdown_request", recipient: "slice-1")
```

The agent writes its own retro interview before approving the shutdown request — team-lead does not send questions or save answers.

---

## Reference

- Agent definitions: `sprint/agents/` and `drupal-lab/agents/`
- Full sprint protocol: `sprint/skills/run/SKILL.md`
- Decision rules (autonomous vs. escalate): `sprint/skills/run/references/decision-framework.md`
- Retro interview templates: `retro/skills/interviews/SKILL.md`
