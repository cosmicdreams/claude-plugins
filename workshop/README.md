# workshop — Claude Code Workshop Plugin

> Renamed from `workflow` (1.4.0) to avoid colliding with Claude Code's built-in `workflow`. Same skills, new namespace: `workshop:*`. Config moved to `~/.claude/workshop.json`.

Process automation skills. Each skill represents an *intention* — what you want to accomplish — and uses feature detection to compose from whatever integrations the user has available.

Skills read `~/.claude/workshop.json` (written by `workshop:config`) to know what's configured. If config is missing, the skill runs `workshop:config` interactively before proceeding.

## Skills

| Skill | Purpose |
|---|---|
| `workshop:config` | Discover integrations, store config, set defaults |
| `workshop:prioritize` | "What should I work on next?" — ranks Slack/Jira/calendar into one next action (replaces morning-brief + pulse) |
| `workshop:deploy-post` | Post a deployment checklist to Slack |
| `workshop:personal-calendar` | Manage personal Google Calendar |
| `workshop:personal-email` | Manage personal Gmail |
| `workshop:organize` | Categorize and tag notes in the Obsidian vault |
| `workshop:obsidian-lint` | Audit vault notes for frontmatter and link violations |
| `workshop:scout` | Knowledge radar — interest-tuned AI/ecosystem stories that learns from feedback (was ecosystem-pulse) |
| `workshop:knowledge-check` | Keep the human in the loop during AI-assisted work — restate, fill gaps, quiz before moving on (guards against cognitive surrender) |

## Attended PM OS

[Operations and rollout evidence](references/pm-os/operations.md) describe shared context, disabled Briefing task specifications, AHRI triage and observation, and the read-only explore pilot. `python3 scripts/pm_os.py context` reads machine-local context; `python3 scripts/pm_os.py tasks` prints disabled specifications. Registry guards are an attended adapter library, not a daemon or an enabled production integration. The funnel owns scheduling and the shared queue lock.
