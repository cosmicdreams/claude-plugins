# Step 1 — Vault Baseline

## Locate today's note

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
TODAY=$(date +%Y-%m-%d)
NOTE_PATH="$VAULT_ROOT/Research/AI-Agent-Teams/${TODAY}-ai-ecosystem-update.md"
```

If today's note exists, extract:
- The highest `### N.` entry number (for next entry numbering)
- All story headlines as the dedup baseline
- Any active **watch items** (lines after `## Watch Item`)

If the note doesn't exist, create it:

```bash
cat > "$NOTE_PATH" << EOF
---
title: "AI Ecosystem Update — $TODAY"
date: $TODAY
tags:
  - ai-agents
  - research
  - automation
source: "workflow:ecosystem-pulse"
---
EOF
```

Proceed to `steps/02-fetch.md` with: note path, highest entry N, baseline headlines, watch items list.
