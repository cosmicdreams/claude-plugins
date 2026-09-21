#!/usr/bin/env bash
# twg-attribution-guard — lib plugin, PreToolUse on Bash.
#
# Everything written to Atlassian through twg must read as the user's own work.
# Blocks a twg write (comment, worklog, create, update, transition comment, page,
# pull request) whose text credits an agent: "Generated with Claude", robot emoji,
# Co-Authored-By trailers, "AI-generated", and similar. Reads are never inspected.
#
# Text passed through a file argument is scanned too. Exit 2 blocks the call and
# returns the reason to the model so it can rewrite the text and retry.

command -v jq >/dev/null 2>&1 || exit 0

cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$cmd" ]] && exit 0

# Only twg invocations.
grep -Eq '(^|[;&|(`[:space:]])twg[[:space:]]' <<<"$cmd" || exit 0

# Only write verbs. Reads (get, query, search, list) pass untouched.
write_re='[[:space:]](create|create-bulk|update|add|transition|bulk-transition|publish|reply|edit|upload|record-post|clone)([[:space:]]|$)'
grep -Eq "$write_re" <<<"$cmd" || exit 0

# Drop path-like tokens (~/.claude/..., scratch directories, URLs) so a file
# location never reads as attribution; the file's contents are scanned below.
text=$(sed -E "s#[^[:space:]'\"]*/[^[:space:]'\"]*##g" <<<"$cmd")
# Append the contents of any small readable file the command names.
while IFS= read -r tok; do
  tok=${tok#@}
  tok=${tok%\"}; tok=${tok#\"}; tok=${tok%\'}; tok=${tok#\'}
  if [[ -f "$tok" && -r "$tok" ]] && (( $(wc -c <"$tok") < 1048576 )); then
    text+=$'\n'"$(cat "$tok")"
  fi
done < <(tr -s '[:space:]=' '\n' <<<"$cmd")

attribution_re='generated (with|by|using) (claude|codex|chatgpt|gpt|an? (ai|agent|assistant|llm))|co-authored-by|claude code|anthropic|\bclaude\b|ai[- ](generated|assisted|authored)|(written|drafted|created|posted|logged|prepared) by (an? )?(ai|agent|assistant|bot|llm)|on behalf of (the )?(user|chris)|🤖'

if match=$(grep -Eio "$attribution_re" <<<"$text" | head -1); [[ -n "$match" ]]; then
  cat >&2 <<MSG
Blocked: this twg write credits an agent ("$match").
Everything written to Atlassian must read as the user's own work — they steer the
agent, so the credit is theirs. Remove agent, AI, Claude, and co-author markers,
write it as the user would, and run the command again.
MSG
  exit 2
fi

exit 0
