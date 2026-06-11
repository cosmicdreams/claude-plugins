#!/usr/bin/env zsh
# SessionStart hook — sprint plugin
# Injects sprint capability reminder into session context.

PLUGIN_DIR="${CLAUDE_PLUGIN_ROOT}"

cat <<'EOF'
## Team Sprint Capability (sprint)

When asked to run a team sprint or work on issues in parallel:

1. Run sprint:plan to create and sequence beads (if not already done).
2. Run sprint:run to execute — it invokes the Workflow tool with sprint/skills/run/scripts/sprint-run.js.
   The Workflow script reads ready beads, launches one slice-worker per bead, and optionally runs
   cross-review as an adversarial verify stage. Results land in analysis-reports/retro-session/.
3. After sprint: run retro:session to read results.json and generate the retrospective.

No team-lead loop. No SendMessage choreography. The Workflow harness handles parallelism and completion.

EOF

echo "Sprint skill:   $PLUGIN_DIR/skills/run/SKILL.md"
echo "Workflow script: $PLUGIN_DIR/skills/run/scripts/sprint-run.js"
