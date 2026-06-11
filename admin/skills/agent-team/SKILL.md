---
name: agent-team
description: >
  Sets up a proper agent team using TeamCreate so that spawned agents share a communication
  channel and can coordinate via SendMessage. Use whenever the user asks to use agent teams,
  coordinate agents, have agents work together, or collaborate across parallel tasks — outside
  of a full sprint context. Trigger phrases: "use agent teams", "spin up a team", "create an
  agent team", "have agents coordinate", "agents that talk to each other", "parallel agents
  with shared context". Also use to decide whether a team is the right shape at all — it routes
  deterministic fan-out work to the Workflow tool and independent work to plain parallel Agent
  calls. Do NOT use for single background agents, solo research tasks, or when sprint:run is
  already active.
---

# Agent Team

Coordinate multiple agents that share a communication channel and a task list.

---

## Step 0 — Pick the right shape

A team is the heaviest of three multi-agent shapes. Route deliberately:

| Shape | Use when | Mechanism |
|-------|----------|-----------|
| **Parallel Agent calls** | Independent tasks; each result returns only to you; no cross-talk needed | Multiple Agent calls in one message |
| **Workflow tool** | Deterministic fan-out or pipeline over a known work-list; structured (schema-validated) outputs; verify/synthesize stages; no peer chat | `Workflow` with pipeline()/parallel() |
| **Agent team** | Emergent coordination: agents share findings mid-flight, claim tasks dynamically, message each other and you; long-running collaboration | TeamCreate + the steps below |

Routing notes:

- The user asking for multi-agent work in their own words satisfies the Workflow tool's opt-in requirement — you may route to it from here.
- A **named** agent (`name=...`) is addressable via `SendMessage(to=name)` while running even **without** a team, and a completed background agent can be continued via the `agentId` from its spawn result. You do not need a team just to talk to one agent.
- What a team uniquely adds: **peer-to-peer messaging** between agents, a **shared task list**, and **idle notifications** delivered to you as the lead.
- Litmus test: "fan out N workers, collect results, maybe verify" → Workflow. "Workers must react to each other's findings before they finish" → team.

If a team is the right shape, continue.

---

## Step 1 — Create the team

Always do this before spawning any agents.

```
TeamCreate(
  team_name = "descriptive-slug",   # kebab-case, reflects the work
  description = "What this team is doing"
)
```

This creates the team config at `~/.claude/teams/{team-name}/config.json` and a shared task list at `~/.claude/tasks/{team-name}/`. Without it, agents have no peer channel and no shared task state.

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
  prompt        = "...",
  model         = "haiku"                # optional override; omit to inherit
)
```

Spawn all agents whose work can proceed in parallel in a single message — multiple Agent tool calls in one response run concurrently.

- **model**: omit to inherit the session model (usually correct). Override per agent when confident: `haiku` (well-defined, mechanical), `sonnet` (ambiguous, reasoning), `opus`/`fable` (large or long-running).
- **Concurrent file mutation needs isolation.** When two or more agents will edit files at the same time, give each one its own worktree — otherwise they collide in the shared working tree. Pre-create one worktree per writing agent (e.g. `admin:create-worktree`) and point each agent's prompt at its directory. Read-only agents need neither.

### What to put in the agent prompt

Each agent needs:
1. Its own name: "Your name is agent-name"
2. The team name and how to read the team config: `~/.claude/teams/{team-name}/config.json`
3. Which task(s) it owns first: `TaskUpdate(taskId="N", owner="agent-name", status="in_progress")`
4. How to message teammates: `SendMessage(to="other-agent", summary="...", message="...")`
5. How to message team-lead when done or blocked
6. Pull protocol: after finishing a task, check `TaskList` for next available work before going idle
7. Status goes through TaskUpdate, not chat — no structured JSON status messages over SendMessage

---

## Step 4 — Coordinate in real time

As agents work, they send findings and status via SendMessage. You (team-lead) receive these automatically as new conversation turns — there is no inbox to poll.

- **Agent → team-lead**: progress updates, blockers, findings
- **Agent → agent**: share findings that inform another agent's work before they finish (you see a summary in their idle notification)
- **Team-lead → agent**: new assignments, clarifications, unblocking

Agents go idle after every turn — this is normal, not an error. An idle agent is waiting for input; sending it a message wakes it.

Assign tasks dynamically as work completes:
```
TaskUpdate(taskId="N", owner="agent-name", status="in_progress")
SendMessage(to="agent-name", summary="assign task N", message="Take task N next — ...")
```

---

## Step 5 — Shut down agents when their work is done

When an agent has no remaining tasks, send a shutdown request:

```
SendMessage(to="agent-name", message={"type": "shutdown_request", "reason": "All tasks complete."})
```

The agent replies with a `shutdown_response` (approve=true terminates it). Wait for approval from every agent before cleanup.

---

## Step 6 — Clean up

After all agents have shut down:

```
TeamDelete()
```

This removes the team config and task list directory. It **fails if any member is still active** — finish Step 5 for everyone first.

---

## Common mistakes to avoid

- **Defaulting to a team when Workflow fits** — deterministic fan-out with no peer chat is Workflow's job; teams add coordination overhead you don't need
- **Skipping TeamCreate** — agents will have no peer channel or shared task list
- **Omitting `team_name` or `name` from the Agent call** — agent does not join the team
- **Using old SendMessage syntax** — the schema is `{to, summary, message}`; `type=`/`recipient=`/`content=` parameters do not exist
- **Spawning sequentially** — if work is parallel, spawn all agents in a single message
- **Parallel file edits in a shared working tree** — isolate writing agents in per-agent worktrees (project convention first)
- **Keeping agents alive with no work** — send a shutdown_request as soon as their task queue is empty
- **Calling TeamDelete with members still active** — it fails; shut everyone down first

---

## Minimal example

```
# 1. Create team
TeamCreate(team_name="gap-analysis", description="Investigating 3 API gaps in parallel")

# 2. Create tasks
TaskCreate(subject="Gap A: createFrame naming", description="...")
TaskCreate(subject="Gap B: version exposure", description="...")
TaskCreate(subject="Gap C: flex align baseline", description="...")
TaskCreate(subject="Synthesize all findings", description="...")
TaskUpdate(taskId="4", addBlockedBy=["1","2","3"])

# 3. Spawn agents in one message (parallel)
Agent(team_name="gap-analysis", name="researcher-a", subagent_type="general-purpose", prompt="Your name is researcher-a. Take task 1...")
Agent(team_name="gap-analysis", name="researcher-b", subagent_type="general-purpose", prompt="Your name is researcher-b. Take task 2...")
Agent(team_name="gap-analysis", name="researcher-c", subagent_type="general-purpose", prompt="Your name is researcher-c. Take task 3...")
Agent(team_name="gap-analysis", name="synthesizer",  subagent_type="general-purpose", prompt="Your name is synthesizer. Wait for messages from researcher-a, -b, -c then take task 4...")

# 4. Receive updates via SendMessage, reassign as needed
SendMessage(to="researcher-a", summary="next assignment", message="Task 1 looks done — pick up task 3 review.")

# 5. Shutdown each agent, wait for approvals
SendMessage(to="synthesizer", message={"type": "shutdown_request", "reason": "All tasks complete."})

# 6. Cleanup
TeamDelete()
```
