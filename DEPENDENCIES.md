# Dependencies

External CLI tools required by CLAUDE-PLUGINS. Not every plugin needs every tool — check the table below to install only what you need.

## Quick Reference

| Tool | Plugins | Install |
|------|---------|---------|
| [bd (Beads)](#bd-beads) | sprint, retro | `brew install beads` |
| [obsidian CLI](#obsidian-cli) | sprint, retro, ideate, office, drupal-lab | see below |
| [gh (GitHub CLI)](#gh-github-cli) | office | `brew install gh` |
| [gws (Google Workspace CLI)](#gws-google-workspace-cli) | office | `npm i -g @googleworkspace/cli` |
| [jira-cli](#jira-cli) | office | `brew install ankitpokhrel/jira-cli/jira-cli` |
| [agent-slack](#agent-slack) | office | `npm i -g agent-slack` |
| [ddev](#ddev) | drupal-lab | see below |
| [acli (Acquia CLI)](#acli-acquia-cli) | office | see below |
| [op (1Password CLI)](#op-1password-cli) | office | see below |
| [node / npm](#node--npm) | office, ideate | `brew install node` |
| [python3](#python3) | admin, office, ideate, drupal-lab | built-in on macOS |

---

## bd (Beads)

Kanban/issue tracking database. All sprint and retro board operations (`bd list`, `bd create`, `bd update`, etc.) depend on this.

```bash
brew install beads
```

After installing, initialize the board in your project:

```bash
bd init --prefix sprint
```

One `bd init` per project — running it a second time will error if already initialized.

**Used by:** sprint, retro

---

## obsidian CLI

The `obsidian` CLI writes notes into a running Obsidian vault. Skills that archive output (retro reports, ideate brainstorms, Drupal issue analyses, sprint release notes) all call this tool.

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

**Used by:** sprint (`project-notes`), retro (`session`, `interviews`), ideate (all skills), office (`archive`, `organize`, `vault-store`), drupal-lab (`analyze-issue`, `issue-summary`)

---

## gh (GitHub CLI)

GitHub pull request and issue management.

```bash
brew install gh
gh auth login
```

**Used by:** office (`github`)

---

## gws (Google Workspace CLI)

Gmail and Google Calendar access via the Google Workspace API.

```bash
npm i -g @googleworkspace/cli
gws auth setup
```

Follow the setup prompts to connect a Google account. Requires a Google Cloud project with Gmail and Calendar APIs enabled.

**Used by:** office (`personal-email`, `personal-calendar`, `pulse`, `morning-brief`)

---

## jira-cli

Jira issue and sprint management.

```bash
brew install ankitpokhrel/jira-cli/jira-cli
jira init
```

Run `jira init` in your project directory to connect to your Jira instance. Requires a Jira API token.

**Used by:** office (`jira`, `pulse`, `morning-brief`)

---

## agent-slack

Slack CLI for reading channels and searching messages. Read-only — does not send or post.

```bash
npm i -g agent-slack
agent-slack auth import-desktop   # imports token from Slack desktop app
```

Or: `agent-slack auth whoami` to verify an existing session.

**Used by:** office (`slack`, `pulse`, `morning-brief`)

---

## ddev

Docker-based PHP/Drupal development environment. Required for all drupal-lab skills that run phpcs, phpstan, phpunit, drush, or composer inside containers.

Install via the [official DDEV docs](https://ddev.readthedocs.io/en/stable/users/install/ddev-installation/):

```bash
brew install ddev/ddev/ddev
```

**Used by:** drupal-lab (all development and validation skills)

---

## acli (Acquia CLI)

Acquia Cloud Platform CLI. Used by `office:log-analyzer` to fetch logs from Acquia-hosted environments.

```bash
curl -OL https://github.com/acquia/cli/releases/latest/download/acli.phar
chmod +x acli.phar
mv acli.phar /usr/local/bin/acli
acli auth:login
```

**Used by:** office (`log-analyzer`)

---

## op (1Password CLI)

Used by `office:testrail` to retrieve the TestRail API key from 1Password. Falls back to macOS Keychain if not available.

Install via the [1Password desktop app](https://developer.1password.com/docs/cli/get-started/) → Preferences → Developer → Enable 1Password CLI.

```bash
op signin
```

**Used by:** office (`testrail`)

---

## node / npm

Node.js runtime and package manager. Required for installing `gws` and `agent-slack`, and for the `ideate:brainstorm` local UI server.

```bash
brew install node
```

Or use [nvm](https://github.com/nvm-sh/nvm) to manage Node versions.

**Used by:** office (via gws, agent-slack installs), ideate (`brainstorm` UI server)

---

## python3

Python 3 runtime. Used by admin scripts (bump-version, new-skill eval), office log analysis, and inline data processing across several skills. Comes pre-installed on macOS.

```bash
python3 --version   # should be 3.8+
```

If missing or outdated:

```bash
brew install python3
```

**Used by:** admin (`bump-version`, `new-skill`), office (`log-analyzer`, `pulse`), ideate (`brainstorm`), drupal-lab (`module-dev-starter`)
