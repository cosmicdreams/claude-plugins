#!/usr/bin/env bash
# Postflight guidance for NotebookLM-backed skills. INFORMATIONAL ONLY.
#
# Runs at the end of an engagement to tell the user how to keep the tool healthy
# next time. This is where the VERSION check lives — intentionally NOT in
# preflight, because being behind is advice, not a reason to block work.
#
# Usage: notebook-postflight.sh

say() { echo "[postflight] $*"; }
command -v nlm >/dev/null 2>&1 || { say "nlm CLI not found; skipping."; exit 0; }

# `nlm --version` self-reports staleness ("You are on the latest version." or an
# upgrade hint). Prefer the tool's own answer; only fall back to PyPI when it
# says nothing useful, so the common path costs no network call.
ver_out=$(nlm --version 2>/dev/null)
cur=$(printf '%s' "$ver_out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)

if printf '%s' "$ver_out" | grep -qi "latest version"; then
  say "version: ${cur:-unknown} (up to date)"
else
  latest=$(curl -s https://pypi.org/pypi/notebooklm-mcp-cli/json 2>/dev/null \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['info']['version'])" 2>/dev/null)
  if [ -n "$cur" ] && [ -n "$latest" ] && [ "$cur" != "$latest" ]; then
    say "version: you have $cur, latest is $latest → next time upgrade with: uv tool upgrade notebooklm-mcp-cli"
  elif [ -n "$cur" ]; then
    say "version: $cur"
  fi
fi

# The retired CLI lingering on PATH is the most common source of confusion, so
# say so at the end of every engagement until it is gone.
if command -v notebooklm >/dev/null 2>&1 && ! head -c 200 "$(command -v notebooklm)" 2>/dev/null | grep -q "RETIRED"; then
  say "cleanup: the retired 'notebooklm' CLI is still installed — 'pipx uninstall notebooklm-py'"
fi

exit 0
