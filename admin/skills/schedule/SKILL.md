---
name: schedule
description: Manage OS-level scheduled tasks via macOS launchd. Use when creating, listing, enabling, disabling, deleting, or viewing logs for scheduled tasks. Also use to launch the schedule web UI dashboard. Subcommands: create (guided plist generation), list, show, enable, disable, delete, logs, ui. Trigger phrases: "schedule a task", "create a scheduled task", "list scheduled tasks", "show my schedule", "disable a task", "enable a task", "delete a scheduled task", "view task logs", "open schedule ui", "scheduled tasks dashboard", "/admin:schedule". NOT for npm/cron/systemd or non-macOS schedulers.
triggers:
  - "schedule a task"
  - "create a scheduled task"
  - "list scheduled tasks"
  - "show my schedule"
  - "scheduled tasks"
  - "launchd"
  - "schedule ui"
  - "admin:schedule"
allowed-tools: Bash, Read, Write
---

# admin:schedule — Launchd Task Manager

Manage macOS launchd scheduled tasks under the `com.chrisweber.*` namespace.

All tasks live as plist files in `~/Library/LaunchAgents/`. Logs go to `~/.claude/logs/schedule/`.

## Subcommand Routing

Read `$ARGUMENTS`. The first word is the subcommand. Route accordingly:

| Subcommand | Action |
|---|---|
| `create` | Run the [Create flow](#create-flow) below |
| `list` | Run `${CLAUDE_PLUGIN_ROOT}/skills/schedule/scripts/schedule-list.sh` |
| `show <name>` | Run `${CLAUDE_PLUGIN_ROOT}/skills/schedule/scripts/schedule-show.sh <name>` |
| `enable <name>` | Run `${CLAUDE_PLUGIN_ROOT}/skills/schedule/scripts/schedule-enable.sh <name>` |
| `disable <name>` | Run `${CLAUDE_PLUGIN_ROOT}/skills/schedule/scripts/schedule-disable.sh <name>` |
| `delete <name>` | Run `${CLAUDE_PLUGIN_ROOT}/skills/schedule/scripts/schedule-delete.sh <name>` |
| `logs <name>` | Run `${CLAUDE_PLUGIN_ROOT}/skills/schedule/scripts/schedule-logs.sh <name>` |
| `ui` | Run the [UI flow](#ui-flow) below |
| _(none)_ | Show usage summary with all subcommands |

For simple operations, run the script and display its output. If the script exits non-zero, show the error and suggest `list` to verify the task name.

---

## Create Flow

Gather these values interactively if not supplied in `$ARGUMENTS`:

| Field | Description | Example |
|---|---|---|
| `name` | Short slug, no spaces | `email-monitor` |
| `type` | `prompt`, `skill`, or `script` | `skill` |
| `command` | The prompt text, skill invocation, or shell command | `/office:email check for urgent messages` |
| `interval` | How often to run | `15m`, `1h`, `30s` |
| `label` | launchd label (auto-suggested) | `com.chrisweber.email-monitor` |

### Type → ProgramArguments mapping

**prompt** — natural language, Claude resolves it:
```
/usr/local/bin/claude -p "<command>"
```

**skill** — explicit skill invocation:
```
/usr/local/bin/claude -p "<command>"
```
(Same as prompt — Claude Code handles skill resolution from the prompt text.)

**script** — arbitrary shell command, no Claude involved:
```
/bin/zsh -c "<command>"
```

### Interval → seconds

| Input | Seconds |
|---|---|
| `30s` | 30 |
| `5m` | 300 |
| `1h` | 3600 |
| `2h30m` | 9000 |

### Generate and install

1. Ensure log directory exists: `mkdir -p ~/.claude/logs/schedule`

2. Write plist to `~/Library/LaunchAgents/<label>.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <!-- one <string> per argument -->
    </array>
    <key>StartInterval</key>
    <integer>{seconds}</integer>
    <key>StandardOutPath</key>
    <string>/Users/Chris.Weber/.claude/logs/schedule/{name}.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/Chris.Weber/.claude/logs/schedule/{name}.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>/Users/Chris.Weber</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
```

3. Register with launchd:
```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<label>.plist
```

4. Confirm to the user:
```
Created: com.chrisweber.<name>
Interval: every <interval>
Plist: ~/Library/LaunchAgents/<label>.plist
Logs: ~/.claude/logs/schedule/<name>.log
```

---

## UI Flow

The web UI shows all `com.chrisweber.*` tasks with status, last run, and a log viewer.

1. Ensure log directory exists: `mkdir -p ~/.claude/logs/schedule`

2. Launch the server:
```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/schedule/scripts/schedule-ui.py
```

3. Open the browser:
```bash
open http://localhost:7474
```

4. Tell the user the UI is running at `http://localhost:7474` and to press Ctrl+C in the terminal to stop it.

The server runs in the foreground. Use `run_in_background: true` on the Bash tool call so Claude doesn't block waiting for it.
