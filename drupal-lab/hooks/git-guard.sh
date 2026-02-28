#!/usr/bin/env bash
# git-guard.sh — blocks git add, git commit, and git push from agent Bash tool calls.
# Agents must not commit or push directly. Only the team-lead or user may do so.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Only intercept Bash tool calls
[ "$TOOL_NAME" = "Bash" ] || exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

if echo "$COMMAND" | grep -qE '(^|[;&|]|\s)git\s+(add|commit|push)(\s|$)'; then
    echo "BLOCKED by git-guard: agents may not run 'git add', 'git commit', or 'git push'." >&2
    echo "Stage and commit changes by asking the team-lead or user." >&2
    exit 2
fi

exit 0
