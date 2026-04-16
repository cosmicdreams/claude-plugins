#!/usr/bin/env bash
# Static measures of onboarding friction — no runtime needed.
set -u
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_ROOT="$(cd "$HARNESS_DIR/../.." && pwd)"

# Setup interview questions = numbered items in skills/setup/SKILL.md Step 2.
interview=$(awk '/^## Step 2/,/^## Step 3/' "$PLUGIN_ROOT/skills/setup/SKILL.md" \
  | grep -cE '^[0-9]+\.' || echo 0)

# Skills total and user-facing (excluding audience: internal).
skill_count=$(find "$PLUGIN_ROOT/skills" -name SKILL.md | wc -l | tr -d ' ')
skill_internal=$(grep -rl "^audience: internal" "$PLUGIN_ROOT/skills"/*/SKILL.md 2>/dev/null | wc -l | tr -d ' ')
skill_user_facing=$((skill_count - skill_internal))

# Trigger phrases per skill (proxy for discoverability).
trigger_lines=$(grep -cE "^  - \"" "$PLUGIN_ROOT/skills"/*/SKILL.md 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')

# README presence.
readme_present=0
[ -f "$PLUGIN_ROOT/README.md" ] && readme_present=1
onboarding_present=0
[ -f "$PLUGIN_ROOT/ONBOARDING.md" ] && onboarding_present=1

python3 - <<PY
import json
print(json.dumps({"metric":"setup_interview_questions","value":$interview,"notes":"numbered items in setup SKILL.md Step 2"}))
print(json.dumps({"metric":"skill_count_total","value":$skill_count,"notes":"all SKILL.md files under drover/skills/"}))
print(json.dumps({"metric":"skill_count_user_facing","value":$skill_user_facing,"notes":"excluding audience: internal"}))
print(json.dumps({"metric":"skill_trigger_phrases_total","value":$trigger_lines,"notes":"sum of trigger lines across skills"}))
print(json.dumps({"metric":"readme_present","value":$readme_present,"notes":"drover/README.md"}))
print(json.dumps({"metric":"onboarding_present","value":$onboarding_present,"notes":"drover/ONBOARDING.md"}))
PY
