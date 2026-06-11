#!/usr/bin/env zsh
set -euo pipefail

# Usage: package-plugin.sh <plugin-name|all>
# Packages plugin(s) as Desktop-distributable .zip archives in dist/

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
dist_dir="$repo_root/dist"
mkdir -p "$dist_dir"

plugins=(sprint retro research-lab ideate improve drupal-lab ideas-funnel admin workshop lib drover)

package_one() {
  local name=$1
  local plugin_dir="$repo_root/$name"
  if [[ ! -d "$plugin_dir/.claude-plugin" ]]; then
    echo "skip: $name (no .claude-plugin directory found)"
    return
  fi
  local out="$dist_dir/${name}.zip"
  (cd "$plugin_dir" && zip -qr "$out" .)
  echo "packaged: $name → dist/${name}.zip"
}

if [[ "${1:-}" == "all" ]]; then
  for p in "${plugins[@]}"; do
    package_one "$p"
  done
else
  [[ -n "${1:-}" ]] || { echo "Usage: package-plugin.sh <plugin-name|all>"; exit 1; }
  package_one "$1"
fi
