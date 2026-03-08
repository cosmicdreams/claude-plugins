# office — Claude Code Office Productivity Plugin

A Claude Code plugin that wraps common office productivity CLI tools — email, calendar, project management, GitHub, and note-taking — into a unified skill interface.

## What It Does

The `office` plugin routes natural-language requests to the right underlying CLI tool and provides Claude skills for guided, multi-step workflows.

| Skill | Tool | Purpose |
|---|---|---|
| `office:email` | `msgcli` | Read, search, and send Outlook email |
| `office:calendar` | `msgcli` | View and manage Outlook calendar events |
| `office:jira` | `jira-cli` | Browse, create, and update Jira issues |
| `office:github` | `gh` | Manage GitHub PRs, issues, and repos |
| `office:archive` | Obsidian REST API | Migrate local notes into your Obsidian vault |
| `office:organize` | Obsidian REST API | Categorize and tag notes in your Obsidian vault |
| `office:log-analyzer` | (built-in) | Analyze Acquia/Cloudflare log files |

## Development Phases

- **Phase 1 (current)**: Plugin skeleton — manifest, directory structure, router script, config stub
- **Phase 2**: Core skills — `office:email`, `office:calendar`, `office:jira`, `office:github` with SKILL.md and supporting scripts
- **Phase 3**: Vault skills — `office:archive` and `office:organize` with Obsidian REST API integration
- **Phase 4**: Log analyzer — `office:log-analyzer` with Acquia/Cloudflare log parsing

## Required Dependencies

Install these tools before using the corresponding skills:

- **msgcli** — Microsoft 365 email and calendar CLI
  - Install: follow msgcli documentation
  - Auth: `msgcli auth add`

- **jira-cli** — Jira issue management CLI
  - Install: `brew install ankitpokhrel/jira-cli/jira-cli` (macOS)
  - Auth: `jira init`

- **gh** — GitHub CLI
  - Install: `brew install gh` (macOS)
  - Auth: `gh auth login`

- **Obsidian** with Local REST API plugin (for `office:archive` and `office:organize`)
  - Install Obsidian: https://obsidian.md
  - Enable community plugin: Settings > Community Plugins > Local REST API

## Configuration

Run the init script once to create the config file:

```bash
bash office/scripts/init-config.sh
```

Then edit `~/.config/office/config`:

```bash
# office plugin configuration
OBSIDIAN_VAULT_NAME=MyVault
```

The `OBSIDIAN_VAULT_NAME` variable is required for the `office:archive` and `office:organize` skills. It can also be set as an environment variable before invoking those skills.

## Router Script

`office/scripts/route.sh` is the entry-point dispatcher. It:

1. Reads `OBSIDIAN_VAULT_NAME` from `~/.config/office/config` if not set in the environment
2. Routes the subcommand to the appropriate CLI tool
3. Catches exit code 2 from any tool and prints auth guidance
4. Prints usage help for unrecognized subcommands

```bash
# Examples
office email list --unread
office calendar show --today
office jira issue list --project MYPROJ
office github pr list
office help
```
