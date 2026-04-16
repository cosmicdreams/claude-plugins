# lib — Claude Code Library Plugin

CLI wrappers and tool integrations. Each skill teaches Claude how to correctly use a specific CLI tool — flags, auth patterns, gotchas, and common workflows.

`lib` is the data layer: skills here return raw data with no summarization or prioritization. Higher-level plugins (notably `workflow`) compose these into multi-step automations.

## Skills

| Skill | Tool | Purpose |
|---|---|---|
| `lib:slack` | `slack` CLI | Read channels, fetch messages, search conversations |
| `lib:jira` | `jira-cli` | Browse, create, and update Jira issues |
| `lib:github` | `gh` | Manage GitHub PRs, issues, and repos |
| `lib:testrail` | `trcli` | Read projects, suites, test plans, and cases |
| `lib:ddev` | `ddev` | Start/stop DDEV environments and run drush/composer/phpunit inside containers |
| `lib:csv-analysis` | python (pandas) | Statistical analysis of CSV files |
| `lib:log-analyzer` | python | Analyze Acquia/Cloudflare web server logs |
| `lib:image-optimize` | `imagemagick`/`ffmpeg` | Optimize, compress, and convert images |
| `lib:ffmpeg` | `ffmpeg` | Audio/video compression, conversion, trimming, inspection |
| `lib:lighthouse` | `lighthouse` | Performance and accessibility scores in structured JSON |
| `lib:pa11y` | `pa11y` | WCAG accessibility audit in structured JSON |
| `lib:hyperfine` | `hyperfine` | Benchmark a CLI command with structured JSON timing output |
| `lib:vault-search` | `rg` | Graph-aware search across the Obsidian vault |
| `lib:vault-store` | Obsidian REST API | Route and store documents into the vault |
| `lib:wiki-query` | Obsidian REST API | Ask a question against the wiki, get a researched answer filed back |
| `lib:archive` | Obsidian REST API | Migrate local notes into the vault |
