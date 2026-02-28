#!/bin/bash
# PreToolUse observation hook — sprint plugin
#
# Appends a JSON line to sprint-observations for every tool call.
# Used for post-sprint analysis. Always exits 0 (non-blocking).

INPUT=$(head -c 4096)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"' 2>/dev/null)

SESSION_ID="${CLAUDE_CODE_SESSION_ID:-$(date +%Y%m%d)}"
AGENT_NAME="${CLAUDE_CODE_AGENT_NAME:-unknown}"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

LOG_DIR="$HOME/.claude/sprint-observations"
mkdir -p "$LOG_DIR"

printf '{"ts":"%s","event":"pre_tool_use","tool":"%s","agent":"%s","session":"%s"}\n' \
    "$TS" "$TOOL_NAME" "$AGENT_NAME" "$SESSION_ID" \
    >> "$LOG_DIR/${SESSION_ID}.jsonl"

exit 0
