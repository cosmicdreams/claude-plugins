#!/usr/bin/env bash
# run-trigger-evals.sh — Run trigger accuracy evals for one or all skills
#
# Usage (from worktrees/main/):
#   admin/skills/new-skill/scripts/run-trigger-evals.sh [plugin:skill | all]
#
# Examples:
#   admin/skills/new-skill/scripts/run-trigger-evals.sh all
#   admin/skills/new-skill/scripts/run-trigger-evals.sh ideate:diagram
#   admin/skills/new-skill/scripts/run-trigger-evals.sh workshop:morning-brief
#
# What it does:
#   For each skill with a trigger-evals.json in skill-eval/:
#   1. Reads the installed SKILL.md (description + trigger phrases)
#   2. For each test case, calls claude -p as a judge:
#      "Given this description and these trigger phrases, would you invoke
#       this skill for the user's query? Answer TRIGGER or NO_TRIGGER."
#   3. Compares judge verdict to expected should_trigger value
#   4. Writes results to skill-eval/<plugin>-<skill>/results-<date>.md
#      and prints a summary to stdout
#
# Why judge mode (not live invocation):
#   claude -p does not auto-invoke plugin skills via the Skill tool in
#   non-interactive mode. Judge mode tests Claude's DECISION about when
#   a skill should fire, which is the property we actually care about.
#
# CLAUDECODE is stripped from the environment so this can be run from
# inside or outside a Claude Code session.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEW_SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$NEW_SKILL_DIR/../../.." && pwd)"
CLAUDE_PLUGINS_ROOT="$(cd "$REPO_ROOT/../.." && pwd)"
SKILL_EVAL_DIR="${SKILL_EVAL_DIR:-$CLAUDE_PLUGINS_ROOT/skill-eval}"
PLUGIN_CACHE="$HOME/.claude/plugins/cache/local"
DATE="$(date +%Y-%m-%d)"

# Known plugin prefixes — longer names must come first (so e.g. drupal-lab
# is matched before drupal would be, if there ever was one).
KNOWN_PLUGINS=(research-lab ideas-funnel drupal-lab workshop improve drover ideate sprint admin retro lib)

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_SKIP=0

# Strip CLAUDECODE so claude -p works when run inside Claude Code
unset CLAUDECODE 2>/dev/null || true

# --- Helpers ---

latest_version() {
    local plugin="$1"
    local cache_dir="$PLUGIN_CACHE/$plugin"
    [[ -d "$cache_dir" ]] || return 1
    ls "$cache_dir" | sort -V | tail -1
}

skill_path() {
    local plugin="$1" skill="$2"
    local ver
    ver=$(latest_version "$plugin") || return 1
    echo "$PLUGIN_CACHE/$plugin/$ver/skills/$skill"
}

parse_eval_dir() {
    local dirname="$1"
    for known in "${KNOWN_PLUGINS[@]}"; do
        if [[ "$dirname" == "${known}-"* ]]; then
            echo "$known" "${dirname#${known}-}"
            return 0
        fi
    done
    return 1
}

# Extract YAML frontmatter field (handles multi-line block scalars)
extract_frontmatter() {
    local skill_md="$1" field="$2"
    python3 - "$skill_md" "$field" <<'PYEOF'
import sys, re

path, field = sys.argv[1], sys.argv[2]
text = open(path).read()

# Extract content between first --- pair
m = re.search(r'^---\s*\n(.*?)\n---', text, re.DOTALL)
if not m:
    sys.exit(0)
frontmatter = m.group(1)

# Find the field
pattern = rf'^{re.escape(field)}:\s*(.*?)(?=\n\S|\Z)'
m2 = re.search(pattern, frontmatter, re.DOTALL | re.MULTILINE)
if not m2:
    sys.exit(0)

value = m2.group(1).strip()

# Handle block scalar (>  or |) — strip leading spaces from continuation lines
if value.startswith('>') or value.startswith('|'):
    lines = value.split('\n')[1:]  # skip the > or |
    value = ' '.join(l.strip() for l in lines if l.strip())

# Handle list fields (triggers:)
if value.startswith('-'):
    items = re.findall(r'^\s*-\s+"?([^"\n]+)"?', m2.group(1), re.MULTILINE)
    print('\n'.join(items))
else:
    print(value)
PYEOF
}

# Ask claude -p to judge whether the skill should trigger for a query
judge_query() {
    local description="$1" triggers="$2" query="$3"

    local prompt
    prompt="You are evaluating a skill trigger system. Given a skill's description and trigger phrases, decide whether a user's message should invoke this skill.

Skill description:
${description}

Trigger phrases (any of these phrasings should invoke the skill):
${triggers}

User message: \"${query}\"

Should this skill be invoked? Consider: does the user's message match the description's intent, or contain or closely paraphrase one of the trigger phrases?

Respond with exactly one word on a single line: TRIGGER or NO_TRIGGER"

    claude -p "$prompt" 2>/dev/null | tr -d '[:space:]' | grep -oE 'TRIGGER|NO_TRIGGER' | head -1
}

# --- Per-skill eval ---

run_eval_for_skill() {
    local plugin="$1" skill="$2"
    local eval_dir="$SKILL_EVAL_DIR/${plugin}-${skill}"
    local eval_json="$eval_dir/trigger-evals.json"
    local results_file="$eval_dir/results-${DATE}.md"

    echo ""
    echo "━━━ ${plugin}:${skill} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if [[ ! -f "$eval_json" ]]; then
        echo "  — SKIP: no trigger-evals.json at $eval_json"
        TOTAL_SKIP=$((TOTAL_SKIP + 1))
        return 0
    fi

    local spath
    spath=$(skill_path "$plugin" "$skill") || {
        echo "  — SKIP: plugin '$plugin' not installed"
        TOTAL_SKIP=$((TOTAL_SKIP + 1))
        return 0
    }

    local skill_md="$spath/SKILL.md"
    if [[ ! -f "$skill_md" ]]; then
        echo "  — SKIP: SKILL.md not found at $skill_md"
        TOTAL_SKIP=$((TOTAL_SKIP + 1))
        return 0
    fi

    local ver description triggers
    ver=$(latest_version "$plugin")
    description=$(extract_frontmatter "$skill_md" "description")
    triggers=$(extract_frontmatter "$skill_md" "triggers")

    echo "  Version: ${plugin} v${ver}"
    echo "  Cases:   $(python3 -c "import json; print(len(json.load(open('$eval_json'))))" 2>/dev/null || echo '?')"
    echo ""

    local skill_pass=0 skill_fail=0
    local result_rows=""

    while IFS= read -r item; do
        local query expected_bool expected verdict actual pass_fail
        query=$(echo "$item" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['query'])")
        expected_bool=$(echo "$item" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['should_trigger'])")

        if [[ "$expected_bool" == "True" ]]; then
            expected="TRIGGER"
        else
            expected="NO_TRIGGER"
        fi

        verdict=$(judge_query "$description" "$triggers" "$query")

        # Default to NO_TRIGGER if claude returned nothing parseable
        actual="${verdict:-NO_TRIGGER}"

        if [[ "$expected" == "$actual" ]]; then
            pass_fail="PASS"
            skill_pass=$((skill_pass + 1))
        else
            pass_fail="FAIL"
            skill_fail=$((skill_fail + 1))
        fi

        printf "  %-4s  %-10s  %s\n" "$pass_fail" "($expected)" "$query"
        result_rows+="| ${pass_fail} | ${expected} | ${actual} | ${query} |"$'\n'

    done < <(python3 -c "
import json, sys
for item in json.load(open('$eval_json')):
    print(json.dumps(item))
")

    local total=$((skill_pass + skill_fail))
    echo ""
    echo "  ─────────────────────────────────"
    echo "  ${skill_pass}/${total} passed"

    # Write results file
    {
        echo "# ${plugin}:${skill} Trigger Eval — ${DATE}"
        echo ""
        echo "**Version:** ${ver}"
        echo "**Method:** claude -p judge (TRIGGER / NO_TRIGGER)"
        echo ""
        echo "## Results"
        echo ""
        echo "| Result | Expected | Actual | Query |"
        echo "|--------|----------|--------|-------|"
        echo "$result_rows"
        echo ""
        echo "## Summary"
        echo ""
        echo "${skill_pass}/${total} passed"
        if [[ $skill_fail -eq 0 ]]; then
            echo ""
            echo "**Verdict: PASS**"
        else
            echo ""
            echo "**Verdict: CAUTION — ${skill_fail} failure(s)**"
            echo ""
            echo "### Failures"
            echo "$result_rows" | grep "^| FAIL" | while IFS= read -r row; do
                query=$(echo "$row" | cut -d'|' -f5 | xargs)
                expected=$(echo "$row" | cut -d'|' -f3 | xargs)
                echo "- Expected ${expected}: \`${query}\`"
            done
        fi
    } > "$results_file"

    echo "  Results: $results_file"

    if [[ $skill_fail -eq 0 ]]; then
        TOTAL_PASS=$((TOTAL_PASS + 1))
    else
        TOTAL_FAIL=$((TOTAL_FAIL + 1))
    fi
}

# --- Usage ---

usage() {
    echo "Usage: $0 [plugin:skill | all]"
    echo ""
    echo "  all          — eval every skill with a trigger-evals.json"
    echo "  plugin:skill — eval one skill (e.g. ideate:diagram)"
    echo ""
    echo "  Eval dirs:   $SKILL_EVAL_DIR"
    echo "  Results:     skill-eval/<plugin>-<skill>/results-<date>.md"
    exit 1
}

# --- Entry point ---

TARGET="${1:-all}"

if [[ "$TARGET" == "all" ]]; then
    found=0
    for dir in "$SKILL_EVAL_DIR"/*/; do
        [[ -d "$dir" ]] || continue
        [[ -f "${dir}trigger-evals.json" ]] || continue
        read -r plugin skill < <(parse_eval_dir "$(basename "$dir")") || {
            echo "WARN: cannot parse plugin from '$(basename "$dir")'" >&2
            continue
        }
        run_eval_for_skill "$plugin" "$skill"
        found=$((found + 1))
    done
    [[ $found -gt 0 ]] || { echo "No trigger-evals.json files found under $SKILL_EVAL_DIR"; exit 1; }
elif [[ "$TARGET" == *:* ]]; then
    run_eval_for_skill "${TARGET%%:*}" "${TARGET##*:}"
else
    echo "Error: expected 'plugin:skill' or 'all', got: $TARGET" >&2
    usage
fi

echo ""
echo "══════════════════════════════════════════════"
printf "PASSED:  %d\nFAILED:  %d\nSKIPPED: %d\n" "$TOTAL_PASS" "$TOTAL_FAIL" "$TOTAL_SKIP"

if [[ $TOTAL_FAIL -eq 0 && $TOTAL_PASS -gt 0 ]]; then
    echo "VERDICT: PASS ✓"
    exit 0
elif [[ $TOTAL_FAIL -eq 0 ]]; then
    echo "VERDICT: SKIPPED"
    exit 0
else
    echo "VERDICT: FAIL — ${TOTAL_FAIL} skill(s) have trigger failures" >&2
    exit 1
fi
