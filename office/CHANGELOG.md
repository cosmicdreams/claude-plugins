# Changelog

## 1.8.0
- `office:pulse` and `office:morning-brief`: `~/.claude/office-pulse.local.md` removed — all configuration now lives in `~/.claude/office-pulse.json` only
- Slack channels are now grouped by workspace: each workspace entry has `url`, `name`, `channels[]`, and optional `keywords[]`
- Keywords are scoped per workspace — global `slack.keywords` removed; add keywords to each workspace independently

## 1.7.0
- `office:csv-analysis`: new skill — auto-analyzes CSV files with pandas/matplotlib/seaborn, generates type-appropriate visualizations and statistical summaries without prompting the user
- `office:image-optimize`: new skill — format-aware image optimization routing to specialist tools (pngquant for PNG, cwebp/avifenc for modern formats, jpegtran for JPEG lossless); ImageMagick as universal fallback; covers JPEG, PNG, WebP, AVIF, GIF, HEIC, TIFF, BMP, ICO, PSD, SVG, APNG; includes batch processing patterns and format conversion recommendations

## 1.6.0
- Removed `office:changelog` — use `admin:changelog office` instead
- `office:pulse`: expanded project config parsing to support additional local override fields
- `office:vault-store`: vault notes now authored in Obsidian Flavored Markdown with required frontmatter (title, date, tags, source) and wikilink guidance

## 1.5.2
- `office:slack`: add explicit read-only exclusion (does not send/post/react); document `#channel` name format gotcha (CLI needs name without `#`); add workspace URL discovery via `whoami`; remove redundant "Get your user ID" subsection
- `office:pulse`: rewrite description to distinguish cross-source triage from single-source queries; remove over-broad triggers ("what's new", "anything urgent"); add "Use pulse when / Use individual skills instead when" decision block; document first-run vs. delta behavior
- `office:morning-brief`: reframe description around morning-routine time-bounded use case; add sibling-skill disambiguation (vs. pulse and slack); tighten over-broad trigger phrases; document office-pulse.json handoff to pulse; fix missing office-pulse.json guard in workflow step

## 1.5.1
- `office:slack`: sharpen description with raw-data-only framing and negative boundaries (vs pulse/morning-brief); add `--workspace` flag to message list and thread commands; add user ID retrieval section under auth
- `office:pulse`: replace missing `scripts/trim-state.py` with inline Python (7-day window trim); expand triggers with "anything urgent", "check pulse", "what's new"
- `office:morning-brief`: expand triggers with "morning briefing", "catch me up", "what did I miss", "overnight activity", "start my day"; clarify sequential channel fetches are intentional (rate limit)

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
