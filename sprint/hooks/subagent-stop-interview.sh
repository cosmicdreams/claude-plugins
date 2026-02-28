#!/bin/bash
# subagent-stop-interview.sh — sprint plugin
#
# Requires all team sprint agents to complete a graceful shutdown interview
# before allowing them to stop. Gate = team membership, not agent type.
# Uses the two-round stop_hook_active pattern.
#
# Hook input fields (confirmed):
#   .agent_type     = Task `name` param (e.g. "implementer-3393916")
#   .stop_hook_active = bool, true on round 2
#   .last_assistant_message = agent's last message (round 2 only)
#   .agent_id       = short internal UUID (not useful for team lookup)
#   Note: .agent_name is NOT present in hook input — do not use it.

INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT"    | jq -r '.agent_type // ""')
LAST_MSG=$(echo "$INPUT"      | jq -r '.last_assistant_message // ""')
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // "false"')

# Discover sprint_id by finding the team that has an inbox for this agent.
# Inbox files are named after the Task `name` param — same value as agent_type.
# Inbox names are globally unique: two agents in any team cannot share a name.
# Sort by mtime (newest first) so a current sprint always wins over a stale one.
SPRINT_ID=""
if [ -n "$AGENT_TYPE" ]; then
    while IFS= read -r TEAM_DIR; do
        if [ -f "${TEAM_DIR}inboxes/${AGENT_TYPE}.json" ]; then
            SPRINT_ID=$(basename "$TEAM_DIR")
            break
        fi
    done < <(ls -dt "$HOME/.claude/teams"/*/ 2>/dev/null)
fi

# Telemetry: log every invocation
LOG="$HOME/.claude/subagent-stop.log"

if [ -z "$SPRINT_ID" ]; then
    # Not a team agent — no interview required
    printf '[%s] no-team agent_type=%s stop_hook_active=%s pwd=%s\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" \
        "$AGENT_TYPE" "$STOP_HOOK_ACTIVE" "$PWD" >> "$LOG" 2>/dev/null || true
    exit 0
fi

printf '[%s] agent_type=%s sprint_id=%s stop_hook_active=%s pwd=%s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" \
    "$AGENT_TYPE" "$SPRINT_ID" "$STOP_HOOK_ACTIVE" "$PWD" >> "$LOG" 2>/dev/null || true

INTERVIEW_DIR="$PWD/analysis-reports/retro-session/$(date '+%Y-%m-%d')+${SPRINT_ID}/interviews"

# If interview already written this session, skip re-blocking on subsequent idle events.
# Agents write their own interview during the shutdown protocol (before approving
# shutdown_request) — the hook is a backstop for first-time coverage only. Once the file
# exists, the agent-written version takes precedence and the hook steps aside.
if [ "$STOP_HOOK_ACTIVE" != "true" ] && [ -f "${INTERVIEW_DIR}/${AGENT_TYPE}.md" ]; then
    printf '[%s] agent_type=%s sprint_id=%s interview-exists-skip\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" \
        "$AGENT_TYPE" "$SPRINT_ID" >> "$LOG" 2>/dev/null || true
    exit 0
fi

# ROUND 1: Block shutdown and inject interview questions
if [ "$STOP_HOOK_ACTIVE" != "true" ]; then
    PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

    # Build role-specific suffix from interview-templates.md question text
    ROLE_QUESTIONS=""
    case "$AGENT_TYPE" in
      implementer*)
        ROLE_QUESTIONS=" Plus your role-specific questions D1-D3: D1. For the issue you found most challenging: what was the key technical decision you made, what alternatives did you consider and reject, and how confident are you in the result? (Format: Issue / Decision / Rejected alternatives / Confidence: HIGH|MEDIUM|LOW / Risk area if not HIGH.) D2. Looking across ALL issues you worked on this session: what recurring pattern, common root cause, or repeated approach did you notice? (Format: describe the pattern and which issues it appeared in.) D3. What was the single biggest friction point in your workflow -- the thing that slowed you down most? (Format: Friction / Category: TOOLING|COMMUNICATION|TESTING|CONTEXT_SWITCHING|WAITING / Time impact.)"
        ;;
      reviewer*)
        ROLE_QUESTIONS=" Plus your role-specific questions V1-V3: V1. For each issue that failed validation (partially or fully), classify the root cause: CODE_REGRESSION / TEST_DESIGN / INFRASTRUCTURE / HANDOFF_GAP / STANDARDS_ONLY, and give a one-line explanation. V2. What did you catch that the developer couldn't have seen from their side? Rate overall handoff quality: CLEAN / MINOR_GAPS / SIGNIFICANT_REWORK / BLOCKED, and explain if not CLEAN. V3. What DDEV, environment, or tooling friction did you encounter? (Format: Friction encountered / Time impact / Suggestion to prevent it next time.)"
        ;;
      process-improvement*)
        ROLE_QUESTIONS=" Plus your role-specific questions P1-P3: P1. Where did work flow smoothly through the pipeline and where did it stall? Identify the primary bottleneck. (Format O-E-I-R: Observation / Evidence / Impact / Recommendation.) P2. What interaction patterns between agents helped or hurt productivity? Identify the most effective and most problematic interaction. (Format O-E-I-R: Most effective interaction / Most problematic interaction / Recommendation.) P3. Looking across ALL problems this session, what is the deepest root cause you identified -- the one thing that, if fixed, would prevent the most other problems? (Format O-E-I-R: Observation / Evidence / Impact / Recommendation.)"
        ;;
    esac

    cat << EOF
{
  "decision": "block",
  "reason": "Before you shut down, complete your graceful shutdown interview. Answer the 3 common questions C1-C3: C1. What was the single most effective thing this session -- a practice, tool, or interaction that worked well and should be repeated? C2. What non-obvious technical knowledge did you discover this session that would help a future agent working on similar issues? C3. If you could change ONE thing about how the team works for next session, what would it be? (Format: Change / Category: TOOLING|COMMUNICATION|TESTING|WORKFLOW|INFRASTRUCTURE / Expected impact.)${ROLE_QUESTIONS} Answer all questions based on your work this session."
}
EOF
    exit 0
fi

# ROUND 2: Agent has answered. Capture interview and allow stop.
mkdir -p "$INTERVIEW_DIR"
printf '%s\n' "$LAST_MSG" > "$INTERVIEW_DIR/${AGENT_TYPE}.md"

exit 0
