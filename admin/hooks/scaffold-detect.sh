#!/bin/bash
# scaffold-detect hook — admin plugin
#
# Detects whether the current project has been scaffolded for admin (scaffold skill).
# For Drupal projects, also checks whether Drupal-specific setup (Phase 2) is complete.
# Outputs a systemMessage (visible to user) at session start.
#
# Silenced by (checked in order):
#   - Global kill-switch:   "agentSquad": { "scaffoldDetect": false } in ~/.claude/settings.json
#   - Project silence:      "agentSquad": { "scaffoldDetect": false } in .claude/settings.json
#                           (set by typing "silence this prompt" — runs the scaffold-silence skill)
#   - Project complete:     "agentSquad": { "scaffoldComplete": true } in .claude/settings.json
#                           (set automatically when scaffold skill completes)
#   - Drupal Phase 2:      "agentSquad": { "drupalScaffoldComplete": true } in .claude/settings.json
#                           (set when drupal-module-starter completes)

GLOBAL_SETTINGS="$HOME/.claude/settings.json"
PROJECT_SETTINGS="$PWD/.claude/settings.json"

# Check global kill-switch
if [ -f "$GLOBAL_SETTINGS" ] && command -v jq >/dev/null 2>&1; then
    if [ "$(jq -r '.agentSquad.scaffoldDetect // true' "$GLOBAL_SETTINGS" 2>/dev/null)" = "false" ]; then
        exit 0
    fi
fi

# Check project-level silence
if [ -f "$PROJECT_SETTINGS" ] && command -v jq >/dev/null 2>&1; then
    if [ "$(jq -r '.agentSquad.scaffoldDetect // true' "$PROJECT_SETTINGS" 2>/dev/null)" = "false" ]; then
        exit 0
    fi
fi

PROJECT_NAME=$(basename "$PWD")

# --- Drupal detection ---
# A project is Drupal if worktrees/main has either:
#   1. composer.json with a drupal/* dependency (contrib or core)
#   2. core/lib/Drupal.php (Drupal core checkout)
IS_DRUPAL=false
MAIN_DIR="$PWD/worktrees/main"
if [ -d "$MAIN_DIR" ]; then
    if [ -f "$MAIN_DIR/composer.json" ] && command -v jq >/dev/null 2>&1; then
        if jq -e '(.require // {}) + (.["require-dev"] // {}) | keys[] | select(startswith("drupal/"))' "$MAIN_DIR/composer.json" >/dev/null 2>&1; then
            IS_DRUPAL=true
        fi
    fi
    if [ "$IS_DRUPAL" = "false" ] && [ -f "$MAIN_DIR/core/lib/Drupal.php" ]; then
        IS_DRUPAL=true
    fi
fi

# --- Check completion flags ---
SCAFFOLD_COMPLETE=false
DRUPAL_SCAFFOLD_COMPLETE=false
if [ -f "$PROJECT_SETTINGS" ] && command -v jq >/dev/null 2>&1; then
    if [ "$(jq -r '.agentSquad.scaffoldComplete // false' "$PROJECT_SETTINGS" 2>/dev/null)" = "true" ]; then
        SCAFFOLD_COMPLETE=true
    fi
    if [ "$(jq -r '.agentSquad.drupalScaffoldComplete // false' "$PROJECT_SETTINGS" 2>/dev/null)" = "true" ]; then
        DRUPAL_SCAFFOLD_COMPLETE=true
    fi
fi

# --- Decide what to prompt ---

# Phase 1 not done: prompt for base scaffold
if [ "$SCAFFOLD_COMPLETE" = "false" ]; then
    jq -n \
      --arg name "$PROJECT_NAME" \
      '{
        systemMessage: ("\($name) has not been scaffolded. Type:\n\"scaffold this project\" to set up Claude project structure.\nOR\n\"silence this prompt\" to disable for this project only.")
      }'
    exit 0
fi

# Phase 1 done, Drupal project, Phase 2 not done: prompt for Drupal setup
if [ "$IS_DRUPAL" = "true" ] && [ "$DRUPAL_SCAFFOLD_COMPLETE" = "false" ]; then
    jq -n \
      --arg name "$PROJECT_NAME" \
      '{
        systemMessage: ("\($name) base scaffold is complete, but Drupal-specific setup has not been run.\nType: \"/drupal-module-starter\" to configure Drupal DDEV environment.\nOR\n\"silence this prompt\" to disable for this project only.")
      }'
    exit 0
fi

# All phases complete (or non-Drupal with Phase 1 done): stay silent
exit 0
