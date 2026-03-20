---
name: pulse
description: >
  Cross-source priority triage — aggregates Jira and Slack into a single ranked view of
  what needs your attention right now. Use pulse when you want a unified, multi-source
  snapshot. Use individual skills (lib:slack, lib:jira) when querying a single
  source. Outputs two views: (1) top priority item across all sources, (2) full delta
  since last broadcast. Designed to run hourly via /loop. Requires workflow.json config (run workflow:config to set up).
triggers:
  - "pulse check"
  - "what needs my attention"
  - "what needs attention right now"
  - "priority check"
  - "workflow:pulse"
  - "anything urgent across"
  - "check pulse"
  - "what's new across jira and slack"
  - "cross-source check"
allowed-tools: Agent, Bash, Read, Write
---

# workflow:pulse — Ambient Priority Watchdog

Aggregates Jira and Slack into a unified priority view. Computes deltas since the last
run and surfaces the single top-priority item.

**Use pulse when:** cross-source triage — "what do I need to respond to right now?"
**Use individual skills when:** querying one source (`lib:jira`, `lib:slack`).

Two output views every run:
1. **TOP PRIORITY** — single highest-priority item with a one-line reason
2. **SINCE LAST BROADCAST** — full delta grouped by source

## Steps

Work through these in order. Read each step file as you reach it.

1. **Setup** — load config and state, resolve user IDs, compute timestamps
   → Read `steps/01-setup.md`

2. **Fetch Jira** — spawn one subagent per Jira server
   → Read `steps/02-fetch-jira.md`

3. **Fetch Slack** — spawn one subagent per channel
   → Read `steps/03-fetch-slack.md`

4. **Synthesize and output** — rank across sources, emit views, write state
   → Read `steps/04-synthesize-output.md`

## Mid-session config updates

To add/remove channels or keywords while pulse is running, read `steps/05-config-updates.md`.
