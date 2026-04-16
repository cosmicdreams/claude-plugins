#!/usr/bin/env bash
# SessionStart hook — sprint plugin
#
# Injects team-lead capability reminder into Claude's session context.
# Runs at the start of every Claude Code session where sprint is active.

PLUGIN_DIR="${CLAUDE_PLUGIN_ROOT}"

cat <<'EOF'
## Team Sprint Capability (sprint)

When asked to run a team sprint, work on issues in parallel, or coordinate multiple agents:
YOU are the team-lead. Do not spawn a separate team-lead agent.

Every turn:
1. TaskList — who has no in_progress task?
2. Run: bd ready -l board-sprint --json --unassigned | jq '.[].id'
3. Push task assignment immediately via SendMessage
4. Spin down agents whose pipeline stage is complete
5. Reassign or replace unresponsive agents after 2 turns

Spawn agents with the Task tool. Multiple calls in the same message run in parallel:
  Task(subagent_type="drupal-lab:implementer", name="implementer-1", prompt="...")
  Task(subagent_type="drupal-lab:implementer", name="implementer-2", prompt="...")

If N issues are parallelizable, spawn N agents at once — never sequentially.

EOF

echo "Full protocol:    $PLUGIN_DIR/skills/run/SKILL.md"
echo "Spawning guide:   $PLUGIN_DIR/protocols/SPAWNING.md"
echo "Decision rules:   $PLUGIN_DIR/skills/run/references/decision-framework.md"
