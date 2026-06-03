---
name: prioritize
description: >
  Answer "what should I work on next?" on demand, any time of day. Gathers everything that
  defines what's on your plate — overnight signals (new Slack messages, Jira comments, status
  changes), standing obligations (blocked issues you own, stale in-progress, high-priority queue),
  and your available time today (calendar) — then ranks it into a single next action plus a full
  priority table. Built for the low-focus moment, morning AND afternoon. Read-only: never posts,
  comments, or transitions. Replaces the old pulse + morning-brief skills.
triggers:
  - "workflow:prioritize"
  - "what should I work on"
  - "what should I work on next"
  - "what am I doing today"
  - "plan my day"
  - "what needs my attention"
  - "prioritize my work"
  - "what's on my plate"
  - "catch me up"
  - "what did I miss"
allowed-tools: Agent, Bash, Read, Write
---

# workflow:prioritize — What Should I Work On Next?

Gather every signal that defines what's on your plate and rank it into **one clear next action**.
Saves you from polling Slack, Jira, and your calendar separately, and from starting a low-focus
moment at a blank slate.

**Lead with one action.** A wall of signals worsens activation paralysis; a single "do this next,
here's why" is the antidote. The default output opens with `NEXT:` — the full ranked table sits
below it for when you want the whole picture.

**This is a read-only skill.** Never post to Slack, comment on Jira, transition statuses, or make
any write to an external service. Read and report only.

## Modes

- **On-demand (default).** Full picture: overnight delta + standing obligations + available time →
  `NEXT:` action + ranked table. Run it whenever focus flags — start of day or the afternoon slump.
- **Ambient (`--loop`).** Delta-only, quiet. Surfaces only when the top item changes. For passive
  monitoring: `/loop 1h /workflow:prioritize --loop`. Skips the standing-obligations and calendar
  passes (those don't change minute to minute).

## Source coverage

Sources come from `~/.claude/workflow.json`. Work email and work calendar (Microsoft Outlook /
Exchange) are **declared-but-unconnected slots** today — Microsoft Graph auth is unsolved — so the
brief surfaces `(work email/calendar: not connected)` to keep the gap visible. When Graph access is
configured, they drop in with no change to this skill.

## Steps

Work through these in order. Read each step file as you reach it.

1. **Setup** — load config + state, resolve user IDs, detect mode, circuit-breaker preflight
   → Read `steps/01-setup.md`

2. **Fetch Slack** — per-channel subagents: overnight pass + unanswered/standing pass
   → Read `steps/02-fetch-slack.md`

3. **Fetch Jira** — per-server subagents: delta pass + attention/obligation pass
   → Read `steps/03-fetch-jira.md`

4. **Fetch availability** — today's meetings / free blocks, to rank against real capacity
   → Read `steps/04-fetch-availability.md`

5. **Rank and output** — score across sources weighted by available time; emit `NEXT:` + table
   → Read `steps/05-rank-output.md`

6. **Focus update and state** — optionally narrow ambient monitoring; write state
   → Read `steps/06-focus-update.md`
