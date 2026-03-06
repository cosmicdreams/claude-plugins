# Plugin Conventions

## Naming rules

- Folder name and `name:` field must match exactly
- kebab-case only: lowercase letters, digits, hyphens
- No spaces, underscores, or capitals
- Cannot start/end with a hyphen or have consecutive hyphens
- Cannot contain "claude" or "anthropic" (reserved)
- File must be exactly `SKILL.md` (case-sensitive)
- No `README.md` inside the skill folder

## Plugin structure

```
<plugin>/
├── .claude-plugin/
│   └── plugin.json       ← manifest
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md
│       ├── references/
│       ├── scripts/
│       └── assets/
├── agents/
│   └── <agent-name>.md
└── hooks/
    └── hooks.json
```

Skills are **auto-discovered** from `skills/*/SKILL.md` — no registration in `plugin.json` needed.

## Plugin paths

Source lives in: `worktrees/main/<plugin>/`
Cache (installed) lives in: `~/.claude/plugins/cache/local/<plugin>/<version>/`

Always edit in `worktrees/main/`. After changes, reinstall:

```bash
claude plugin install <plugin>@local --scope user
```

## Internal paths in scripts

Use `${CLAUDE_PLUGIN_ROOT}` for all plugin-internal references. Never hardcode cache paths — they include a version hash that changes on reinstall.

```bash
# Good
SCRIPT="${CLAUDE_PLUGIN_ROOT}/skills/my-skill/scripts/process.sh"

# Bad — breaks on reinstall
SCRIPT="~/.claude/plugins/cache/local/admin/2.0.0/skills/my-skill/scripts/process.sh"
```

## Installing and verifying

```bash
# Install from local source
claude plugin install <name>@local --scope user

# Verify the skill appears
claude plugin list > /tmp/out.txt 2>&1 && cat /tmp/out.txt

# Note: claude plugin list requires a tty — always redirect to file in scripts
```

## Scopes

- `--scope user` — available in all projects (production-ready skills go here)
- `--scope project` — available in this project only (experimental or project-specific)
