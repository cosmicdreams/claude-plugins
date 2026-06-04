# workflow — Claude Code Workflow Plugin

Process automation skills. Each skill represents an *intention* — what you want to accomplish — and uses feature detection to compose from whatever integrations the user has available.

Skills read `~/.claude/workflow.json` (written by `workflow:config`) to know what's configured. If config is missing, the skill runs `workflow:config` interactively before proceeding.

## Skills

| Skill | Purpose |
|---|---|
| `workflow:config` | Discover integrations, store config, set defaults |
| `workflow:prioritize` | "What should I work on next?" — ranks Slack/Jira/calendar into one next action (replaces morning-brief + pulse) |
| `workflow:deploy-post` | Post a deployment checklist to Slack |
| `workflow:personal-calendar` | Manage personal Google Calendar |
| `workflow:personal-email` | Manage personal Gmail |
| `workflow:organize` | Categorize and tag notes in the Obsidian vault |
| `workflow:obsidian-lint` | Audit vault notes for frontmatter and link violations |
| `workflow:scout` | Knowledge radar — interest-tuned AI/ecosystem stories that learns from feedback (was ecosystem-pulse) |
| `workflow:knowledge-check` | Keep the human in the loop during AI-assisted work — restate, fill gaps, quiz before moving on (guards against cognitive surrender) |
