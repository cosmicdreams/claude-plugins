---
name: scaffold
description: >
  Set up a generic project structure for agent-assisted work: creates .claude/,
  analysis-reports/, plans/, and CLAUDE.md. Pass --silent to suppress the detection
  prompt. Not for DDEV setup, worktrees, or an already-scaffolded project.
triggers:
  - "scaffold this project"
  - "set up this project for agents"
  - "prepare this project for multi-agent work"
  - "initialize project structure"
  - "set up admin for this project"
  - "silence scaffold prompt"
  - "don't ask about scaffolding"
  - "disable scaffold prompt"
  - "stop asking about scaffold"
allowed-tools: Read, Bash, Glob, Grep
---

# Project Scaffold

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Sets up a project directory structure for agent-assisted work. Creates .claude/, analysis-reports/, plans/, and CLAUDE.md. Use when a project is missing these directories or when asked to initialize, prepare, or scaffold a project for team or multi-agent use. Pass --silent to suppress the scaffold detection prompt without running the scaffold. Do not use if the project is already scaffolded, or for DDEV setup, git worktrees, or environment configuration.

Set up a generic project directory structure: configuration, analysis reports, plans, and project guidance.

Globally installed plugins provide agents and skills in every Claude session. This skill only sets up **project-specific** artifacts.

## Modes

- **Default**: run the scaffold and create all project artifacts
- **`--silent`**: suppress the scaffold detection prompt without scaffolding (sets `agentSquad.scaffoldDetect=false`)

## Input

`$ARGUMENTS` is the target directory path, optionally with `--silent`. If empty, use `$PWD`.

## Procedure

### 1. Check for --silent flag

If `$ARGUMENTS` contains `--silent`:

```bash
TARGET="${ARGUMENTS/--silent/}"
TARGET="${TARGET/#\~/$HOME}"
TARGET="${TARGET:-$PWD}"
```

Run the silence script:

```bash
zsh "${CLAUDE_SKILL_DIR}/scaffold-silence.sh" "$TARGET"
```

Tell the user:
```
Scaffold prompt silenced for <project>.
To re-enable: remove "agentSquad.scaffoldDetect" from .claude/settings.json.
To scaffold later: "scaffold this project".
```

Stop here.

### 2. Resolve Target

```bash
TARGET="${ARGUMENTS:-$PWD}"
TARGET="${TARGET/#\~/$HOME}"
```

### 3. Detect Project Name

Run these checks in order; use the first match as `PROJECT_NAME`:

1. `<target>/worktrees/main/` exists with a git remote → last segment of remote URL (strip `.git`)
2. `<target>/worktrees/main/package.json` → `name` field
3. `<target>/worktrees/main/composer.json` → last segment of `name` after `/`
4. `<target>/.git/` exists → git remote repo name, or directory basename
5. Fallback → `basename "$TARGET"`

### 4. Run Scaffold Script

```bash
zsh "${CLAUDE_SKILL_DIR}/scaffold.sh" "$TARGET" "$PROJECT_NAME"
```

The script creates all directories, writes CLAUDE.md and MEMORY.md from templates, and marks scaffold complete in `.claude/settings.json`. It is idempotent — existing files are skipped, not overwritten.

### 5. Report

Parse the script output and present to the user:

- **Project Name**: value of `SCAFFOLD_PROJECT`
- **Target**: value of `SCAFFOLD_TARGET`
- **Created / Skipped**: lines prefixed with `+` / `=`
- **Worktrees**: if `SCAFFOLD_WORKTREES_MAIN=MISSING`, show:
  ```
  worktrees/main/ not found — clone or move your project there:
      git clone <repo-url> <target>/worktrees/main
  ```
- **Next Steps**: suggest domain-specific setup if applicable (e.g. for Drupal projects: set up DDEV, then `/drupal-lab:process-lifecycle`)

To re-scaffold later: remove the `agentSquad.scaffoldComplete` key from `.claude/settings.json`.
