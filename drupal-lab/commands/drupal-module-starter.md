---
description: Scaffold a Claude-ready project for Drupal contrib module development with DDEV
argument-hint: /path/to/module (or omit to use current directory)
allowed-tools: Read, Write, Bash, Glob, Grep
disable-model-invocation: true
---

# Drupal Module Starter

Scaffold a contrib module project with DDEV and ddev-drupal-contrib, layered on top of the generic admin scaffold.

**Critical constraint**: Do NOT copy agents or skills into the project. The `drupal-lab`, `sprint`, and `admin` plugins are globally installed and provide agents and skills automatically in every Claude session. Copying them locally creates stale shadow copies that confuse agents and mask plugin updates. The only project-local artifact this command creates (beyond directories) is a Drupal-specific section in `CLAUDE.md`.

## Input

`$ARGUMENTS` is the target directory path. If empty, **use the current working directory** (`$PWD`).

## Procedure

### 1. Run Base Scaffold

Invoke the `scaffold` skill from `admin` with the same `$ARGUMENTS`. This handles:
- Target validation and resolution
- Directory structure (`.claude/memory/`, `kanban/`, `analysis-reports/`, `plans/`, `worktrees/`)
- Project name detection
- CLAUDE.md and MEMORY.md generation
- Idempotency for all of the above

Continue with the steps below regardless of whether scaffold created or skipped files.

### 2. Detect Module Name

1. If `<target>/worktrees/main/composer.json` exists → extract the `name` field (e.g., `drupal/my_module` → `my_module`)
2. Else if `<target>/worktrees/main/*.info.yml` exists → extract module name from filename (e.g., `my_module.info.yml` → `my_module`)
3. Fallback → derive from directory basename of `<target>`

Store as `MODULE_NAME` for use in generated files.

### 3. Create Drupal-Specific Directories

Create these additional directories (skip any that already exist):

```
<target>/analysis-reports/drupal-issue/
<target>/tests/
```

Do NOT create `.claude/agents/` or `.claude/skills/` — agents and skills come from the installed plugins.

### 4. Add Drupal Contrib Context to CLAUDE.md

Append the following section to `<target>/CLAUDE.md` (skip if a `## Drupal Contrib Module` section already exists). Substitute `MODULE_NAME` with the detected module name:

```markdown
## Drupal Contrib Module

- **Module**: MODULE_NAME
- **Type**: contrib (uses [ddev-drupal-contrib](https://github.com/ddev/ddev-drupal-contrib) addon)
- **DDEV naming**: `MODULE_NAME-main` (main), `MODULE_NAME-{ISSUE}` (worktrees)

### Contrib vs Core Commands

This is a contrib module project. When using DDEV development skills, use the
contrib addon commands — not the Drupal core equivalents:

| Task | Use this | Not this |
|------|----------|----------|
| Coding standards | `ddev phpcs` | `ddev exec composer phpcs --` |
| Auto-fix | `ddev phpcbf` | `ddev exec composer phpcbf --` |
| Static analysis | `ddev phpstan` | `ddev exec vendor/bin/phpstan analyze` |
| Run tests | `ddev phpunit` | `ddev phpunit core/modules/...` |
| Run tests by group | `ddev phpunit --group MODULE_NAME` | |
| Install deps | `ddev poser` | `ddev composer install` |
| Symlink module | `ddev symlink-project` | |
| Switch core version | `ddev core-version` | |

### drupal-lab Plugin Skills

Skills are provided by the globally installed `drupal-lab` plugin — do not copy them locally.

- `drupal-lab:ddev-drupal-dev` — DDEV command reference (see contrib overrides above)
- `drupal-lab:process-lifecycle` — DDEV lifecycle; name instances `MODULE_NAME-{ISSUE}`
- `drupal-lab:validate-patch` — Quality gates (phpcs, phpstan, phpunit)
- `drupal-lab:analyze-issue` — Fetch and analyze drupal.org issues
- `drupal-lab:issue-summary` — Generate drupal.org contribution comment
- `drupal-lab:ddev-drupal-dev` skill reference: `~/.claude/plugins/cache/local/drupal-lab/<ver>/skills/ddev-drupal-dev/SKILL.md` (discover `<ver>` via `ls ~/.claude/plugins/cache/local/drupal-lab/`)

### drupal-lab Plugin Agents

Agents are provided by the globally installed plugins — do not copy them locally.

- `drupal-lab:implementer` — Implements fixes, writes tests
- `drupal-lab:reviewer` — Validates patches against quality gates
- `drupal-lab:fixer` — Targeted surgical bug fixes
- `drupal-lab:architect` — Read-only architecture analysis
- `drupal-lab:advisor` — Drupal 11 expertise and guidance
- `drupal-lab:issue-analyzer` — Analyzes drupal.org issues
- `drupal-lab:issue-planner` — Creates implementation plans
- `drupal-lab:test-coverage-analyst` — Test gap analysis

Agent definitions: `~/.claude/plugins/cache/local/drupal-lab/<ver>/agents/` (discover `<ver>` via `ls ~/.claude/plugins/cache/local/drupal-lab/`)
```

### 5. Validate `worktrees/main/` (Gate — Before DDEV)

Check:
1. `<target>/worktrees/main/` exists
2. It's a git working tree (`git -C <target>/worktrees/main rev-parse --is-inside-work-tree`)
3. It contains at least one of: `composer.json`, `*.info.yml`

If any check fails, **skip DDEV setup** and print:

```
DDEV setup skipped: worktrees/main/ is not set up yet.

Clone your module there first:

   git clone <your-module-repo-url> <target>/worktrees/main

Then run /drupal-module-starter again to configure DDEV.
```

If validation passes, continue to Step 6.

### 6. DDEV Setup

Only execute if Step 5 passed.

#### 6a. Check Prerequisites

```bash
command -v ddev >/dev/null 2>&1    # DDEV installed?
docker info >/dev/null 2>&1        # Docker running?
```

If either fails, skip and print:
```
DDEV setup skipped: prerequisites not met.

Required:
- DDEV: https://ddev.readthedocs.io/en/stable/users/install/
- Docker Desktop (must be running)

Install these, then run /drupal-module-starter again.
```

#### 6b. Configure DDEV (skip if `.ddev/` already exists)

```bash
cd <target>/worktrees/main
ddev config --project-type=drupal --docroot=web --php-version=8.3 --corepack-enable
```

#### 6c. Create Unique `config.local.yaml` (skip if exists)

Write `<target>/worktrees/main/.ddev/config.local.yaml`:

```yaml
name: MODULE_NAME-main
```

#### 6d. Install Addons

```bash
cd <target>/worktrees/main
ddev add-on get ddev/ddev-drupal-contrib
ddev add-on get ddev/ddev-selenium-standalone-chrome
```

#### 6e. Start and Bootstrap

```bash
cd <target>/worktrees/main
ddev start
ddev poser              # Installs Drupal core as dev dependency
ddev symlink-project    # Symlinks module into web/modules/custom/
```

#### 6f. Verify

```bash
ddev describe
ddev drush status       # May fail if Drupal not installed yet — OK
```

### 7. Idempotency

For every file and directory:
- If it already exists, **skip it** (do not overwrite)
- Track what was created vs. skipped
- DDEV setup: skip if `.ddev/` already exists in `worktrees/main/`

### 8. Mark Drupal Scaffold Complete

Write `"agentSquad": { "drupalScaffoldComplete": true }` into `<target>/.claude/settings.json` so the `scaffold-detect` hook no longer prompts for Drupal Phase 2 setup.

Use Python to safely merge without overwriting existing keys:

```python
import json, pathlib

settings_path = pathlib.Path("<target>/.claude/settings.json")
settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
settings.setdefault("agentSquad", {})["drupalScaffoldComplete"] = True
settings_path.write_text(json.dumps(settings, indent=2) + "\n")
```

To re-run Drupal setup later: remove the `agentSquad.drupalScaffoldComplete` key from `.claude/settings.json`.

### 9. Report

Print a summary:
- **Module Name**: detected module name
- **Base Scaffold**: created / skipped (already existed)
- **Drupal Extras Created**: files and directories newly created
- **Drupal Extras Skipped**: files and directories that already existed
- **DDEV Status**: configured / skipped (with reason) / already exists
- **Next Steps**: any remaining manual steps (e.g. clone module into worktrees/main)
