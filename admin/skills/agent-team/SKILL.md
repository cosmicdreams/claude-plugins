---
name: agent-team
description: >
  Sets up a proper agent team using TeamCreate so that spawned agents share a communication
  channel and can coordinate via SendMessage. Use whenever the user asks to use agent teams,
  coordinate agents, have agents work together, or collaborate across parallel tasks — outside
  of a full sprint context. Trigger phrases: "use agent teams", "spin up a team", "create an
  agent team", "have agents coordinate", "agents that talk to each other", "parallel agents
  with shared context". ALWAYS use this skill before spawning agents when inter-agent
  communication or shared task state is needed. Do NOT use for single background agents,
  solo research tasks, or when sprint:run is already active.
---

# Agent Team

Coordinate multiple agents that share a communication channel and a task list.
The key step that makes this work — and that Claude will skip without this skill — is **TeamCreate first**.
Without it, agents are isolated workers with no shared channel. SendMessage between them will not work.

---

## Step 1 — Create the team

Always do this before spawning any agents.

```
TeamCreate(
  team_name = "descriptive-slug",   # kebab-case, reflects the work
  description = "What this team is doing"
)
```

This creates a shared task list at `~/.claude/tasks/{team-name}/` and registers the channel agents will communicate through.

---

## Step 2 — Create tasks in the shared task list

Create one task per unit of work. Tasks are visible to all agents on the team.

```
TaskCreate(subject="...", description="...")
```

Set up dependencies if needed:
```
TaskUpdate(taskId="2", addBlockedBy=["1"])
```

---

## Step 3 — Spawn agents into the team

Use the Agent tool with **both** `team_name` and `name` parameters. Without these, agents do not join the team.

```
Agent(
  subagent_type = "general-purpose",
  team_name     = "descriptive-slug",   # must match TeamCreate name exactly
  name          = "agent-name",          # used for SendMessage addressing
  prompt        = "..."
)
```

Spawn all agents whose work can proceed in parallel in a single message — multiple Agent tool calls in one response run concurrently.

### What to put in the agent prompt

Each agent needs:
1. Its own name: "Your name is agent-name"
2. The team name and how to read the team config: `~/.claude/teams/{team-name}/config.json`
3. Which task(s) it owns first: `TaskUpdate(taskId="N", owner="agent-name", status="in_progress")`
4. How to message teammates: `SendMessage(type="message", recipient="other-agent", ...)`
5. How to message team-lead when done or blocked
6. Pull protocol: after finishing a task, check `TaskList` for next available work before going idle

---

## Step 4 — Coordinate in real time

As agents work, they send findings and status via SendMessage. You (team-lead) receive these automatically as new conversation turns.

- **Agent → team-lead**: progress updates, blockers, findings
- **Agent → agent**: share findings that inform another agent's work before they finish
- **Team-lead → agent**: new assignments, clarifications, unblocking

When an agent goes idle after sending a message, that is normal — they are waiting for input. Send them their next task or a shutdown request.

Assign tasks dynamically as work completes:
```
TaskUpdate(taskId="N", owner="agent-name", status="in_progress")
SendMessage(type="message", recipient="agent-name", content="Take task N next — ...")
```

---

## Step 5 — Shut down agents when their work is done

When an agent has no remaining tasks, send a shutdown request:

```
SendMessage(type="shutdown_request", recipient="agent-name", content="All tasks complete. Wrap up.")
```

Wait for approval before calling TeamDelete.

---

## Step 6 — Clean up

After all agents have shut down:

```
TeamDelete()
```

This removes the team channel and task list directory.

---

## Common mistakes to avoid

- **Skipping TeamCreate** — agents will have no shared channel; SendMessage between them will silently fail
- **Omitting `team_name` or `name` from Agent tool call** — agent does not join the team
- **Using `run_in_background=true` without a team** — creates isolated workers, not teammates
- **Spawning sequentially** — if work is parallel, spawn all agents in a single message
- **Keeping agents alive with no work** — send shutdown_request as soon as their task queue is empty

---

## Minimal example

```
# 1. Create team
TeamCreate(team_name="gap-analysis", description="Investigating 3 API gaps in parallel")

# 2. Create tasks
TaskCreate(subject="Gap A: createFrame naming")
TaskCreate(subject="Gap B: version exposure")
TaskCreate(subject="Gap C: flex align baseline")
TaskCreate(subject="Synthesize all findings")
TaskUpdate(taskId="4", addBlockedBy=["1","2","3"])

# 3. Spawn agents in one message (parallel)
Agent(team_name="gap-analysis", name="researcher-a", subagent_type="general-purpose", prompt="Your name is researcher-a. Take task 1...")
Agent(team_name="gap-analysis", name="researcher-b", subagent_type="general-purpose", prompt="Your name is researcher-b. Take task 2...")
Agent(team_name="gap-analysis", name="researcher-c", subagent_type="general-purpose", prompt="Your name is researcher-c. Take task 3...")
Agent(team_name="gap-analysis", name="synthesizer",  subagent_type="general-purpose", prompt="Your name is synthesizer. Wait for messages from researcher-a, -b, -c then take task 4...")

# 4. Receive updates via SendMessage, reassign as needed

# 5. Shutdown + cleanup
SendMessage(type="shutdown_request", recipient="synthesizer", ...)
TeamDelete()
```
