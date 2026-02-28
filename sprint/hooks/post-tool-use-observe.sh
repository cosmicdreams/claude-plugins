#!/bin/bash
# PostToolUse observation hook — sprint plugin
#
# Appends a JSON line with tool result info to sprint-observations.
# Used for post-sprint analysis. Always exits 0 (non-blocking).

INPUT=$(head -c 4096)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"' 2>/dev/null)
EXIT_CODE=$(echo "$INPUT" | jq -r '.tool_result.exit_code // 0' 2>/dev/null)

SESSION_ID="${CLAUDE_CODE_SESSION_ID:-$(date +%Y%m%d)}"
AGENT_NAME="${CLAUDE_CODE_AGENT_NAME:-unknown}"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

LOG_DIR="$HOME/.claude/sprint-observations"
mkdir -p "$LOG_DIR"

printf '{"ts":"%s","event":"post_tool_use","tool":"%s","agent":"%s","session":"%s","exit_code":%s}\n' \
    "$TS" "$TOOL_NAME" "$AGENT_NAME" "$SESSION_ID" "$EXIT_CODE" \
    >> "$LOG_DIR/${SESSION_ID}.jsonl"

exit 0
