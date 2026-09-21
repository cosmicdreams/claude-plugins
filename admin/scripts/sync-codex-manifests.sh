#!/usr/bin/env zsh
# sync-codex-manifests.sh — Keep each plugin's Codex manifest in step with its Claude manifest.
#
# Usage:
#   sync-codex-manifests.sh [--check] [repo-root]
#
# For every top-level plugin (a directory with .claude-plugin/plugin.json):
#   - .codex-plugin/plugin.json must exist, and its "version" is set to the Claude version
#   - .agents/plugins/marketplace.json must list the plugin
# --check writes nothing and exits 1 on any drift, for use before a pull request or release.
# bump-version.sh runs this after every bump, so the two manifest sets cannot drift apart.

set -euo pipefail

CHECK=0
if [[ "${1:-}" == "--check" ]]; then CHECK=1; shift; fi
REPO_ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"

python3 - "$REPO_ROOT" "$CHECK" <<'PYEOF'
import json, sys
from pathlib import Path

root, check = Path(sys.argv[1]), sys.argv[2] == "1"
market_path = root / ".agents/plugins/marketplace.json"
listed = {p["name"] for p in json.loads(market_path.read_text())["plugins"]} if market_path.exists() else set()

problems, updated = [], []
for claude in sorted(root.glob("*/.claude-plugin/plugin.json")):
    plugin = claude.parent.parent.name
    version = json.loads(claude.read_text())["version"]
    codex = claude.parent.parent / ".codex-plugin/plugin.json"
    if not codex.exists():
        problems.append(f"{plugin}: missing .codex-plugin/plugin.json")
        continue
    if plugin not in listed:
        problems.append(f"{plugin}: not listed in .agents/plugins/marketplace.json")
    data = json.loads(codex.read_text())
    if data.get("version") != version:
        if check:
            problems.append(f"{plugin}: Codex {data.get('version')} != Claude {version}")
        else:
            data["version"] = version
            codex.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
            updated.append(f"  Updated: {plugin}/.codex-plugin/plugin.json -> {version}")

print("\n".join(updated))
if problems:
    print("Codex manifest problems:\n  " + "\n  ".join(problems), file=sys.stderr)
    sys.exit(1)
PYEOF
