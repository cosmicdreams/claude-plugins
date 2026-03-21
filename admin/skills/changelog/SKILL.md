---
name: changelog
description: >
  Display the changelog for any installed plugin. Use whenever the user asks about a changelog,
  version history, or release notes — for ANY plugin. First argument is the plugin name.
  Optional filter: --latest, --since X.Y.Z, or X.Y.Z for a specific version.
  Examples: "sprint changelog", "what's new in retro", "ideate changes since 2.0.0".
  When no plugin is specified, list available plugins and ask the user to choose.
allowed-tools: Bash
---

# admin:changelog — Plugin Changelog

Display the CHANGELOG for any installed plugin.

## Arguments

`$ARGUMENTS` format: `<plugin-name> [filter]`

| Example | Behavior |
|---------|----------|
| `sprint` | Full sprint CHANGELOG |
| `retro --latest` | Most recent retro version only |
| `ideate --since 2.0.0` | ideate changes after 2.0.0 |
| `admin 2.1.0` | Specific admin version section |
| *(none)* | List available plugins, ask user to choose |

Valid plugin names: `admin`, `sprint`, `retro`, `ideate`, `office`, `lib`, `workflow`, `drupal-lab`, `drover`, `research-lab`, `improve`

## Procedure

Parse `$ARGUMENTS` to extract plugin name and filter:

```bash
ARGS="${ARGUMENTS:-}"
PLUGIN=$(echo "$ARGS" | awk '{print $1}')
FILTER=$(echo "$ARGS" | cut -s -d' ' -f2-)
```

If `$PLUGIN` is empty, list what's installed and stop:

```bash
echo "Available plugins:"
ls "$(dirname "$(dirname "${CLAUDE_PLUGIN_ROOT}")")" 2>/dev/null | sort
```

Tell the user: "Which plugin's changelog would you like? E.g.: `admin:changelog sprint`"

Otherwise run:

```bash
bash "${CLAUDE_SKILL_DIR}/read-changelog.sh" "$PLUGIN" "${CLAUDE_PLUGIN_ROOT}" "${FILTER}"
```

Print the script output exactly as-is — no summarizing, no reformatting.

## Filters

| Argument | Behavior |
|----------|----------|
| *(none)* | Full CHANGELOG |
| `--latest` | Most recent version section only |
| `--since X.Y.Z` | All versions after X.Y.Z (exclusive) |
| `X.Y.Z` | That specific version's section |

## Usage by agents

Use `--since <known-version>` to find what changed since a prior encounter:

> `admin:changelog sprint --since 2.5.0`
