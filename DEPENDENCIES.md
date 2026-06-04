# Dependencies

External CLI tools required by CLAUDE-PLUGINS. Not every plugin needs every tool — check the table below to install only what you need.

## Quick Reference

| Tool | Plugins | Install |
|------|---------|---------|
| [bd (Beads)](#bd-beads) | sprint, retro, drover | `brew install beads` |
| [obsidian CLI](#obsidian-cli) | sprint, retro, ideate, drupal-lab, lib, workflow, ideas-funnel, research-lab | see below |
| [gh (GitHub CLI)](#gh-github-cli) | lib | `brew install gh` |
| [gws (Google Workspace CLI)](#gws-google-workspace-cli) | workflow | `npm i -g @googleworkspace/cli` |
| [jira-cli](#jira-cli) | lib, workflow | `brew install ankitpokhrel/jira-cli/jira-cli` |
| [agent-slack](#agent-slack) | lib, workflow | `npm i -g agent-slack` |
| [ddev](#ddev) | drupal-lab, drover, lib | see below |
| [acli (Acquia CLI)](#acli-acquia-cli) | drover, lib | see below |
| [op (1Password CLI)](#op-1password-cli) | lib | see below |
| [node / npm](#node--npm) | ideate, workflow, lib | `brew install node` |
| [python3](#python3) | admin, drupal-lab, ideate, lib, workflow | built-in on macOS |
| [ffmpeg](#ffmpeg) | lib | `brew install ffmpeg` |
| [lighthouse](#lighthouse) | lib, improve | `npm i -g lighthouse` |
| [pa11y](#pa11y) | lib, improve | `npm i -g pa11y` |
| [hyperfine](#hyperfine) | lib, improve | `brew install hyperfine` |
| [jq / yq](#jq--yq) | drover, ideas-funnel, lib | `brew install jq yq` |

---

## bd (Beads)

Kanban/issue tracking database. All sprint, retro, and drover board operations (`bd list`, `bd create`, `bd update`, etc.) depend on this.

```bash
brew install beads
```

After installing, initialize the board in your project:

```bash
bd init --prefix sprint
```

One `bd init` per project — running it a second time will error if already initialized. Use `bd create --prefix retro` for retro cards on the same database.

**Used by:** sprint, retro, drover

---

## obsidian CLI

The `obsidian` CLI writes notes into a running Obsidian vault. Skills that archive output (retro reports, ideate brainstorms, Drupal issue analyses, sprint release notes, ideas-funnel wiki pages, research-lab summaries) all call this tool.

**Prerequisites:**
1. [Obsidian](https://obsidian.md) desktop app — download and open your vault at least once
2. In Obsidian: install the **Local REST API** community plugin and enable it
3. Install the CLI:

```bash
npm i -g @obsidian-tools/obsidian-cli
```

**Verify:**

```bash
obsidian help
```

**Vault configuration:** Skills default to a vault named `Neurons` at `~/Vaults/Neurons`. Override with the `OBSIDIAN_VAULT_NAME` environment variable.

**Used by:** sprint (`project-notes`), retro (`session`, `interviews`), ideate (most skills), drupal-lab (`analyze-issue`, `issue-summary`), lib (`archive`, `vault-store`, `vault-search`, `wiki-query`), workflow (`organize`, `obsidian-lint`, `prioritize`, `scout`), ideas-funnel (all skills), research-lab (`literary-review`, `run`)

---

## gh (GitHub CLI)

GitHub pull request and issue management.

```bash
brew install gh
gh auth login
```

**Used by:** lib (`github`)

---

## gws (Google Workspace CLI)

Gmail and Google Calendar access via the Google Workspace API.

```bash
npm i -g @googleworkspace/cli
gws auth setup
```

Follow the setup prompts to connect a Google account. Requires a Google Cloud project with Gmail and Calendar APIs enabled.

**Used by:** workflow (`personal-email`, `personal-calendar`, `prioritize`)

---

## jira-cli

Jira issue and sprint management.

```bash
brew install ankitpokhrel/jira-cli/jira-cli
jira init
```

Run `jira init` in your project directory to connect to your Jira instance. Requires a Jira API token.

**Used by:** lib (`jira`), workflow (`prioritize`)

---

## agent-slack

Slack CLI for reading channels and searching messages. Read-only — does not send or post.

```bash
npm i -g agent-slack
agent-slack auth import-desktop   # imports token from Slack desktop app
```

Or: `agent-slack auth whoami` to verify an existing session.

**Used by:** lib (`slack`), workflow (`prioritize`, `deploy-post`)

---

## ddev

Docker-based PHP/Drupal development environment. Required for all drupal-lab skills that run phpcs, phpstan, phpunit, drush, or composer inside containers. Drover uses ddev to reproduce log errors locally.

Install via the [official DDEV docs](https://ddev.readthedocs.io/en/stable/users/install/ddev-installation/):

```bash
brew install ddev/ddev/ddev
```

**Used by:** drupal-lab (all development and validation skills), drover (`add-project`, `triage`, `implement`), lib (`ddev`)

---

## acli (Acquia CLI)

Acquia Cloud Platform CLI. Drover can fall back to `acli` for Acquia log downloads when direct API credentials aren't configured; `lib:log-analyzer` also uses it to fetch logs from Acquia-hosted environments.

```bash
curl -OL https://github.com/acquia/cli/releases/latest/download/acli.phar
chmod +x acli.phar
mv acli.phar /usr/local/bin/acli
acli auth:login
```

**Used by:** drover (optional fallback), lib (`log-analyzer`)

---

## op (1Password CLI)

Used by `lib:testrail` to retrieve the TestRail API key from 1Password. Falls back to macOS Keychain if not available.

Install via the [1Password desktop app](https://developer.1password.com/docs/cli/get-started/) → Preferences → Developer → Enable 1Password CLI.

```bash
op signin
```

**Used by:** lib (`testrail`)

---

## node / npm

Node.js runtime and package manager. Required for installing `gws`, `agent-slack`, `lighthouse`, `pa11y`, and for the `ideate:brainstorm` local UI server.

```bash
brew install node
```

Or use [nvm](https://github.com/nvm-sh/nvm) to manage Node versions.

**Used by:** ideate (`brainstorm` UI server), workflow (via gws/agent-slack), lib (via lighthouse/pa11y)

---

## python3

Python 3 runtime. Used by admin scripts (bump-version, new-skill eval), log analysis, and inline data processing across several skills. Comes pre-installed on macOS.

```bash
python3 --version   # should be 3.8+
```

If missing or outdated:

```bash
brew install python3
```

**Used by:** admin (`bump-version`, `new-skill`), drupal-lab (`module-dev-starter`), ideate (`brainstorm`), lib (`log-analyzer`, `csv-analysis`), workflow (`pulse`)

---

## ffmpeg

Audio and video processing. Used by `lib:ffmpeg` for compression, format conversion, and media inspection.

```bash
brew install ffmpeg
```

**Used by:** lib (`ffmpeg`)

---

## lighthouse

Web performance and accessibility auditing CLI. Used to produce structured JSON scores consumed by `improve` experiments.

```bash
npm i -g lighthouse
```

**Used by:** lib (`lighthouse`), improve (`accessibility-scan`, `perf-measure`)

---

## pa11y

WCAG accessibility audit CLI.

```bash
npm i -g pa11y
```

**Used by:** lib (`pa11y`), improve (`accessibility-scan`)

---

## hyperfine

Command-line benchmarking tool. Produces structured JSON timing results for `improve:perf-measure` experiments.

```bash
brew install hyperfine
```

**Used by:** lib (`hyperfine`), improve (`perf-measure`)

---

## jq / yq

JSON and YAML processors used heavily by drover scripts, ideas-funnel ingest, and several lib skills.

```bash
brew install jq yq
```

**Used by:** drover (scripts), ideas-funnel (`ingest`, `lint`), lib (various)
