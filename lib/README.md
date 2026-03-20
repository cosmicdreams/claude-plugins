# lib — Claude Code Library Plugin

CLI wrappers and tool integrations. Each skill teaches Claude how to correctly use a specific CLI tool — flags, auth patterns, gotchas, and common workflows.

## Skills

| Skill | Tool | Purpose |
|---|---|---|
| `lib:slack` | `slack` CLI | Read channels, fetch messages, search conversations |
| `lib:jira` | `jira-cli` | Browse, create, and update Jira issues |
| `lib:github` | `gh` | Manage GitHub PRs, issues, and repos |
| `lib:testrail` | `trcli` | Read projects, suites, test plans, and cases |
| `lib:csv-analysis` | built-in | Statistical analysis of CSV files |
| `lib:log-analyzer` | built-in | Analyze Acquia/Cloudflare web server logs |
| `lib:image-optimize` | `imagemagick`/`ffmpeg` | Optimize, compress, and convert images |
| `lib:vault-search` | `rg` | Graph-aware search across the Obsidian vault |
| `lib:vault-store` | Obsidian REST API | Route and store documents into the vault |
| `lib:archive` | Obsidian REST API | Migrate local notes into the vault |

## Scripts

- `scripts/auth-check.sh` — shared auth error handler for CLI tools
