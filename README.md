# claude-plugins

A collection of [Claude Code](https://code.claude.com) plugins for Drupal development, team sprint orchestration, and plugin management tooling.

## Installation

```bash
# Clone the repo
git clone git@github.com:cosmicdreams/claude-plugins.git
cd claude-plugins

# Install each plugin at user scope
claude plugin install admin@local --scope user
claude plugin install drupal-lab@local --scope user
claude plugin install git-ops@local --scope user
claude plugin install sprint@local --scope user
```

## Plugins

### `sprint` v1.3.0
Team sprint execution infrastructure: agents, skills, hooks, protocols, kanban, and retrospectives.

Coordinate parallel agent work across a file-based kanban board with built-in retrospectives and observability hooks.

### `drupal-lab` v1.5.3
Drupal-specific development skills and agents for DDEV, issue analysis, patch validation, and scaffolding.

Purpose-built for contributing to Drupal core and contrib modules within a DDEV environment.

### `admin` v1.1.1
Plugin, agent, and skill management tooling: bump-version, scaffold, new-agent, new-skill, optimize-agents, update-plugins.

Meta-tooling for developing and maintaining Claude Code plugins.

### `git-ops` v1.0.2
Generic Git workflow tools for worktree management and cleanup.

## Author

Chris Weber
