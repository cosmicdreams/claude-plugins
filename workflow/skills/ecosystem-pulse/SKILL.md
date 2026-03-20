---
name: ecosystem-pulse
description: >
  AI ecosystem research loop — fetches stories from multiple sources in parallel (Simon Willison,
  Hacker News, Anthropic news, The Batch), diffs against the existing Obsidian vault to find
  net-new content, debates relevance against the user's workflow, and stores only new findings.
  Designed to run on a recurring loop via /loop. Outputs a concise bullet briefing and vault
  action taken.

  Trigger when: user asks to "run the ecosystem pulse", "find AI stories", "check for AI news",
  "what's new in the AI ecosystem", or when the loop prompt begins with "Use Webfetch to find
  stories about ai driven workflows". Also trigger for "workflow:ecosystem-pulse".

  Do NOT trigger for: general web searches, single-source news fetches, or Slack/Jira monitoring
  (use workflow:pulse for that).
triggers:
  - "workflow:ecosystem-pulse"
  - "ecosystem pulse"
  - "find AI stories"
  - "check for AI news"
  - "what's new in the AI ecosystem"
  - "Use Webfetch to find stories about ai driven workflows"
  - "ai ecosystem research"
  - "claudepilled stories"
  - "run the pulse"
allowed-tools: Agent, Bash, Read, Write, WebFetch, WebSearch
---

# workflow:ecosystem-pulse — AI Ecosystem Research Loop

Fetches AI stories, diffs against the vault, debates relevance, stores net-new findings.
Designed for `/loop 30m` use. Output: concise bullet briefing + vault action.

## Steps

Work through these in order. Read each step file as you reach it.

1. **Vault baseline** — load today's note, extract dedup baseline and watch items
   → Read `steps/01-vault-baseline.md`

2. **Fetch** — parallel fetch from all sources
   → Read `steps/02-fetch.md`

3. **Diff and debate** — eliminate duplicates, score relevance
   → Read `steps/03-diff-debate.md`

4. **Store and output** — write to vault, emit briefing
   → Read `steps/04-store-output.md`

## Watch items

To add a watch item mid-session, read `steps/05-watch-items.md`.

## Running on a loop

```
/loop 30m /workflow:ecosystem-pulse
```

Cancel with `CronDelete` using the job ID returned by `/loop`.
