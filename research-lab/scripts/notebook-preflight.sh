#!/usr/bin/env bash
# Passive preflight for NotebookLM-backed skills.
#
# CONTRACT: never blocks, never prompts, always exits 0. It only verifies the
# CLI's runtime dependencies exist and auto-applies SAFE, non-interactive
# remedies (injecting Playwright into the pipx venv). Anything that needs a human
# (interactive login) is REPORTED, not enforced.
#
# Deliberately NO version check here — staleness is guidance, not a blocker, so
# it lives in notebook-postflight.sh which runs at the end.
#
# Usage: notebook-preflight.sh

say() { echo "[preflight] $*"; }

# 1) CLI present? (cannot auto-install a brand-new tool safely — report only)
if ! command -v notebooklm >/dev/null 2>&1; then
  say "notebooklm CLI: MISSING — install with 'pipx install \"notebooklm-py[browser]\"' (skill cannot run until then)"
  exit 0
fi
say "notebooklm CLI: ok"

# 2) Playwright present in the CLI's own environment? Needed for 'notebooklm login'.
#    Auto-remedy when the CLI is pipx-managed (the documented install path).
if pipx runpip notebooklm-py show playwright >/dev/null 2>&1; then
  say "playwright: ok"
elif command -v pipx >/dev/null 2>&1 && pipx list --short 2>/dev/null | grep -q '^notebooklm-py'; then
  say "playwright: missing — auto-injecting into the pipx venv (non-interactive)…"
  if pipx inject notebooklm-py "playwright>=1.40,<2" >/dev/null 2>&1; then
    venv="$(pipx environment --value PIPX_LOCAL_VENVS 2>/dev/null)/notebooklm-py"
    if "$venv/bin/playwright" install chromium >/dev/null 2>&1; then
      say "playwright: installed + chromium ready"
    else
      say "playwright: injected — if login fails run '$venv/bin/playwright install chromium'"
    fi
  else
    say "playwright: auto-inject failed — run 'pipx inject notebooklm-py playwright && playwright install chromium'"
  fi
else
  say "playwright: missing and CLI is not pipx-managed — install Playwright in the CLI's environment for 'notebooklm login'"
fi

# 3) Auth valid? Interactive login cannot be automated — report only, never block.
if notebooklm list >/dev/null 2>&1; then
  say "auth: ok"
else
  say "auth: EXPIRED or missing — run 'notebooklm login' (one-time, interactive)"
fi

exit 0
