#!/usr/bin/env bash
# RETIRED COMMAND GUARD — this is not the NotebookLM CLI.
#
# The `notebooklm` CLI (pipx package notebooklm-py, repo jacob-bd/notebooklm-cli)
# was archived upstream on 2026-06-26 and merged into NotebookLM MCP CLI. Its
# login flow no longer works, so every call to it fails in a confusing way.
#
# This shim stands in its place so the failure is loud and self-explaining
# instead of an authentication error. Install it with:
#   research-lab/scripts/install-notebooklm-shim.sh
#
# Exits 127 (command not found) so scripts treat it as missing, not as a tool
# that ran and failed.

cat >&2 <<'EOF'

  ✗ `notebooklm` is RETIRED. Use `nlm` instead.

    The upstream project was archived on 2026-06-26 and merged into
    NotebookLM MCP CLI (package: notebooklm-mcp-cli, binary: nlm).

    Install:  uv tool install notebooklm-mcp-cli
    Log in:   nlm login

  Command mapping — note the notebook id is now POSITIONAL, not `-n`:

    notebooklm list                          ->  nlm notebook list
    notebooklm create "T" --json             ->  nlm notebook create "T" --json
    notebooklm ask "Q" -n ID                 ->  nlm notebook query ID "Q"
    notebooklm source add URL -n ID          ->  nlm source add ID --url URL
    notebooklm source list -n ID --json      ->  nlm source list ID --json
    notebooklm source delete SID -n ID --yes ->  nlm source delete SID --confirm
    notebooklm source add-research "Q" -n ID ->  nlm research start "Q" -n ID
    notebooklm ask ... --save-as-note        ->  nlm note create ID --content ... --title ...

  In this repo, prefer the wrappers over raw calls:
    research-lab/scripts/notebook-{setup,ask,dedup,preflight,postflight}.sh

EOF
exit 127
