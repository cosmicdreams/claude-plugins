#!/usr/bin/env bash
# Remove the retired `notebooklm` CLI and leave a guard in its place.
#
# Usage: install-notebooklm-shim.sh [--uninstall]
#
# What it does:
#   1. Uninstalls the pipx package `notebooklm-py` (the archived CLI), if present.
#   2. Installs notebooklm-retired-shim.sh as ~/.local/bin/notebooklm, so any
#      leftover muscle memory or stale script gets a clear "use nlm" message
#      instead of an opaque authentication failure.
#
# Reversible: `--uninstall` removes the shim. To genuinely reinstate the old
# tool you would need `pipx install "notebooklm-py[browser]"`, but its login
# flow is dead upstream, so that is not a real fallback.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHIM_SRC="$SCRIPT_DIR/notebooklm-retired-shim.sh"
TARGET="${HOME}/.local/bin/notebooklm"

if [ "${1:-}" = "--uninstall" ]; then
  if [ -f "$TARGET" ] && head -c 400 "$TARGET" | grep -q "RETIRED"; then
    rm -f "$TARGET"; echo "Removed shim at $TARGET"
  else
    echo "No shim found at $TARGET (nothing removed)"
  fi
  exit 0
fi

[ -f "$SHIM_SRC" ] || { >&2 echo "Shim source not found: $SHIM_SRC"; exit 1; }

# 1) Drop the archived package.
if command -v pipx >/dev/null 2>&1 && pipx list --short 2>/dev/null | grep -q '^notebooklm-py'; then
  echo "Uninstalling retired pipx package notebooklm-py…"
  pipx uninstall notebooklm-py >/dev/null 2>&1 && echo "  removed" || echo "  WARNING: uninstall failed"
fi

# 2) Refuse to clobber a real binary — only ever replace a dead symlink or our
#    own shim. A surviving real `notebooklm` means the uninstall above failed.
if [ -e "$TARGET" ] && ! head -c 400 "$TARGET" 2>/dev/null | grep -q "RETIRED"; then
  if [ -L "$TARGET" ] && [ ! -e "$(readlink "$TARGET")" ]; then
    rm -f "$TARGET"   # dangling pipx symlink, safe to clear
  else
    >&2 echo "Refusing to overwrite existing $TARGET — remove it yourself, then re-run."
    exit 1
  fi
fi

mkdir -p "$(dirname "$TARGET")"
install -m 0755 "$SHIM_SRC" "$TARGET"
echo "Installed retired-command guard at $TARGET"
echo "Verify with: notebooklm   (should print the 'use nlm instead' message and exit 127)"
