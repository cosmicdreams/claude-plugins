#!/usr/bin/env bash
# Passive preflight for NotebookLM-backed skills.
#
# CONTRACT: never blocks, never prompts, always exits 0. It only verifies the
# CLI's runtime dependencies exist. Anything that needs a human (interactive
# login) is REPORTED, not enforced.
#
# Deliberately NO version check here — staleness is guidance, not a blocker, so
# it lives in notebook-postflight.sh which runs at the end.
#
# Usage: notebook-preflight.sh

say() { echo "[preflight] $*"; }

# True only when the REAL retired CLI is on PATH. install-notebooklm-shim.sh
# deliberately leaves a guard script at the same name, so match on its marker
# and treat that as clean — otherwise the fix would report itself as the problem.
retired_cli_present() {
  local p
  p="$(command -v notebooklm 2>/dev/null)" || return 1
  [ -n "$p" ] || return 1
  head -c 400 "$p" 2>/dev/null | grep -q "RETIRED" && return 1
  return 0
}

# 1) CLI present? (cannot auto-install a brand-new tool safely — report only)
if ! command -v nlm >/dev/null 2>&1; then
  say "nlm CLI: MISSING — install with 'uv tool install notebooklm-mcp-cli' (skill cannot run until then)"
  # The retired CLI is not a fallback; flag it so a stale machine gets a clear cause.
  if retired_cli_present; then
    say "note: the RETIRED 'notebooklm' CLI is still on PATH. It is archived upstream and login no longer works. Remove it with 'pipx uninstall notebooklm-py'."
  fi
  exit 0
fi
say "nlm CLI: ok"

# 2) Auth valid? Interactive login cannot be automated — report only, never block.
#    `nlm login --check` is the tool's own auth probe, and unlike the old
#    "run a real command and see if it fails" approach it does not create load
#    or depend on a notebook existing.
if nlm login --check >/dev/null 2>&1; then
  say "auth: ok"
else
  say "auth: EXPIRED or missing — run 'nlm login' (one-time, interactive; cookies last ~2-4 weeks)"
fi

# 3) Stale tool still installed? Non-fatal, but it is the single most likely
#    cause of a skill calling the wrong binary out of muscle memory.
if retired_cli_present; then
  say "cleanup: retired 'notebooklm' CLI still installed — remove it with: research-lab/scripts/install-notebooklm-shim.sh"
fi

exit 0
