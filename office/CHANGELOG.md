# Changelog

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
