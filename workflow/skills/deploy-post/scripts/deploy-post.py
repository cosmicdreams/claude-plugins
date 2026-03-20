#!/usr/bin/env python3
"""
Deployment checklist manager for Slack.

Usage:
  deploy-post.py init <channel> [--release <val>] [--prev-tag <val>] [--workspace <url>]
  deploy-post.py done <step>     — mark step complete (:white_check_mark:)
  deploy-post.py start <step>    — mark step in progress (:loading:)
  deploy-post.py undo <step>     — reset step to pending
  deploy-post.py status          — print current state to terminal
  deploy-post.py reset           — clear saved state
"""

import sys
import json
import os
import subprocess
import re
from pathlib import Path

STATE_FILE = Path.home() / ".deploy-post-state.json"

PLUGIN_ROOT = os.environ.get(
    "CLAUDE_PLUGIN_ROOT",
    str(Path(__file__).resolve().parent.parent.parent)
)
TEMPLATE_FILE = Path(PLUGIN_ROOT) / "skills" / "deploy-post" / "assets" / "checklist.tpl"

STEPS = [
    "develop",
    "staging",
    "backup",
    "approved",
    "precheck",
    "email",
    "maint-on",
    "deploy",
    "search",
    "testing",
    "maint-off",
    "uat",
    "merge-main",
    "merge-develop",
]

STEP_LABELS = {
    "develop":      "Tested on develop",
    "staging":      "Tested on staging",
    "backup":       "Back up database",
    "approved":     "Launch approved",
    "precheck":     "Pre-deployment check",
    "email":        "Email sent to client",
    "maint-on":     "Put site in maintenance mode",
    "deploy":       "Deploy staged code",
    "search":       "Rebuild search index",
    "testing":      "Manual testing",
    "maint-off":    "Take site out of maintenance mode",
    "uat":          "User acceptance",
    "merge-main":   "Merge to main",
    "merge-develop": "Merge to develop",
}

# Aliases for ergonomic step references
STEP_ALIASES = {
    "maintenance-on":   "maint-on",
    "maintenance-off":  "maint-off",
    "maintenance_on":   "maint-on",
    "maintenance_off":  "maint-off",
    "manual-test":      "testing",
    "manual_test":      "testing",
    "manual":           "testing",
    "user-acceptance":  "uat",
    "acceptance":       "uat",
    "merge_main":       "merge-main",
    "merge_develop":    "merge-develop",
}


def icon(step, status):
    if status == "done":
        return ":white_check_mark:"
    if status == "doing":
        return ":loading:"
    # pending
    if step == "uat":
        return ":rocket:"
    return ":white_square:"


def render(state):
    template = TEMPLATE_FILE.read_text()
    for step in STEPS:
        status = state["steps"].get(step, "pending")
        placeholder = "{" + step + "}"
        template = template.replace(placeholder, icon(step, status))
    template = template.replace("{RELEASE}", state["release"])
    template = template.replace("{PREV_TAG}", state["prev_tag"])
    return template


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return None


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def run_slack(*args):
    return subprocess.run(
        ["agent-slack"] + list(args),
        capture_output=True,
        text=True,
    )


def get_ts_after_post(channel, workspace=None):
    """Fetch the ts of the most recently posted message in channel."""
    args = ["message", "list", f"#{channel}", "--limit", "1"]
    if workspace:
        args += ["--workspace", workspace]
    result = run_slack(*args)
    if result.returncode != 0:
        return None
    try:
        msgs = json.loads(result.stdout)
        if msgs:
            return msgs[0].get("ts")
    except (json.JSONDecodeError, IndexError, KeyError):
        pass
    return None


def edit_message(state, text):
    channel = state["channel"]
    ts = state["message_ts"]
    workspace = state.get("workspace")
    args = ["message", "edit", f"#{channel}", "--ts", ts, text]
    if workspace:
        args += ["--workspace", workspace]
    result = run_slack(*args)
    if result.returncode != 0:
        print(f"  Slack edit failed: {result.stderr.strip()}", file=sys.stderr)
        return False
    return True


def resolve_step(name):
    name = name.lower().strip()
    if name in STEP_ALIASES:
        name = STEP_ALIASES[name]
    if name in STEPS:
        return name
    # Try prefix match
    matches = [s for s in STEPS if s.startswith(name)]
    if len(matches) == 1:
        return matches[0]
    return None


def print_status(state):
    print(f"\nDeployment: {state['release']}  |  Previous: {state['prev_tag']}")
    print(f"Channel:    #{state['channel']}")
    ts = state.get("message_ts")
    print(f"Message ts: {ts or '(not captured — cannot edit Slack post)'}")
    print()
    for step in STEPS:
        status = state["steps"].get(step, "pending")
        label = STEP_LABELS.get(step, step)
        sym = {"done": "✅", "doing": "⏳", "pending": "⬜"}.get(status, "?")
        if step == "uat" and status == "pending":
            sym = "🚀"
        print(f"  {sym}  {step:<14}  {label}")
    print()


def cmd_init(args):
    # Parse args: channel [--release <val>] [--prev-tag <val>] [--workspace <url>]
    workspace = None
    release = None
    prev_tag = None
    positional = []
    i = 0
    while i < len(args):
        a = args[i]
        if a.startswith("--release="):
            release = a.split("=", 1)[1]
            i += 1
        elif a == "--release" and i + 1 < len(args):
            release = args[i + 1]; i += 2
        elif a.startswith("--prev-tag=") or a.startswith("--prev_tag="):
            prev_tag = a.split("=", 1)[1]; i += 1
        elif (a == "--prev-tag" or a == "--prev_tag") and i + 1 < len(args):
            prev_tag = args[i + 1]; i += 2
        elif a.startswith("--workspace="):
            workspace = a.split("=", 1)[1]; i += 1
        elif a == "--workspace" and i + 1 < len(args):
            workspace = args[i + 1]; i += 2
        else:
            positional.append(a); i += 1

    if not positional:
        print("Usage: deploy-post init <channel> [--release <val>] [--prev-tag <val>] [--workspace <url>]", file=sys.stderr)
        sys.exit(1)

    channel = positional[0].lstrip("#")
    release = release or "release/TBD"
    prev_tag = prev_tag or "tags/TBD"

    state = {
        "channel": channel,
        "release": release,
        "prev_tag": prev_tag,
        "workspace": workspace,
        "message_ts": None,
        "steps": {step: "pending" for step in STEPS},
    }

    message = render(state)

    send_args = ["message", "send", f"#{channel}", message]
    if workspace:
        send_args += ["--workspace", workspace]

    result = run_slack(*send_args)
    if result.returncode != 0:
        print(f"Failed to post message: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)

    # Capture the ts by fetching the most recent message
    ts = get_ts_after_post(channel, workspace)
    if ts:
        state["message_ts"] = ts
        print(f"Posted to #{channel} (ts: {ts})")
        print("Future 'done' and 'start' calls will edit this Slack post.")
    else:
        print(f"Posted to #{channel} (warning: could not capture message ts)")
        print("You can set it manually: edit ~/.deploy-post-state.json and add the ts from Slack.")

    save_state(state)


def cmd_done(args):
    if not args:
        print("Usage: deploy-post done <step>", file=sys.stderr)
        sys.exit(1)
    state = load_state()
    if not state:
        print("No active deployment. Run 'init' first.", file=sys.stderr)
        sys.exit(1)
    step = resolve_step(args[0])
    if not step:
        print(f"Unknown step: '{args[0]}'", file=sys.stderr)
        print(f"Valid steps: {', '.join(STEPS)}", file=sys.stderr)
        sys.exit(1)

    state["steps"][step] = "done"
    message = render(state)

    if state.get("message_ts"):
        if edit_message(state, message):
            print(f"✅ '{step}' marked done — Slack post updated")
        else:
            print(f"✅ '{step}' marked done locally (Slack edit failed — see above)")
    else:
        print(f"✅ '{step}' marked done locally (no message ts — Slack post not updated)")

    save_state(state)


def cmd_start(args):
    if not args:
        print("Usage: deploy-post start <step>", file=sys.stderr)
        sys.exit(1)
    state = load_state()
    if not state:
        print("No active deployment. Run 'init' first.", file=sys.stderr)
        sys.exit(1)
    step = resolve_step(args[0])
    if not step:
        print(f"Unknown step: '{args[0]}'", file=sys.stderr)
        print(f"Valid steps: {', '.join(STEPS)}", file=sys.stderr)
        sys.exit(1)

    state["steps"][step] = "doing"
    message = render(state)

    if state.get("message_ts"):
        if edit_message(state, message):
            print(f"⏳ '{step}' marked in progress — Slack post updated")
        else:
            print(f"⏳ '{step}' marked in progress locally (Slack edit failed — see above)")
    else:
        print(f"⏳ '{step}' marked in progress locally (no message ts)")

    save_state(state)


def cmd_undo(args):
    if not args:
        print("Usage: deploy-post undo <step>", file=sys.stderr)
        sys.exit(1)
    state = load_state()
    if not state:
        print("No active deployment. Run 'init' first.", file=sys.stderr)
        sys.exit(1)
    step = resolve_step(args[0])
    if not step:
        print(f"Unknown step: '{args[0]}'", file=sys.stderr)
        sys.exit(1)

    state["steps"][step] = "pending"
    message = render(state)

    if state.get("message_ts"):
        if edit_message(state, message):
            print(f"⬜ '{step}' reset to pending — Slack post updated")
        else:
            print(f"⬜ '{step}' reset locally (Slack edit failed)")
    else:
        print(f"⬜ '{step}' reset locally")

    save_state(state)


def cmd_status(_args):
    state = load_state()
    if not state:
        print("No active deployment state found. Run 'init' to start.", file=sys.stderr)
        sys.exit(1)
    print_status(state)


def cmd_reset(_args):
    if STATE_FILE.exists():
        STATE_FILE.unlink()
        print("Deployment state cleared.")
    else:
        print("No state file found.")


COMMANDS = {
    "init":   cmd_init,
    "done":   cmd_done,
    "start":  cmd_start,
    "undo":   cmd_undo,
    "status": cmd_status,
    "reset":  cmd_reset,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        available = ", ".join(COMMANDS.keys())
        print(f"Usage: deploy-post.py <command> [args]", file=sys.stderr)
        print(f"Commands: {available}", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]
    COMMANDS[cmd](sys.argv[2:])
