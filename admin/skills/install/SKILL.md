---
name: admin:install
description: >
  Bootstrap office skill dependencies for the current environment. Detects whether
  running on macOS (Homebrew) or a Linux sandbox (apt/pip/npm), scans all installed
  plugin SKILL.md files for prerequisites, maps each dependency to the correct
  install command, and installs what it can automatically. Use this skill whenever
  Claude is in a fresh environment, when a skill fails because a CLI or package is
  missing, when the user says "install", "setup", "bootstrap", or "get my tools
  working", or when any office/research-lab skill reports a missing dependency.
  Trigger proactively if you detect a missing tool while running another office skill.
---

# admin:install — Environment Bootstrap

Detect the host environment and install the prerequisites for office and research-lab
skills. The goal: after this skill runs, every other skill that *can* work in the
current environment is ready to go.

## Quick overview

1. Detect the environment (macOS with Homebrew, or Linux sandbox with apt/pip/npm)
2. Scan office skill SKILL.md files to build a dependency manifest
3. Map dependencies → install commands for the detected environment
4. Install automatically where possible
5. Flag tools that need post-install authentication
6. Note tools that genuinely can't work in this environment and suggest workarounds

## Step 1: Detect the environment

Run the detection script:

```bash
bash "${SKILL_DIR}/scripts/detect-env.sh"
```

This prints a JSON object like:

```json
{
  "os": "linux",
  "env_type": "sandbox",
  "has_brew": false,
  "has_apt": true,
  "has_pip": true,
  "has_npm": true,
  "has_git": true,
  "shell": "bash"
}
```

Use `env_type` to select the right install mapping. The two supported environments are:

- **macOS** (`os: "darwin"`) — Uses Homebrew as the primary package manager. Most
  office skills were designed for this environment, so installs are straightforward.
- **Linux sandbox** (`os: "linux"`) — Typically a Cowork VM or CI container. Has
  `apt`, `pip`, and `npm` but no Homebrew. Some macOS-specific tools need alternative
  packages or aren't available at all.

> **Windows**: Not yet supported. If detected, print a notice and exit gracefully.
> This is a future TODO.

## Step 2: Build the dependency manifest

Read `references/dependency-map.md` — it contains the full mapping of every office and
research-lab skill's dependencies, organized by package manager and environment.

For each skill, the map lists:
- What to install and the command for each environment
- Whether it needs post-install authentication
- Whether it's unavailable in certain environments (and what workaround to use)

If the user only wants to set up specific skills (e.g., "just get slack and jira
working"), filter the manifest to only those skills. Otherwise, install everything
that's available for the detected environment.

## Step 3: Install dependencies

Group installs by package manager to minimize round-trips:

```bash
# System packages first (apt on Linux, brew on macOS)
# Then language-specific packages (pip, npm)
# Then verify each tool is on PATH
```

**Installation order matters:**
1. System packages (apt/brew) — these may provide Python or Node if missing
2. Python packages (pip) — `pip install --break-system-packages` on Linux sandbox
3. npm global packages — `npm install -g`
4. Standalone CLIs that need manual install (jira-cli via `go install` or release binary)

For each install, capture the exit code. After the batch completes, print a summary
table:

```
✓ pandas          pip install pandas          installed
✓ agent-slack     npm i -g agent-slack        installed
✗ jira-cli        (see notes)                 failed — needs Go toolchain
⚠ gws             npm i -g @googleworkspace/cli  installed — needs auth
⊘ pngquant        not available on Linux      unavailable
```

Use these status markers:
- `✓` — Installed and ready
- `⚠` — Installed but needs authentication (see Step 4)
- `✗` — Installation failed (show error and suggest fix)
- `⊘` — Not available in this environment (see Step 5)

## Step 4: Flag authentication requirements

Some tools work only after the user authenticates. Don't try to authenticate
automatically — just tell the user what they need to do.

Print a section like:

```
## Tools that need authentication

These are installed but won't work until you authenticate:

  agent-slack    →  agent-slack auth import-desktop
  gh             →  gh auth login
  gws            →  gws auth setup  (first time) or  gws auth login
  jira           →  jira init  (needs server URL + API token)
```

For tools that use secrets (TestRail, Cloudflare), suggest the environment variable
approach since that's the most portable across environments:

```
  testrail  →  export TESTRAIL_API_KEY="your-key"
  log-analyzer (Cloudflare)  →  export CF_API_TOKEN="..." CF_ZONE_ID="..."
```

## Step 5: Note unavailable tools

Some tools genuinely can't work in certain environments. Be honest about this rather
than attempting broken workarounds.

Read `references/unavailable-tools.md` for the full list per environment. For each
unavailable tool, explain *why* and suggest a workaround if one exists.

Common cases in a Linux sandbox:
- **macOS Keychain** → Use env vars instead: `export TESTRAIL_API_KEY="..."`
- **1Password CLI** → Use env vars instead (same pattern)
- **Homebrew image tools** (pngquant, avifenc, etc.) → Some have apt equivalents,
  some don't. Check the mapping.
- **Obsidian vault access** → Vault lives on macOS host; in sandbox, skills that
  need vault paths will need the path passed explicitly or mounted
- **DDEV** → Not typically available in sandbox; research-lab:run/experiment need
  a Drupal host environment
- **`agent-slack auth import-desktop`** → Requires Slack desktop app session from
  macOS; in sandbox, need `SLACK_TOKEN` env var instead if available

## Step 6: Summary report

End with a concise summary:

```
## Bootstrap complete

Environment: Linux sandbox (Ubuntu 22.04)
Skills ready:     csv-analysis, github, slack, deploy-post, pulse, ...
Need auth:        agent-slack, gh, gws, jira
Unavailable:      image-optimize (no apt equivalent for most tools), testrail (keychain)
```

If the user asked for a specific skill and it's in the "need auth" or "unavailable"
bucket, call that out prominently so they know what's blocking them.

---

## Reference files

- `references/dependency-map.md` — Complete dependency→install mapping per environment.
  **Read this before installing anything.** It's the source of truth for what to
  install and how.
- `references/unavailable-tools.md` — Tools that can't work per environment, with
  workarounds.
- `scripts/detect-env.sh` — Environment detection script.
