---
name: admin:install
description: >
  Bootstrap skill dependencies for the current environment. Detects whether running on macOS
  (Homebrew) or a Linux sandbox (apt/pip/npm), scans installed plugin SKILL.md files for
  prerequisites, maps each dependency to the correct install command, and installs what it can
  automatically. Use whenever Claude is in a fresh environment, when a skill fails because a CLI
  or package is missing, when the user says "install", "setup", "bootstrap", or "get my tools
  working", or when any workshop or research-lab skill reports a missing dependency. Trigger
  proactively if you detect a missing tool while running another skill.
---

# admin:install — Environment Bootstrap

Detect the host environment and install prerequisites for all workshop and research-lab skills.
After this skill runs, every skill that *can* work in the current environment is ready to go.

## Steps

### 1. Detect the environment

```bash
zsh "${CLAUDE_SKILL_DIR}/scripts/detect-env.sh"
```

Prints a JSON object with `os`, `env_type`, `has_brew`, `has_apt`, `has_pip`, `has_npm`, `has_git`, `shell`.

Two supported environments:
- **macOS** (`os: "darwin"`) — Homebrew as primary package manager
- **Linux sandbox** (`os: "linux"`) — `apt`, `pip`, `npm`; no Homebrew

Windows: not yet supported. Print a notice and exit gracefully.

### 2. Build the dependency manifest

Read `references/dependency-map.md` — the complete mapping of every skill's dependencies per environment. If the user requests specific skills only, filter the manifest to those. Otherwise install everything available for the detected environment.

### 3. Install dependencies

Group installs by package manager:

1. System packages (apt/brew)
2. Python packages (`pip install --break-system-packages` on Linux)
3. npm global packages
4. Standalone CLIs (jira-cli via binary download or `go install`)

Capture exit codes. Print a summary table after the batch completes:

```
✓ agent-slack     npm i -g agent-slack        installed
⚠ gws             npm i -g @googleworkspace/cli  installed — needs auth
✗ jira-cli        (see notes)                 failed — needs Go toolchain
⊘ pngquant        not available on Linux      unavailable
```

Status markers: `✓` ready · `⚠` installed but needs auth · `✗` failed · `⊘` unavailable

### 4. Flag authentication requirements

Some tools need post-install authentication. Never attempt auth automatically — tell the user:

```
agent-slack    →  agent-slack auth import-desktop
gh             →  gh auth login
gws            →  gws auth setup  (first time) or  gws auth login
jira           →  jira init  (needs server URL + API token)
```

For secret-based tools: `export TESTRAIL_API_KEY="..."` and `export CF_API_TOKEN="..."`.

### 5. Note unavailable tools

Read `references/unavailable-tools.md` for the full per-environment list. For each unavailable tool explain why and suggest a workaround.

Common Linux sandbox cases:
- **macOS Keychain / 1Password CLI** → use env vars
- **Homebrew image tools** (pngquant, avifenc) → some have apt equivalents
- **DDEV** → not available in sandbox; Drupal workflows need a macOS host

### 6. Summary report

```
Environment: Linux sandbox (Ubuntu 22.04)
Skills ready:     csv-analysis, github, slack, deploy-post, ...
Need auth:        agent-slack, gh, gws, jira
Unavailable:      image-optimize, testrail (keychain)
```

---

## Token optimization tools

These are optional accelerators. Both are skip-safe — skills degrade gracefully when absent.

**rtk (Rust Token Killer)** — CLI proxy that filters verbose command output (60–90% savings).

Check presence: `command -v rtk`

Install: rtk is a binary; it is not distributed via Homebrew or npm. Download from the project's GitHub releases page. Verify installation with `rtk --version` and `rtk gain`. If a `reachingforthejack/rtk` (Rust Type Kit) conflict exists, the correct binary is identified by `rtk gain` working.

Note: a user-level Claude Code hook already rewrites top-level Bash calls (`git status` → `rtk git status`). Skills should not fight or duplicate that. The hook does not reach commands inside scripts or workflow-spawned agents — call `rtk` explicitly there for known-verbose operations.

**headroom** — context compression for large artifacts (logs, fetched articles, session transcripts).

Check presence: `command -v headroom`

Install:
```bash
pip install "headroom-ai[all]"
# or
npm install -g headroom-ai
```

Usage: `headroom wrap <agent>`, `headroom proxy`, or `from headroom import compress` in Python. `headroom perf` shows savings. Prefer reversible mode — originals stored locally, retrievable on demand.

---

## Claude Desktop packaging

To produce a Desktop-distributable archive, use `admin:package`. It handles the zip structure correctly (`.claude-plugin/` at root) and outputs to `dist/`. See `admin/skills/package/SKILL.md` for details.

---

## Reference files

- `references/dependency-map.md` — complete dependency → install mapping per environment. Read before installing anything.
- `references/unavailable-tools.md` — tools that cannot work per environment, with workarounds.
- `scripts/detect-env.sh` — environment detection script.
