---
name: morning-brief
description: >
  Your morning priority briefing. Scans overnight Slack and Jira activity, classifies
  each item by action needed (RESPOND, UNBLOCK, REVIEW, FYI), and presents a single
  priority-ordered table across all sources so you know what to tackle first.
  Optionally updates ~/.claude/workflow.json to focus pulse monitoring for the day.

  Use this skill for "what needs my attention first?" at the start of day.
  For real-time monitoring use workflow:pulse. For raw data fetch use lib:slack or lib:jira.
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

Scan overnight Slack and Jira, classify by action needed, present a single priority table.

**This is a read-only skill.** Never post messages to Slack, comment on Jira issues,
transition issue statuses, or make any write operations to external services. Only
read and report.

## Steps

Work through these in order. Read each step file as you reach it.

1. **Setup** — load config and state, resolve user IDs
   → Read `steps/01-setup.md`

2. **Fetch Slack** — spawn per-channel subagents in parallel
   → Read `steps/02-fetch-slack.md`

3. **Fetch Jira** — spawn per-server subagents in parallel
   → Read `steps/03-fetch-jira.md`

4. **Score and output** — rank results and display the brief
   → Read `steps/04-score-output.md`

5. **Focus update** — offer to narrow today's pulse config, write state
   → Read `steps/05-focus-update.md`
