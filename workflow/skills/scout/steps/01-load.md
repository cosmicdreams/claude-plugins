# Step 1 — Load Config, Profile, and Vault Baseline

## Load the scout config

Read the `scout` block from `~/.claude/workflow.json`:

```bash
jq '.scout' ~/.claude/workflow.json 2>/dev/null
```

Expected shape:
```json
{
  "scout": {
    "sources": [
      { "type": "feed|page|search", "url": "string", "name": "string", "cadence": "3d", "weight": 1.0 }
    ],
    "interests": ["Claude Code", "multi-agent", "agentic workflows", "MCP"],
    "anti_interests": ["crypto", "funding rounds"],
    "feedback_weights": { "simonwillison.net": 1.4, "topic:funding": 0.2 }
  }
}
```

- **No `scout` block** → fall back to the seed source list in `steps/02-fetch.md`, use a default
  interest profile inferred from the user's known workflow, and offer to write a starter `scout`
  config at the end.

## Load feedback history

Feedback lives in the vault (reviewable):

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
FEEDBACK="$VAULT_ROOT/Meta/scout-feedback.jsonl"
tail -200 "$FEEDBACK" 2>/dev/null
```

Use it (with `feedback_weights`) to bias scoring in step 3: sources/topics marked useful get a
boost; muted sources/topics are suppressed.

## Vault baseline (dedup)

```bash
TODAY=$(date +%Y-%m-%d)
NOTE_PATH="$VAULT_ROOT/Raw/${TODAY}-scout.md"
```

If today's note exists, extract the highest `### N.` entry number and all story headlines (the dedup
baseline). If absent, create it:

```bash
cat > "$NOTE_PATH" << EOF
---
title: "Knowledge Radar — $TODAY"
date: $TODAY
type: raw
origin: scout
tags:
  - ai-agents
  - research
source: "workflow:scout"
---
EOF
```

Proceed to `steps/02-fetch.md` with: source list, interest profile, feedback weights, note path,
highest entry N, baseline headlines.
