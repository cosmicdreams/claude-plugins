---
name: scout
description: >
  Your personal knowledge radar — a better Feedly. Ranges across a curated, extensible list of
  sources (feeds, pages, standing searches), diffs against your Obsidian vault to find net-new
  ideas, scores each against a tunable interest profile, and stores only what matters to you. Learns
  from your feedback (useful / not / more-like-this / mute) so it sharpens over time. The act of
  gathering knowledge to distill and synthesize later — the continuous-learning counterpart to
  workshop:prioritize. Designed to run on a loop. Renamed from ecosystem-pulse.
  Distinct from research-lab:gather (which builds a corpus for one specific question); scout is
  passive, continuous, interest-tuned intake.
triggers:
  - "workshop:scout"
  - "run the scout"
  - "scout for ideas"
  - "find AI stories"
  - "check for AI news"
  - "what's new in the AI ecosystem"
  - "ai ecosystem research"
  - "Use Webfetch to find stories about ai driven workflows"
allowed-tools: Agent, Bash, Read, Write, WebFetch, WebSearch
---

# workshop:scout — Knowledge Radar

Passively surface net-new ideas worth knowing, filtered to *your* interests, and get sharper the more you use it. Output: a concise, most-relevant-first briefing + a vault entry. Built for `/loop 30m /workshop:scout`.

**What makes it better than Feedly:** Feedly aggregates; scout *filters to you* and *learns*. Three parts beyond a plain fetcher:

1. **Curated, extensible sources** — a config-driven list you own (add/remove conversationally).
2. **Tunable interest profile** — explicit topics you care about and anti-topics to suppress.
3. **Feedback loop** — mark items useful / not / more-like-this / mute; that adjusts the profile and source weights over time.

## Config

Sources and the interest profile live in `~/.claude/workshop.json` under a `scout` block. If no `scout` block exists, fall back to the seed source list in `steps/02-fetch.md` and offer to write a starter config.

## Running on a loop (singleton cron discipline)

```
/loop 30m /workshop:scout
```

Before creating this loop, always check for an existing one:

```bash
CronList
```

If an entry for `workshop:scout` already exists, **do not create another** — return the existing job ID to the user and stop. Duplicate cron jobs cause redundant fetches and duplicate vault entries.

De-registration: `CronDelete` with the job ID returned by `CronList`. Tell the user the ID when starting the loop.

## Steps

Work through these in order. Read each step file as you reach it.

1. **Load** — read source list + interest profile + feedback history; load the vault dedup baseline
   → Read `steps/01-load.md`

2. **Fetch** — parallel fetch across all configured sources by type (feed / page / search)
   → Read `steps/02-fetch.md`

3. **Score** — dedup vs vault, score relevance against the interest profile + feedback weights
   → Read `steps/03-score.md`

4. **Store and output** — write net-new to the vault, emit a ranked briefing with feedback affordance
   → Read `steps/04-store-output.md`

5. **Feedback** — capture marks, propose profile/weight updates for approval
   → Read `steps/05-feedback.md`

## Managing sources mid-session

To add, remove, or mute a source on the fly, read `steps/06-sources.md`.
