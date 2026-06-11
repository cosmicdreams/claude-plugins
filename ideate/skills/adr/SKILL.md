---
name: adr
description: Capture an Architecture Decision Record (ADR) for a design choice, tool selection, retirement, or process change. Prompts for context, options considered, decision, and consequences. Stores to Neurons vault at Architecture/ADRs/. Use when making a significant technical decision, retiring a tool, choosing between approaches, or documenting why something was NOT done. Trigger phrases: "architecture decision", "adr", "document this decision", "record this decision", "why we chose", "ideate:adr".
triggers:
  - "architecture decision"
  - "adr"
  - "document this decision"
  - "record this decision"
  - "why we chose"
  - "ideate:adr"
allowed-tools: Bash, Read, Write
---

# ideate:adr — Architecture Decision Record

Capture a lightweight ADR and store it to the Neurons vault.

## Step 1: Gather fields

If not in `$ARGUMENTS`, ask for these. Gather all before writing.

| Field | Description |
|---|---|
| `title` | Short decision title |
| `status` | `proposed`, `accepted`, `superseded`, or `deprecated` |
| `context` | What situation prompted this decision? |
| `options` | What alternatives were considered? |
| `decision` | What was decided and why? |
| `consequences` | Results and trade-offs |
| `supersedes` | (Optional) Title of an ADR this replaces |

Extract what you can from `$ARGUMENTS` and ask only for what's missing.

## Step 2: Generate date and slug

```bash
date +%Y-%m-%d
```

Slug: lowercase title, spaces → hyphens, strip special characters, max 50 chars.

## Step 3: Format

```markdown
---
title: {title}
date: {YYYY-MM-DD}
status: {status}
{supersedes: {old-adr-title}   ← only if provided}
---

# {title}

## Status

{Status} — {YYYY-MM-DD}

## Context

{context}

## Options Considered

{options — list with brief pros/cons per option}

## Decision

{decision}

## Consequences

{consequences — positives (+) and negatives (-) explicit}
```

## Step 4: Store to Neurons vault

Path: `Architecture/ADRs/{YYYY-MM-DD}-{slug}.md`

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
ADR_PATH="Architecture/ADRs/{YYYY-MM-DD}-{slug}.md"
mkdir -p "$VAULT_ROOT/Architecture/ADRs"
cat > "$VAULT_ROOT/$ADR_PATH" << 'EOF'
<formatted ADR content>
EOF
```

On failure: output the formatted ADR in conversation so it is not lost, then report the error.

## Step 5: Confirm

Report title, status, and vault path. If `supersedes` was set, offer to update the old ADR's status to `superseded` with a link to the new one.
