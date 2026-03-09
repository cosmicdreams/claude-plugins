# Changelog

## 1.5.0
- Add `office:testrail` skill — TestRail REST API wrapper; reads projects, suites, plans, sections, and cases for Playwright test generation
- Config template: `~/.claude/office-testrail.local.md` with `host`, `username`, `api_key`, `default_project_id`

## 1.4.2
- `office:pulse`: office-pulse.json as source of truth for Slack channel tracking

## 1.4.1
- `office:pulse`: project-level Slack channel override + consolidated channel config

## 1.4.0
- Add `office:morning-brief` skill
- `office:pulse`: Slack integration

## 1.3.0
- Add `office:slack` skill — Slack CLI wrapper via `agent-slack`; reads channels, fetches messages, searches; thin API layer for use by `office:pulse` and `office:morning-brief`
- Config template: `~/.claude/office-slack.local.md` with `channels` and `message_limit` fields

## 1.2.0
- Add `office:personal-email` skill — Gmail via Google Workspace CLI (`gws`)
- Add `office:personal-calendar` skill — Google Calendar via Google Workspace CLI (`gws`)

## 1.1.0
- Add `office:changelog` skill — displays office CHANGELOG with `--latest` and `--since X.Y.Z` filtering

## 1.0.0
- Initial release with 8 skills: email, calendar, jira, github, archive, organize, log-analyzer, vault-store
- `office:email` and `office:calendar` — Outlook mail and calendar via msgcli (`--no-input`)
- `office:jira` — Jira issue and sprint management via jira-cli (`--plain`)
- `office:github` — GitHub PR and issue management via gh CLI, including CI check status and PR merge
- `office:archive` — migrates local .md/.txt files into the Neurons Obsidian vault with user confirmation
- `office:organize` — finds untagged vault notes, applies YAML tags, and moves to appropriate folders
- `office:log-analyzer` — Acquia + Cloudflare log analysis with bundled Python engine; renders ASCII dashboard
- `office:vault-store` — intelligent routing skill: resolves project-vs-shared scope and writes to correct vault path
- Auth-aware router script (`scripts/route.sh`) maps `office <subcommand>` to the correct CLI tool
- All skills: OBSIDIAN_VAULT_NAME env var with full absolute path (`$HOME/Vaults/$VAULT_NAME`)
- PhpStorm scratch files symlinked to `~/Vaults/Neurons/Scratches`
