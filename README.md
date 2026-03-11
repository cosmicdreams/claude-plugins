# claude-plugins

A collection of [Claude Code](https://claude.ai/code) plugins for team sprint orchestration, Drupal development, office productivity, and plugin management tooling.

## Dependencies

Several plugins require external CLI tools (Beads, Obsidian CLI, GitHub CLI, jira-cli, etc.).

**→ See [DEPENDENCIES.md](./DEPENDENCIES.md) for the full install guide.**

## Installation

```bash
# Clone the repo
git clone git@github.com:cosmicdreams/claude-plugins.git
cd claude-plugins/worktrees/main

# Install plugins at user scope
claude plugin install admin@local --scope user
claude plugin install sprint@local --scope user
claude plugin install retro@local --scope user
claude plugin install ideate@local --scope user
claude plugin install office@local --scope user
claude plugin install drupal-lab@local --scope user
```

After installing, initialize the sprint board in your project:

```bash
brew install beads
bd init --prefix sprint
```

## Plugins

### `admin`
Meta-tooling for developing and maintaining Claude Code plugins.

Skills: `bump-version`, `changelog` (universal — accepts any plugin name), `create-worktree`, `new-agent`, `new-skill`, `optimize-agents`, `scaffold`, `update-plugins`, `agent-team`

### `sprint`
Team sprint execution: parallel agents, kanban pipeline, hooks, and protocols.

Skills: `run`, `plan`, `board`, `kanban`, `project-notes`, `asset-audit`, `observe`

### `retro`
End-of-sprint retrospectives: agent interviews, action card management, session reports.

Skills: `session`, `interviews`, `kanban`, `transcript`

### `ideate`
Pre-sprint ideation: brainstorming canvas, research, comparisons, and ADRs.

Skills: `brainstorm`, `research`, `compare`, `diagram`, `adr`

### `office`
Productivity CLI wrappers: email, calendar, Jira, GitHub, Slack, and Obsidian memory layer.

Skills: `personal-email`, `personal-calendar`, `jira`, `github`, `slack`, `pulse`, `morning-brief`, `archive`, `organize`, `vault-store`, `log-analyzer`, `testrail`

### `drupal-lab`
Drupal development: DDEV environment, issue analysis, patch validation, and scaffolding.

Skills: `analyze-issue`, `issue-summary`, `ddev-drupal-dev`, `process-lifecycle`, `module-dev-starter`, `browse-drupal-issues`, `validate-patch`, `finish-issue`

## Changelog

```bash
admin:changelog <plugin>            # e.g. admin:changelog sprint
admin:changelog <plugin> --latest   # most recent version only
```

## Author

Chris Weber
