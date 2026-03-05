---
name: scaffold
description: Sets up a project directory structure for multi-agent sprint work: creates kanban/, .claude/, analysis-reports/, and CLAUDE.md. Use when a project is missing these directories, when the user wants to start using sprint or agent workflows on a new codebase, or when asked to initialize/prepare/scaffold a project for team or multi-agent use. Also use when the user says things like 'set up team sprint mode', 'get this project ready for agents', or 'I want to use sprint here'. Do not use if the project is already scaffolded, or for DDEV setup, git worktrees, or environment configuration.
triggers:
  - "scaffold this project"
  - "set up this project for sprint or admin"
  - "prepare project for team sprint"
  - "initialize project structure"
  - "set up sprint/admin for this project"
allowed-tools: Read, Bash, Glob, Grep
---

# Project Scaffold

Set up a project directory structure for sprint/admin collaboration: kanban boards, retrospective tracking, analysis reports, and team-sprint mode CLAUDE.md.

The `sprint` and `admin` plugins (globally installed) already provide agents, skills, and protocols in every Claude session. This skill only sets up **project-specific** artifacts.

Domain-specific plugins (e.g. `drupal-lab`) may extend this scaffold with their own setup steps — run their starter commands after this one.

## Input

`$ARGUMENTS` is the target directory path. If empty, use the current working directory (`$PWD`).

## Procedure

### 1. Resolve Target

```bash
TARGET="${ARGUMENTS:-$PWD}"
# Expand ~ if present
TARGET="${TARGET/#\~/$HOME}"
```

### 2. Detect Project Name

Run these checks in order via Bash; use the first match as `PROJECT_NAME`:

1. `<target>/worktrees/main/` exists with a git remote → last segment of remote URL (strip `.git`)
2. `<target>/worktrees/main/package.json` → `name` field
3. `<target>/worktrees/main/composer.json` → last segment of `name` after `/`
4. `<target>/.git/` exists → git remote repo name, or directory basename
5. Fallback → `basename "$TARGET"`

### 3. Run Scaffold Script

The scaffold script lives alongside this skill. Find it via `${CLAUDE_PLUGIN_ROOT}`:

```bash
SKILL_DIR="${CLAUDE_PLUGIN_ROOT}/skills/scaffold"
bash "$SKILL_DIR/scaffold.sh" "$TARGET" "$PROJECT_NAME"
```

The script creates all directories, writes CLAUDE.md and MEMORY.md from templates (substituting `PROJECT_NAME`), and marks scaffold complete in `.claude/settings.json`. It is idempotent — existing files are skipped, not overwritten.

### 4. Report

Parse the script output and present to the user:

- **Project Name**: value of `SCAFFOLD_PROJECT`
- **Target**: value of `SCAFFOLD_TARGET`
- **Created / Skipped**: lines prefixed with `+` / `=` from the script output
- **Worktrees**: if `SCAFFOLD_WORKTREES_MAIN=MISSING`, show:
  ```
  worktrees/main/ not found — clone or move your project there:
      git clone <repo-url> <target>/worktrees/main
      # or: git init <target>/worktrees/main
  ```
- **Next Steps**: suggest domain-specific setup if applicable (e.g. for Drupal projects: set up DDEV, then consult `/drupal-lab:process-lifecycle`)

To re-scaffold later: remove the `agentSquad.scaffoldComplete` key from `.claude/settings.json`.
