---
name: new-agent
description: Use when asked to build a new agent, add a new role to the team, or write an agent definition file. Trigger phrases: 'create an agent', 'add an agent', 'new agent for X', 'write an agent that does Y', 'make me an agent'. Do not use for editing existing agents — use Edit tool directly for that.
triggers:
  - "create an agent"
  - "new agent"
  - "add a role"
  - "build an agent"
---

# Agent Creator

Build agent definitions that meet team standards and integrate correctly with team sprints.

## Standards Reference

**Colors in use by sprint and admin and drupal-lab plugins — do not reuse:**
| Agent | Color |
|-------|-------|
| team-lead | red |
| process-improvement | purple |
| issue-analyzer | cyan |
| implementer | orange |
| qa-validator | red (collision with team-lead) |

**Project agents may add more — check `.claude/agents/` for the full collision list before assigning a color.**

**Model selection:** Use the full decision tree in the `optimize-agents` skill. Quick guide:
- `haiku` — procedural/checklist work, runs tools and reports output, no code writing
- `sonnet` — writes code, makes judgment calls, synthesizes information
- `opus` — only when sonnet demonstrably fails; never default to it

**Sprint tools (required if agent participates in team sprints):**
`SendMessage, TaskUpdate, TaskList, TaskGet`

## Phase 1: Gather Requirements

Ask the user each of these questions before generating anything:

1. What is the agent's primary job? (one sentence — this becomes the description)
2. Will it participate in team sprints? (yes/no — determines Team Coordination section)
3. What tools does it need? (list minimum required; prompt to justify each one)
4. What model is appropriate? (haiku/sonnet/opus — use the model selection guide above)
5. What are the 3-5 key process steps in order?
6. What does its completion message to team-lead look like?
7. What errors might this agent encounter? (separate into transient — worth retrying — vs. permanent — must escalate. Think about role-specific failures, not generic ones.)
8. What quality gates must pass before this agent's work is considered complete? (2-4 role-specific checks — e.g., "all tests pass", "card moved to done", "no lint errors introduced")

Do not proceed to Phase 2 until all eight questions are answered.

## Phase 2: Generate the Agent Definition

Apply this template. Fill every section — do not omit any:

```markdown
---
name: <kebab-case-name>
description: <one sentence: what it does and when to use it>
color: <unique color not in the collision table above>
tools: <comma-separated minimum set; include SendMessage, TaskUpdate, TaskList, TaskGet if sprint agent>
model: <haiku|sonnet|opus>
---

# <Title Case Name>

## Capabilities
- <bullet per capability, specific and concrete>

## Process
1. <first step>
2. <second step>
3. <...>
4. Update task + message team-lead (see Team Coordination)

## Team Coordination (when in a team sprint)

**On task start:**
1. `TaskUpdate(taskId, status: in_progress, owner: "<agent-name>")` — claim immediately
2. Begin work

**On task complete:**
1. `TaskUpdate(taskId, status: completed)`
2. `SendMessage(type: message, recipient: "team-lead", content: "<completion message>")`
3. `TaskList` — check for next assigned task; if none, tell team-lead you're available

**If blocked:**
- `SendMessage(type: message, recipient: "team-lead", content: "Blocked: [reason]. Need: [what].")` — immediately

**Never:**
- Skip TaskUpdate — it is how team-lead tracks sprint state
- Go idle without sending a completion or availability message
- Wait for team-lead to ask if you're done

## Communication Format
**Internal → team-lead**: Ultra-concise
- Complete: `<role-specific format>`
- Available: `<agent-name> available | no pending tasks`
- Blocked: `Blocked #[task]: [reason] | need: [what]`

## Error Recovery

**Transient** (retry once after brief pause): [role-specific transient errors — e.g., "file lock contention", "flaky test failure", "MCP timeout"]
**Permanent** (escalate immediately): [role-specific permanent errors — e.g., "merge conflict in protected file", "missing required credentials", "dependency not installed"]

On permanent error: [role-specific escalation path — e.g., "message team-lead with error details and go idle", "move card back to approved/ and notify team-lead"]

## Quality Gates

Before marking work complete:
- [ ] [role-specific quality gate — e.g., "all modified files pass lint"]
- [ ] [role-specific quality gate — e.g., "tests pass for changed modules"]
- [ ] [role-specific quality gate — e.g., "card moved to done/ with outcome note"]
```

**Rules while filling the template:**
- Omit the Team Coordination section entirely if the agent will not be used in team sprints
- Error Recovery and Quality Gates sections are always required — fill with role-specific content from Phase 1 answers
- Keep total file length between 60-120 lines
- No prose padding — every line must be actionable

## Phase 3: Validate

Check each item before writing the file:

- [ ] `name` is kebab-case and matches the filename
- [ ] `description` is one sentence, specific about what and when
- [ ] `color` is not in the collision table (check project `.claude/agents/` for additional collisions)
- [ ] Tools list is minimal — no tool included without a justified need
- [ ] Sprint agents include `SendMessage, TaskUpdate, TaskList, TaskGet`
- [ ] Team Coordination section present if sprint agent, absent if not
- [ ] Completion message format defined in Communication Format section
- [ ] Error Recovery section present with role-specific transient and permanent errors (not generic placeholders)
- [ ] Quality Gates section present with 2-4 role-specific checks (not generic boilerplate)
- [ ] File is 60-120 lines total

If any item fails, fix it before Phase 4.

## Phase 4: Register

1. Determine the correct target:
   - **Project-specific agent**: write to `.claude/agents/<name>.md` in the project root
   - **Plugin agent** (generic, reusable across projects): write to the appropriate plugin's `agents/` directory and reinstall the plugin
2. If this is a new team capability, note the agent in the project's `MEMORY.md` under "Team Structure"

## Common Mistakes to Catch

| Mistake | Fix |
|---------|-----|
| Color reused from collision table | Scan `.claude/agents/` for all in-use colors first |
| Tools list too broad | Only include tools the agent actively calls |
| No completion message format defined | Add to Communication Format section before writing file |
| Team Coordination section missing for sprint agent | Add full section from template above |
| Error Recovery / Quality Gates missing or generic | Use Phase 1 answers to write role-specific content — "[describe errors]" is not acceptable |
| File over 120 lines | Move detail to a references/ file or trim prose |
