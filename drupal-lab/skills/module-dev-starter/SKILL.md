---
name: module-dev-starter
description: Scaffold a Claude-ready project for Drupal contrib module development with DDEV. Use when setting up a new contrib module project -- e.g. "scaffold a Drupal module project", "set up DDEV for a contrib module", "initialize a contrib module workspace", "start a new Drupal module". Runs admin:scaffold then adds Drupal-specific directories, DDEV config, and composer setup. Do NOT use for Drupal core development -- core worktrees use drupal-lab:process-lifecycle instead.
triggers:
  - "scaffold a Drupal module project"
  - "set up DDEV for a contrib module"
  - "initialize a contrib module workspace"
  - "drupal module starter"
allowed-tools: Read, Write, Bash, Glob, Grep
---

# Drupal Module Dev Starter

Scaffold a contrib module project with DDEV and ddev-drupal-contrib, layered on top of the generic admin scaffold.

**Critical constraint**: Do NOT copy agents or skills into the project. The `drupal-lab`, `sprint`, and `admin` plugins are globally installed and provide agents and skills automatically in every Claude session. Copying them locally creates stale shadow copies that confuse agents and mask plugin updates.

## Input

`$ARGUMENTS` is the target directory path. If empty, use the current working directory (`$PWD`).

## Procedure

### 1. Run Base Scaffold

Invoke `admin:scaffold` with the same `$ARGUMENTS`. This handles:
- Target validation and resolution
- Directory structure (`.claude/memory/`, `kanban/`, `analysis-reports/`, `plans/`, `worktrees/`)
- Project name detection
- CLAUDE.md and MEMORY.md generation
- Idempotency

Continue with the steps below regardless of whether scaffold created or skipped files. Capture the `SCAFFOLD_TARGET` value from its output — use that as `TARGET` for all subsequent steps.

### 2. Run Module Dev Starter Script

The script handles all remaining steps. Find it via `${CLAUDE_SKILL_DIR}`:

```bash
bash "${CLAUDE_SKILL_DIR}/module-dev-starter.sh" "$TARGET"
```

The script performs:
- **Module name detection**: from `worktrees/main/composer.json`, `worktrees/main/*.info.yml`, or directory basename
- **Drupal directories**: creates `analysis-reports/drupal-issue/` and `tests/`
- **CLAUDE.md section**: appends the Drupal contrib block (skips if already present)
- **worktrees/main/ gate**: validates presence and git status before attempting DDEV
- **DDEV setup**: `ddev config`, `config.local.yaml`, addons, `ddev start`, `ddev poser`, `ddev symlink-project`
- **settings.json**: marks `drupalScaffoldComplete` so scaffold-detect stops prompting
- **Idempotency**: skips any step whose artifacts already exist

### 3. Report

Parse script output and present to the user:

- **Module Name**: value of `MODULE_STARTER_MODULE`
- **Target**: value of `MODULE_STARTER_TARGET`
- **Drupal Extras Created / Skipped**: lines prefixed with `+` / `=`
- **DDEV Status**: value of `MODULE_STARTER_DDEV` — one of:
  - `configured` — DDEV was set up fresh
  - `already-exists` — `.ddev/` was already present, skipped
  - `skipped:no-worktree` — `worktrees/main/` not ready; show clone instructions
  - `skipped:no-prerequisites` — DDEV or Docker not found; show install links
- **Next Steps**: if DDEV was skipped, show the relevant message from the script output

To re-run Drupal setup later: remove the `agentSquad.drupalScaffoldComplete` key from `.claude/settings.json`.
