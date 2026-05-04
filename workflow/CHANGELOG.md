# Changelog

## 1.1.1
- Fixed: `check-integration.sh` slack preflight now checks for `agent-slack` instead of a non-existent `slack` CLI. Previous behavior caused every morning-brief and pulse run to silently skip Slack.

## 1.1.0
- Added: `scripts/check-integration.sh` — shared preflight circuit-breaker for external integrations (gws, jira, slack, gh)
- Caches health results for 5 minutes; open circuit short-circuits without re-running preflight
- Wired circuit-breaker into: pulse (step 01-setup), morning-brief (step 01-setup), personal-email, personal-calendar
- pulse and morning-brief degrade gracefully (skip unavailable source, continue with the rest)
- Added: `tests/test_circuit_breaker.bats` — 13 tests covering cache hit, cache miss, and TTL expiry

## 1.0.0
- Initial release: extracted from `office` plugin
- Skills: morning-brief, pulse, deploy-post, personal-calendar, personal-email, organize, obsidian-lint, ecosystem-pulse
- Added: workflow:config skill for integration discovery and configuration
