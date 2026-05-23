#!/usr/bin/env zsh
# Drupal team branch guard.
#
# Blocks destructive git operations on protected branches (main, sprint/*, release/*)
# inside projects that have opted into team flow via ~/.claude/drupal-lab.json.
#
# - main: HARD block, always. No bypass.
# - sprint/*, release/*: SOFT block. Bypass with DRUPAL_LAB_BYPASS=1 (audited).
# - features/* and anything else: allow.
#
# Activation: only fires when cwd is inside a project where team_flow.enabled = true.
# Outside team-flow projects, this is a no-op.

set -eu

CONFIG="${HOME}/.claude/drupal-lab.json"

# Read the tool input JSON from stdin.
input="$(cat)"

# Only operate on Bash tool calls. Anything else: allow.
tool_name="$(printf '%s' "$input" | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_name",""))' 2>/dev/null || echo '')"
if [[ "$tool_name" != "Bash" ]]; then
    exit 0
fi

command_str="$(printf '%s' "$input" | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))' 2>/dev/null || echo '')"

# No command, nothing to gate.
if [[ -z "$command_str" ]]; then
    exit 0
fi

# No drupal-lab config: not configured for team flow.
if [[ ! -f "$CONFIG" ]]; then
    exit 0
fi

# Determine cwd. Use logical pwd so it matches config paths as the user sees
# them; fall back to PWD env var.
cwd="$(pwd 2>/dev/null || echo "${PWD:-}")"

# Decide if cwd is inside a team-flow-enabled project. Outputs the project alias
# on stdout if matched, empty otherwise.
project="$(/usr/bin/python3 - "$cwd" "$CONFIG" <<'PY' 2>/dev/null || true
import json, sys, os
cwd, config = sys.argv[1], sys.argv[2]
try:
    cwd_real = os.path.realpath(cwd)
except Exception:
    cwd_real = cwd
try:
    with open(config) as f:
        cfg = json.load(f)
except Exception:
    sys.exit(0)
for p in cfg.get("projects", []):
    flow = p.get("team_flow", {})
    if not flow.get("enabled"):
        continue
    for pat in p.get("cwd_patterns", []):
        try:
            pat_real = os.path.realpath(pat)
        except Exception:
            pat_real = pat
        for c in (cwd, cwd_real):
            for q in (pat, pat_real):
                if c == q or c.startswith(q.rstrip("/") + "/"):
                    print(p.get("alias", ""))
                    sys.exit(0)
PY
)"

if [[ -z "$project" ]]; then
    exit 0
fi

# Detect destructive git ops in the command string. Match conservatively — only
# the verbs that would write to the branch we're sitting on.
is_destructive_git() {
    local cmd="$1"
    # Strip simple quoting noise.
    case "$cmd" in
        *"git commit"*|*"git merge"*|*"git rebase"*|*"git cherry-pick"*|\
        *"git reset --hard"*|*"git reset --mixed"*|*"git reset --soft"*|\
        *"git reset HEAD"*|*"git push"*|*"git revert"*|\
        *"git am"*|*"git apply"*) return 0 ;;
    esac
    return 1
}

if ! is_destructive_git "$command_str"; then
    exit 0
fi

# Resolve current branch. If git fails, we're not in a repo — let it pass and
# git itself will complain.
branch="$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ -z "$branch" || "$branch" == "HEAD" ]]; then
    exit 0
fi

deny() {
    local reason="$1"
    /usr/bin/python3 - "$reason" <<'PY'
import json, sys
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": sys.argv[1],
    }
}))
PY
    exit 0
}

case "$branch" in
    main|master)
        deny "drupal-lab branch guard [$project]: refusing destructive git op on '$branch'. Main is the ground truth of what is deployed — create a 'features/<name>' branch from main and work there. No bypass."
        ;;
    sprint/*|release/*)
        if [[ "${DRUPAL_LAB_BYPASS:-0}" == "1" ]]; then
            # Audited bypass — record and allow.
            log_dir="${cwd}/.drupal-lab"
            mkdir -p "$log_dir" 2>/dev/null || true
            printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$project" "$branch" "$command_str" \
                >> "$log_dir/bypass.log" 2>/dev/null || true
            exit 0
        fi
        deny "drupal-lab branch guard [$project]: '$branch' is a disposable assembly branch — work belongs in 'features/<name>'. If you truly need to write here (e.g., conflict resolution during merge), prepend 'DRUPAL_LAB_BYPASS=1' to the command. The bypass is logged to .drupal-lab/bypass.log."
        ;;
esac

exit 0
