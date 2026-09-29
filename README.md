# claude-plugins

A collection of [Claude Code](https://claude.ai/code) plugins covering Drupal development, process engineering, passive knowledge capture, and meta-tooling for plugin authoring.

## Dependencies

Several plugins need external tools, runtimes, or credentials (Beads, Obsidian, GitHub, twg, ddev, Figma, Playwright, and more).

**→ See [DEPENDENCIES.md](./DEPENDENCIES.md): a per-plugin table of what is required and what is optional, then install steps for each one.**

## Installation

```bash
# Clone the repo
git clone git@github.com:cosmicdreams/claude-plugins.git
cd claude-plugins/worktrees/main

# Install plugins at user scope
claude plugin install admin@local        --scope user
claude plugin install ideate@local       --scope user
claude plugin install drupal-lab@local   --scope user
claude plugin install lib@local          --scope user
claude plugin install workshop@local     --scope user
claude plugin install drover@local       --scope user
claude plugin install research-lab@local --scope user
claude plugin install process-lab@local  --scope user
claude plugin install ideas-funnel@local --scope user
claude plugin install design-lab@local   --scope user
claude plugin install test-lab@local     --scope user
```

## Plugins

### `admin`
Meta-tooling for developing and maintaining Claude Code plugins.

Skills: `agent-team`, `bump-version`, `changelog`, `create-worktree`, `install`, `new-agent`, `new-skill`, `optimize-agents`, `scaffold`, `update-plugins`

### `ideate`
Pre-work ideation: brainstorm canvas, structured comparison, reality checks, diagrams, ADRs.

Skills: `adr`, `brainstorm`, `compare`, `diagram`, `reality-check`

### `drupal-lab`
Drupal development against DDEV: issue analysis, patch validation, contrib module scaffolding, performance profiling.

Skills: `analyze-issue`, `branch-audit`, `browse-drupal-issues`, `config`, `ddev`, `finish-issue`, `issue-summary`, `module-dev-starter`, `optimize`, `perf-measure`, `process-lifecycle`, `release-cut`, `sprint-start`, `validate-patch`

### `lib`
Thin CLI-wrapper skills (data-layer only — no summarization). Slack, Jira, GitHub, TestRail, Obsidian vault, logs, and media utilities.

Skills: `archive`, `babysit-pr`, `csv-analysis`, `ddev`, `ffmpeg`, `github`, `hyperfine`, `image-optimize`, `jira`, `leave-pr-comment`, `lighthouse`, `log-analyzer`, `pa11y`, `penpot`, `slack`, `testrail`, `upload-to-pr`, `vault-search`, `vault-store`, `wiki-query`

### `workshop`
Process automation built on top of `lib`: work prioritization, deploy checklist, knowledge radar, Obsidian maintenance, calendar/email helpers.

Skills: `config`, `deploy-post`, `obsidian-lint`, `organize`, `personal-calendar`, `personal-email`, `prioritize`, `scout`, `knowledge-check`

### `drover`
Drupal and Acquia log reporting. Fetches Acquia logs by date, groups errors into fingerprints, diagnoses causes, and renders a calendar-month report as a web page, a Portable Document Format file, or markdown, plus an evidence file that `process-lab:recommend-tickets` turns into Jira ticket recommendations.

Skills: `acquia-pull`, `init`, `report`

### `research-lab`
Composable research pipeline built around seven knowledge-work verbs: frame, gather, understand, synthesize, interrogate, experiment, teach.

Skills: `experiment`, `frame`, `gather`, `interrogate`, `synthesize`, `teach`, `understand`

### `process-lab`
Keeps agent-assisted work aligned with each project's workflow: reads its Confluence process, records required steps and waivers, and runs retrospectives against it.

Skills: `initialize`, `lint`, `advance`, `retro`, `codify`, `recommend-tickets`

### `ideas-funnel`
Passive knowledge capture pipeline — Karpathy-derived LLM Wiki with Fable-supervised singleton Workflow, cost-aware worker delegation, bounded ingest, confidence decay, graph-aware consolidation, and Obsidian wiki output.

Skills: `decay`, `delegate`, `funnel-export`, `ingest`, `init`, `lint`, `query`, `rescue`, `schedule`, `stats`, `supervise`

### `design-lab`
Build and maintain a Figma component library from a codebase. Pluggable component, token, and usage sources — Site Studio, Single Directory Components, and others.

Skills: `capture`, `detect`, `figma-component`, `figma-foundation`, `figma-index`, `inventory`, `plan`, `tokens`, `usage`, `verify`

### `test-lab`
Convert a manual test corpus into an automated Playwright suite and measure accessibility and performance. The source is a plug point — TestRail today, another tool later — held separately from the authoring methodology, which is derived from a head of Quality Assurance review of a real suite.

Skills: `accessibility-scan`, `automate`, `ingest`, `perf-measure`

## Changelog

```bash
admin:changelog <plugin>            # e.g. admin:changelog admin
admin:changelog <plugin> --latest   # most recent version only
```

## Author

Chris Weber
