#!/bin/bash
# PreCompact hook — sprint plugin
#
# Advisory hook that fires when Claude Code is about to compact context.
# Reminds agents to /compact between kanban cards rather than mid-task.
# Always exits 0 (non-blocking).

cat <<'EOF'
## Context Compaction Advisory

You are about to compact context. If you just finished a kanban card,
this is a good time to compact. If you are mid-card, consider finishing
the current card first, then use /compact before picking up the next one.

Tip: Move the completed card to its next stage and send your status
message BEFORE compacting so that context about the card is preserved.
EOF

exit 0
