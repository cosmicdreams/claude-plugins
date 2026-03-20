#!/usr/bin/env bash
# office plugin router
# Routes office <subcommand> [args] to the appropriate CLI tool.

set -euo pipefail

SUBCOMMAND="${1:-help}"
shift 2>/dev/null || true

# Load config if OBSIDIAN_VAULT_NAME not set
if [[ -z "${OBSIDIAN_VAULT_NAME:-}" ]] && [[ -f "$HOME/.config/office/config" ]]; then
    # shellcheck source=/dev/null
    source "$HOME/.config/office/config"
fi

auth_error() {
    local tool="$1"
    case "$tool" in
        msgcli) echo "Authentication required. Run: msgcli auth add" ;;
        jira)   echo "Authentication required. Run: jira init" ;;
        gh)     echo "Authentication required. Run: gh auth login" ;;
        obsidian) echo "Obsidian must be running with the Local REST API plugin enabled."
                  echo "Launch Obsidian → Settings → Community Plugins → Local REST API → Enable" ;;
    esac
}

run_with_auth_check() {
    local tool="$1"
    shift
    if ! "$@"; then
        exit_code=$?
        if [[ $exit_code -eq 2 ]]; then
            auth_error "$tool"
            exit 2
        fi
        exit $exit_code
    fi
}

case "$SUBCOMMAND" in
    email)
        run_with_auth_check "msgcli" msgcli mail "$@"
        ;;
    calendar)
        run_with_auth_check "msgcli" msgcli calendar "$@"
        ;;
    jira)
        run_with_auth_check "jira" jira "$@"
        ;;
    github)
        run_with_auth_check "gh" gh "$@"
        ;;
    archive|organize)
        if ! obsidian help &>/dev/null; then
            auth_error "obsidian"
            exit 1
        fi
        # Delegate to skill instruction — this is a placeholder entry point
        echo "Use the office:${SUBCOMMAND} Claude skill for guided vault operations."
        ;;
    log-analyzer)
        echo "Use the office:log-analyzer Claude skill for log analysis."
        ;;
    help|--help|-h)
        echo "office — Claude Code office productivity plugin"
        echo ""
        echo "Usage: office <subcommand> [args]"
        echo ""
        echo "Subcommands:"
        echo "  email       Manage Outlook email via msgcli"
        echo "  calendar    Manage Outlook calendar via msgcli"
        echo "  jira        Jira issue management via jira-cli"
        echo "  github      GitHub PRs and issues via gh"
        echo "  archive     Migrate local notes to Obsidian vault"
        echo "  organize    Categorize and tag notes in Obsidian vault"
        echo "  log-analyzer  Analyze Acquia/Cloudflare logs"
        ;;
    *)
        echo "Unknown subcommand: $SUBCOMMAND"
        echo "Run 'office help' for usage."
        exit 1
        ;;
esac
