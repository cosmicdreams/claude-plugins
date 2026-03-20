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
  stories about ai driven workflows". Also trigger for "office:ecosystem-pulse".

  Do NOT trigger for: general web searches, single-source news fetches, or Slack/Jira monitoring
  (use office:pulse for that).
triggers:
  - "office:ecosystem-pulse"
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

# office:ecosystem-pulse — AI Ecosystem Research Loop

Fetches AI ecosystem stories from multiple sources, diffs against the vault to eliminate
repeats, debates relevance, and stores only net-new findings. Designed for `/loop 30m` use.

**Output:** Concise bullet briefing + vault action. No walls of text.

---

## Step 1: Load vault baseline

Determine today's vault note path and read existing entry numbers to avoid duplication.

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
TODAY=$(date +%Y-%m-%d)
NOTE_PATH="$VAULT_ROOT/Research/AI-Agent-Teams/${TODAY}-ai-ecosystem-update.md"
```

If today's note exists, extract the highest `### N.` entry number and all story headlines
as the dedup baseline. If the note doesn't exist, create it with a minimal frontmatter header:

```bash
cat > "$NOTE_PATH" << EOF
---
title: "AI Ecosystem Update — $TODAY"
date: $TODAY
tags:
  - ai-agents
  - research
  - automation
source: "office:ecosystem-pulse"
---
EOF
```

Also check for active **watch items** at the bottom of the note (lines after `## Watch Item`).
Keep a list of what you're watching — surface any watch item hits in Step 4.

---

## Step 2: Fetch stories in parallel

Fetch all sources simultaneously using parallel WebFetch calls. Do NOT wait for one before
starting the next.

**Primary sources:**
- `https://simonwillison.net/` — AI agents, Claude, MCP, developer tooling (last 3 days)
- `https://news.ycombinator.com/` — AI/dev tooling stories with 50+ points
- `https://www.anthropic.com/news` — Anthropic announcements
- `https://www.deeplearning.ai/the-batch/` — AI ecosystem roundup

**Prompt for each fetch:** "List recent stories about AI agents, Claude, MCP, developer tooling,
CLI tools for AI, AI workflows, coding productivity, and claudepilled developer practices.
Titles and 1-line summaries only. Focus on the last 3 days."

If a source returns no relevant content, skip it silently.

**Supplemental search** (run in parallel with fetches):
- WebSearch: `Claude Code new features [current month year]`
- WebSearch: `AI agent CLI tools developer productivity [current month year]`

---

## Step 3: Diff against baseline

Compare fetched story titles and summaries against the vault baseline headlines.

**Dedup rules:**
- If a story's core topic matches a vault entry (same tool, same announcement, same concept)
  → mark as **duplicate**, skip it
- If a story adds new detail to an existing vault entry → mark as **augment** (update in place)
- If a story has no match → mark as **net-new**

Err toward treating as net-new when uncertain. False positives (minor overlap) are better
than missing genuinely new information.

---

## Step 4: Debate relevance

For each net-new story, assess using three lenses:

| Lens | Question |
|---|---|
| **Pragmatist** | Is this actionable today in my workflow? |
| **Trends** | Does this signal where the ecosystem is heading? |
| **Builder** | Would I build something differently because of this? |

**User workflow context:** Claude Code-heavy, multi-agent sprints, Claude-Plugins system
(~/Tools/CLAUDE-PLUGINS), octo skills, Obsidian vault, recurring research loops.

Score each story:
- **Keep** — 2+ lenses say yes, or 1 lens says strongly yes
- **Watch** — directionally relevant but no immediate action (note briefly)
- **Skip** — no lens finds value (cultural signal already internalized, unrelated to stack)

**Watch items:** If any active watch item from Step 1 has a hit in the fetched stories,
flag it with a `[WATCH HIT]` prefix in the output.

---

## Step 5: Store net-new findings

Append to today's note in `~/Vaults/Neurons/Research/AI-Agent-Teams/`.

**Format for each kept entry:**

```markdown
## Update — [Month Day]

### [N]. [Story Title]
[2-4 sentence summary covering: what it is, why it matters, specific relevance to this stack]
**For [tool/skill/workflow]:** [concrete implication or action item]
Source: [source name and link if available]
```

For **augment** entries: find the existing entry in the note and append a new paragraph
starting with `**Update [date]:**` rather than creating a new top-level entry.

For **watch** items that didn't make the Keep cut: append to the `## Watch Item` section
at the bottom of the note (create the section if absent).

---

## Step 6: Output briefing

Deliver a concise briefing — no more than 10 lines unless there's a watch hit.

```
**Ecosystem Pulse — [HH:MM]**
Sources: Simon Willison, HN, Anthropic news [+ any others that returned results]

NET-NEW ([N] stories):
• [Story title] — [one-line why it matters]
• [Story title] — [one-line why it matters]

AUGMENTED:
• Entry #[N]: [what was added]

WATCH HIT: [item] — [what was found]  ← only if applicable

SKIPPED: [N] duplicates, [N] irrelevant
Vault: [N] entries added to Research/AI-Agent-Teams/[filename]
```

If nothing new: `✓ Ecosystem Pulse [HH:MM] — no net-new stories. Vault unchanged.`

---

## Running on a loop

```
/loop 30m /office:ecosystem-pulse
```

The hook in admin plugin (admin 2.3.3+) restores this loop automatically after compaction.
Cancel with `CronDelete` using the job ID returned by `/loop`.

---

## Watch items

To add a watch item mid-session:
> "Keep an eye out for [X]"

Append to the `## Watch Item` section of today's vault note:

```markdown
### [Topic] — [GA/Announcement/Release]
Current status: [what's known now]
**Watching for:** [specific trigger]
**Why:** [user's reason]
```

The next pulse run will check fetched stories against all active watch items.
