---
name: scaffold
description: Use when setting up a new project for multi-agent work, or when a project is missing .claude/, kanban/, or CLAUDE.md. Trigger phrases: 'scaffold this project', 'set up team sprint mode', 'initialize this project for sprint work', 'set up for multi-agent'. Do not use if the project is already scaffolded.
triggers:
  - "scaffold this project"
  - "set up this project for sprint or admin"
  - "prepare project for team sprint"
  - "initialize project structure"
  - "set up sprint/admin for this project"
allowed-tools: Read, Write, Bash, Glob, Grep
---

# Project Scaffold

Set up a project directory structure for sprint/admin collaboration: kanban boards, retrospective tracking, analysis reports, and team-sprint mode CLAUDE.md.

The `sprint` and `admin` plugins (globally installed) already provide agents, skills, and protocols in every Claude session. This skill only sets up **project-specific** artifacts.

Domain-specific plugins (e.g. `drupal-lab`) may extend this scaffold with their own setup steps — run their starter commands after this one.

## Input

`$ARGUMENTS` is the target directory path. If empty, use the current working directory (`$PWD`).

## Procedure

### 1. Validate Target

- If `$ARGUMENTS` is empty, use the current working directory
- Resolve to an absolute path
- Confirm the directory exists (create it if it doesn't)

### 2. Detect Project Name

1. If `<target>/worktrees/main/` exists and has a git remote → use the repo name (last segment of remote URL, strip `.git`)
2. Else if `<target>/worktrees/main/package.json` exists → use the `name` field
3. Else if `<target>/worktrees/main/composer.json` exists → use the `name` field (last segment after `/`)
4. Else if `<target>/.git/` exists → use the repo name from remote, or directory basename
5. Fallback → derive from directory basename of `<target>`

Store as `PROJECT_NAME`.

### 3. Create Directory Structure

Create these directories (skip any that already exist):

```
<target>/.claude/memory/
<target>/analysis-reports/retro-session/
<target>/kanban/sprint-run/1_backlog/
<target>/kanban/sprint-run/2_analyzing/
<target>/kanban/sprint-run/3_developing/
<target>/kanban/sprint-run/4_needs-qa/
<target>/kanban/sprint-run/5_validating/
<target>/kanban/sprint-run/6_qa-failed/
<target>/kanban/sprint-run/7_done/
<target>/kanban/retrospective-actions/1_backlog/
<target>/kanban/retrospective-actions/2_approved/
<target>/kanban/retrospective-actions/3_in-progress/
<target>/kanban/retrospective-actions/4_done/
<target>/plans/
<target>/worktrees/
```

### 4. Generate CLAUDE.md

Write `<target>/CLAUDE.md` (skip if exists), substituting `PROJECT_NAME`:

```markdown
# CLAUDE.md

## Project Overview

PROJECT_NAME

## Project Structure

- `.claude/memory/` — Project-specific institutional memory
- `analysis-reports/` — Session retrospective output and analysis
- `kanban/` — File-based Kanban boards for team sprints and retrospective actions
- `plans/` — Implementation plans
- `worktrees/` — Git worktrees for isolated development

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
Task(subagent_type="sprint:deep-debugger", name="debugger-1", prompt="...")
Task(subagent_type="sprint:reality-checker", name="checker-1", prompt="...")
```

If N work items are ready with no file conflicts, spawn N agents at once.
Do not spawn one and wait for it to finish before spawning the next.

Full spawning mechanics (instance naming, prompt template, sizing guide):
Verify current version first: `ls ~/.claude/plugins/cache/local/sprint/`
Then: `~/.claude/plugins/cache/local/sprint/<ver>/protocols/SPAWNING.md`

### Graceful Shutdown (before every agent shutdown)

1. Confirm no remaining cards for this agent's stage
2. Send `shutdown_request`

**The retrospective interview is automated** for sprint agents (implementer, qa-validator, process-improvement). The `subagent-stop-interview` hook intercepts the stop, injects interview questions, and saves answers automatically — no manual action needed.

If the hook is not active, fall back to the manual sequence: send questions from `retro-session/interview-templates.md`, save the response, then shutdown.

### Plugin Locations

Verify current version: `ls ~/.claude/plugins/cache/local/sprint/` — use the highest version as `<ver>`.

- **Agents**: `~/.claude/plugins/cache/local/sprint/<ver>/agents/`
- **Full sprint protocol**: `~/.claude/plugins/cache/local/sprint/<ver>/skills/sprint-run/SKILL.md`
- **Spawning mechanics**: `~/.claude/plugins/cache/local/sprint/<ver>/protocols/SPAWNING.md`
- **Decision rules**: `~/.claude/plugins/cache/local/sprint/<ver>/skills/sprint-run/references/decision-framework.md`
- **Comms format**: `~/.claude/plugins/cache/local/sprint/<ver>/protocols/team-comms-protocol.md`
- **Coordination protocol**: `~/.claude/plugins/cache/local/sprint/<ver>/protocols/AGENT-COORDINATION.md`

### Anti-Patterns

- ❌ Asking agents "are you ready?" — assume yes, send the task
- ❌ Spawning one agent and waiting before spawning the next
- ❌ Keeping agents alive when their pipeline stage is complete
- ❌ Sending a status-check message instead of a work assignment

## TODO

- Project purpose and architecture
- Key domain agents and workflows
- Testing strategy
```

### 5. Generate MEMORY.md

Write `<target>/.claude/memory/MEMORY.md` (skip if exists):

```markdown
# PROJECT_NAME Memory

## Workflow Patterns
<!-- Populated after first session -->

## Key Learnings
<!-- Populated after first retrospective -->

## Session History
<!-- Append session summaries here -->
```

### 6. Note Worktrees Status

Check whether `<target>/worktrees/main/` exists and is a git working tree. If not, include in the report:

```
worktrees/main/ not found — clone or move your project there:

    git clone <repo-url> <target>/worktrees/main
    # or: git init <target>/worktrees/main
```

Do not block or fail — scaffolding is useful even without worktrees/main.

### 7. Idempotency

For every file and directory:
- If it already exists, **skip it** (do not overwrite)
- Track what was created vs. skipped

### 8. Mark Scaffold Complete

Write `"agentSquad": { "scaffoldComplete": true }` into `<target>/.claude/settings.json` so the `scaffold-detect` hook stays silent on future sessions.

Use Python to safely merge without overwriting existing keys:

```python
import json, pathlib, sys

settings_path = pathlib.Path("<target>/.claude/settings.json")
settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
settings.setdefault("agentSquad", {})["scaffoldComplete"] = True
settings_path.write_text(json.dumps(settings, indent=2) + "\n")
```

To re-scaffold later: remove the `agentSquad.scaffoldComplete` key from `.claude/settings.json`.

### 9. Report

Print a summary:

- **Project Name**: detected name
- **Target**: resolved path
- **Created**: files and directories newly created
- **Skipped**: files and directories that already existed
- **Worktrees**: present / not found (with setup hint if missing)
- **Next Steps**: suggest domain-specific setup if applicable (e.g. for Drupal projects: set up DDEV, then consult `/drupal-lab:process-lifecycle` for worktree lifecycle management)
