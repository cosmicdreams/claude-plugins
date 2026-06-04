# claude-plugins

A collection of [Claude Code](https://claude.ai/code) plugins covering team sprint orchestration, Drupal development, process engineering, passive knowledge capture, and meta-tooling for plugin authoring.

## Dependencies

Several plugins require external CLI tools (Beads, Obsidian CLI, GitHub CLI, jira-cli, ddev, etc.).

**→ See [DEPENDENCIES.md](./DEPENDENCIES.md) for the full install guide.**

## Installation

```bash
# Clone the repo
git clone git@github.com:cosmicdreams/claude-plugins.git
cd claude-plugins/worktrees/main

# Install plugins at user scope
claude plugin install admin@local        --scope user
claude plugin install sprint@local       --scope user
claude plugin install retro@local        --scope user
claude plugin install ideate@local       --scope user
claude plugin install drupal-lab@local   --scope user
claude plugin install lib@local          --scope user
claude plugin install workflow@local     --scope user
claude plugin install drover@local       --scope user
claude plugin install research-lab@local --scope user
claude plugin install improve@local      --scope user
claude plugin install ideas-funnel@local --scope user
```

After installing, initialize the sprint board in your project:

```bash
brew install beads
bd init --prefix sprint
```

## Plugins

### `admin`
Meta-tooling for developing and maintaining Claude Code plugins.

Skills: `agent-team`, `bump-version`, `changelog`, `create-worktree`, `install`, `new-agent`, `new-skill`, `optimize-agents`, `scaffold`, `scaffold-silence`, `update-plugins`

### `sprint`
Team sprint execution: parallel agents, kanban pipeline, hooks, protocols.

Skills: `asset-audit`, `board`, `kanban`, `plan`, `project-notes`, `run`

### `retro`
End-of-sprint retrospectives: agent interviews via SubagentStop hook, action card management, session reports.

Skills: `interviews`, `kanban`, `session`, `transcript`

### `ideate`
Pre-work ideation: brainstorm canvas, deep research, structured comparison, reality checks, diagrams, ADRs.

Skills: `adr`, `brainstorm`, `compare`, `diagram`, `reality-check`, `research`, `understand`

### `drupal-lab`
Drupal development against DDEV: issue analysis, patch validation, contrib module scaffolding, performance profiling.

Skills: `analyze-issue`, `browse-drupal-issues`, `config`, `ddev`, `finish-issue`, `issue-summary`, `module-dev-starter`, `perf-measure`, `process-lifecycle`, `validate-patch`

### `lib`
Thin CLI-wrapper skills (data-layer only — no summarization). Slack, Jira, GitHub, TestRail, Obsidian vault, logs, and media utilities.

Skills: `archive`, `csv-analysis`, `ddev`, `ffmpeg`, `github`, `hyperfine`, `image-optimize`, `jira`, `lighthouse`, `log-analyzer`, `pa11y`, `slack`, `testrail`, `vault-search`, `vault-store`, `wiki-query`

### `workflow`
Process automation built on top of `lib`: work prioritization, deploy checklist, knowledge radar, Obsidian maintenance, calendar/email helpers.

Skills: `config`, `deploy-post`, `obsidian-lint`, `organize`, `personal-calendar`, `personal-email`, `prioritize`, `scout`

### `drover`
Automated Drupal error monitoring and self-healing pipeline. Watches logs, triages errors into curated Beads tickets, autonomously implements fixes in isolated git worktrees, notifies on ready-for-review.

Skills: `add-project`, `backfill`, `baseline`, `board`, `dashboard`, `implement`, `reset-state`, `run`, `setup`, `triage`, `watch`

### `research-lab`
Composable research engagement pipeline: literary review via NotebookLM, multi-agent workshop swarms, cross-examination seminars, and iterative experimentation with ratchet-based optimization.

Skills: `experiment`, `literary-review`, `run`, `seminar`, `workshop`

### `improve`
Process engineering methodology. Maps process topology, makes directed fixes, runs improvement experiments, accumulates lint rules. Domain-agnostic — each plugin can own its own `:improve` skill for domain-specific knowledge.

Skills: `accessibility-scan`, `attach`, `experiment`, `fix`, `lint`, `perf-measure`, `self`

### `ideas-funnel`
Passive knowledge capture pipeline — Karpathy-derived LLM Wiki with Monitor-driven multi-domain ingest. Feeds land in `Raw/`, agents compile them into a cross-linked Obsidian wiki, memory evolves via confidence decay and graph-aware consolidation.

Skills: `ingest`, `init`, `lint`, `query`

## Changelog

```bash
admin:changelog <plugin>            # e.g. admin:changelog sprint
admin:changelog <plugin> --latest   # most recent version only
```

## Author

Chris Weber
