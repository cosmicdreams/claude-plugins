---
name: morning-brief
description: >
  Your morning Slack catchup. Run once at the start of your day to scan what happened
  overnight across all configured channels, surface @mentions and keyword hits, and
  optionally update ~/.claude/workflow.json to focus which channels workflow:pulse
  monitors for the rest of the day.

  Use this skill for time-bounded overnight catchup ("what happened while I was away").
  For real-time Slack monitoring use workflow:pulse. For raw channel data fetch use lib:slack.
triggers:
  - "morning brief"
  - "workflow:morning-brief"
  - "what happened overnight"
  - "overnight activity"
  - "morning briefing"
  - "catch me up on overnight"
  - "what did I miss overnight"
  - "set today's focus"
  - "start of day slack summary"
  - "start of day summary"
allowed-tools: Agent, Bash, Read, Write
---

# workflow:morning-brief — Morning Briefing

Scan overnight Slack activity, surface what matters, optionally update today's focus.

## Steps

Work through these in order. Read each step file as you reach it.

1. **Setup** — load config and state, resolve user IDs
   → Read `steps/01-setup.md`

2. **Fetch** — spawn per-channel subagents in parallel
   → Read `steps/02-fetch.md`

3. **Score and output** — rank results and display the brief
   → Read `steps/03-score-output.md`

4. **Focus update** — offer to narrow today's pulse config, write state
   → Read `steps/04-focus-update.md`
