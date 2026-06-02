#!/usr/bin/env bash
# Postflight guidance for NotebookLM-backed skills. INFORMATIONAL ONLY.
#
# Runs at the end of an engagement to tell the user how to keep the tool healthy
# next time. This is where the VERSION check lives — intentionally NOT in
# preflight, because being behind is advice, not a reason to block work.
#
# Usage: notebook-postflight.sh

say() { echo "[postflight] $*"; }
command -v notebooklm >/dev/null 2>&1 || { say "notebooklm CLI not found; skipping."; exit 0; }

cur=$(notebooklm --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
latest=$(curl -s https://pypi.org/pypi/notebooklm-py/json 2>/dev/null \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['info']['version'])" 2>/dev/null)

if [ -n "$cur" ] && [ -n "$latest" ] && [ "$cur" != "$latest" ]; then
  say "version: you have $cur, latest is $latest → next time upgrade with: pipx install --force \"notebooklm-py[browser]==$latest\""
elif [ -n "$cur" ]; then
  say "version: $cur (up to date)"
fi

# Local-source install? pipx cannot see PyPI releases when installed from a path,
# so 'pipx upgrade' silently does nothing — exactly the trap that wastes time.
meta="$(pipx environment --value PIPX_LOCAL_VENVS 2>/dev/null)/notebooklm-py/pipx_metadata.json"
if [ -f "$meta" ]; then
  src=$(python3 -c "import json;print(json.load(open('$meta')).get('main_package',{}).get('package_or_url',''))" 2>/dev/null)
  case "$src" in
    /*|*"://"*) say "install source: '$src' is a LOCAL PATH — pipx can't track PyPI releases. To fix version management: pipx install --force \"notebooklm-py[browser]\"";;
  esac
fi
exit 0
