#!/usr/bin/env bash
# run-trigger-evals.sh — Run trigger accuracy evals for one or all skills
#
# Usage (from worktrees/main/):
#   admin/skills/bump-version/scripts/run-trigger-evals.sh [plugin:skill | all]
#
# Examples:
#   admin/skills/bump-version/scripts/run-trigger-evals.sh all
#   admin/skills/bump-version/scripts/run-trigger-evals.sh ideate:diagram
#   admin/skills/bump-version/scripts/run-trigger-evals.sh office:morning-brief
#
# What it does:
#   For each skill with a trigger-evals.json in skill-eval/:
#   1. Finds the installed SKILL.md in ~/.claude/plugins/cache/local/
#   2. Calls run_eval.py in plugin mode (real claude -p, detects actual Skill tool calls)
#   3. Reports pass/fail per query and an overall verdict
#
# run_eval.py strips CLAUDECODE from the environment, so this script CAN be run
# inside a Claude Code session — but note claude -p shares your subscription quota.
# Prefer running from a plain terminal for speed and isolation.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
NEW_SKILL_DIR="$REPO_ROOT/admin/skills/new-skill"
CLAUDE_PLUGINS_ROOT="$(cd "$REPO_ROOT/../.." && pwd)"
SKILL_EVAL_DIR="${SKILL_EVAL_DIR:-$CLAUDE_PLUGINS_ROOT/skill-eval}"
PLUGIN_CACHE="$HOME/.claude/plugins/cache/local"

# Known plugin prefixes (order matters — check longer names first)
KNOWN_PLUGINS=(drupal-lab ideate office sprint retro admin)

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_SKIP=0

# --- Helpers ---

pass() { printf "  ✓ %s\n" "$*"; }
fail() { printf "  ✗ %s\n" "$*" >&2; }
skip() { printf "  — %s\n" "$*"; }

latest_version() {
    local plugin="$1"
    local cache_dir="$PLUGIN_CACHE/$plugin"
    if [[ ! -d "$cache_dir" ]]; then
        echo ""
        return 1
    fi
    ls "$cache_dir" | sort -V | tail -1
}

skill_path() {
    local plugin="$1" skill="$2"
    local ver
    ver=$(latest_version "$plugin") || { echo ""; return 1; }
    echo "$PLUGIN_CACHE/$plugin/$ver/skills/$skill"
}

# Convert eval dir name (e.g. "office-morning-brief") to "plugin skill"
parse_eval_dir() {
    local dirname="$1"
    for known in "${KNOWN_PLUGINS[@]}"; do
        if [[ "$dirname" == "${known}-"* ]]; then
            local skill="${dirname#${known}-}"
            echo "$known" "$skill"
            return 0
        fi
    done
    echo ""
    return 1
}

# Run eval for one skill. Args: plugin skill
run_eval_for_skill() {
    local plugin="$1" skill="$2"
    local eval_dir="$SKILL_EVAL_DIR/${plugin}-${skill}"
    local eval_json="$eval_dir/trigger-evals.json"

    echo ""
    echo "━━━ ${plugin}:${skill} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if [[ ! -f "$eval_json" ]]; then
        skip "no trigger-evals.json at $eval_json"
        TOTAL_SKIP=$((TOTAL_SKIP + 1))
        return 0
    fi

    local installed_skill_path
    installed_skill_path=$(skill_path "$plugin" "$skill") || {
        skip "plugin '$plugin' not installed — run reinstall-plugin.sh $plugin first"
        TOTAL_SKIP=$((TOTAL_SKIP + 1))
        return 0
    }

    if [[ ! -f "$installed_skill_path/SKILL.md" ]]; then
        skip "SKILL.md not found at $installed_skill_path"
        TOTAL_SKIP=$((TOTAL_SKIP + 1))
        return 0
    fi

    local ver
    ver=$(latest_version "$plugin")
    echo "  Installed: ${plugin} v${ver} — skill path: $installed_skill_path"
    echo "  Eval set:  $eval_json ($(python3 -c "import json; print(len(json.load(open('$eval_json'))))" 2>/dev/null || echo '?') cases)"
    echo ""

    # Run via run_eval.py (plugin mode — detects real Skill tool calls via stream-json)
    local output
    if ! output=$(
        cd "$NEW_SKILL_DIR" && \
        python3 -m scripts.run_eval \
            --eval-set "$eval_json" \
            --skill-path "$installed_skill_path" \
            --plugin-skill "${plugin}:${skill}" \
            --num-workers 5 \
            --runs-per-query 1 \
            --verbose \
            2>&1
    ); then
        fail "run_eval.py exited non-zero for ${plugin}:${skill}"
        TOTAL_FAIL=$((TOTAL_FAIL + 1))
        return 1
    fi

    # run_eval.py --verbose prints results to stderr (captured above in combined output)
    # Parse pass/fail counts from the JSON on stdout — but with --verbose, JSON goes to stdout
    # and verbose lines to stderr. Since we combined, extract the JSON block.
    local json_block
    json_block=$(echo "$output" | python3 -c "
import sys, json
lines = sys.stdin.read().strip().split('\n')
# Find the JSON object (starts with '{')
for i, line in enumerate(lines):
    line = line.strip()
    if line.startswith('{'):
        try:
            blob = '\n'.join(lines[i:])
            d = json.loads(blob)
            print(json.dumps(d))
            break
        except:
            pass
" 2>/dev/null || echo "{}")

    # Print verbose lines (non-JSON stderr output captured in $output)
    echo "$output" | grep -v '^{' | grep -v '^}' | grep -v '^\s*"' || true

    local passed failed total
    passed=$(echo "$json_block" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('summary',{}).get('passed',0))" 2>/dev/null || echo 0)
    failed=$(echo "$json_block" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('summary',{}).get('failed',0))" 2>/dev/null || echo 0)
    total=$(echo "$json_block" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('summary',{}).get('total',0))" 2>/dev/null || echo 0)

    echo ""
    if [[ "$failed" -eq 0 && "$total" -gt 0 ]]; then
        pass "${passed}/${total} passed — PASS"
        TOTAL_PASS=$((TOTAL_PASS + 1))
    elif [[ "$total" -eq 0 ]]; then
        skip "no results parsed"
        TOTAL_SKIP=$((TOTAL_SKIP + 1))
    else
        fail "${passed}/${total} passed — FAIL ($failed failure(s))"
        TOTAL_FAIL=$((TOTAL_FAIL + 1))
    fi
}

usage() {
    echo "Usage: $0 [plugin:skill | all]"
    echo ""
    echo "  all              — eval every skill with a trigger-evals.json in skill-eval/"
    echo "  plugin:skill     — eval one skill (e.g. ideate:diagram, office:morning-brief)"
    echo ""
    echo "  Skill eval dir:  $SKILL_EVAL_DIR"
    echo "  Plugin cache:    $PLUGIN_CACHE"
    echo ""
    echo "  Runs real claude -p invocations (plugin mode). Detects actual Skill tool calls."
    echo "  CLAUDECODE is stripped from the environment by run_eval.py automatically."
    exit 1
}

# --- Entry point ---

TARGET="${1:-all}"

if [[ "$TARGET" == "all" ]]; then
    found=0
    for dir in "$SKILL_EVAL_DIR"/*/; do
        [[ -d "$dir" ]] || continue
        dirname=$(basename "$dir")
        [[ -f "$dir/trigger-evals.json" ]] || continue
        read -r plugin skill < <(parse_eval_dir "$dirname") || {
            echo "WARN: cannot parse plugin name from '$dirname', skipping" >&2
            continue
        }
        run_eval_for_skill "$plugin" "$skill"
        found=$((found + 1))
    done
    if [[ $found -eq 0 ]]; then
        echo "No trigger-evals.json files found under $SKILL_EVAL_DIR"
        exit 1
    fi
elif [[ "$TARGET" == *:* ]]; then
    plugin="${TARGET%%:*}"
    skill="${TARGET##*:}"
    run_eval_for_skill "$plugin" "$skill"
else
    echo "Error: expected 'plugin:skill' or 'all', got: $TARGET" >&2
    usage
fi

echo ""
echo "══════════════════════════════════════════════"
echo "SKILLS PASSED:  $TOTAL_PASS"
echo "SKILLS FAILED:  $TOTAL_FAIL"
echo "SKILLS SKIPPED: $TOTAL_SKIP"

if [[ "$TOTAL_FAIL" -eq 0 && "$TOTAL_PASS" -gt 0 ]]; then
    echo "VERDICT: PASS ✓"
    exit 0
elif [[ "$TOTAL_FAIL" -eq 0 && "$TOTAL_PASS" -eq 0 ]]; then
    echo "VERDICT: SKIPPED (no evals ran)"
    exit 0
else
    echo "VERDICT: FAIL — $TOTAL_FAIL skill(s) have trigger failures" >&2
    exit 1
fi
