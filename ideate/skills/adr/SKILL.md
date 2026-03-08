---
name: adr
description: Capture an Architecture Decision Record (ADR) for a design choice, tool selection, retirement, or process change. Prompts for context, options considered, decision, and consequences. Stores to Neurons vault at shared/Architecture/ADRs/. Use when making a significant technical decision, retiring a tool, choosing between approaches, or documenting why something was NOT done. Trigger phrases: "architecture decision", "adr", "document this decision", "record this decision", "why we chose", "ideate:adr".
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

Capture a lightweight ADR and store it permanently to the Neurons vault.

## Step 1: Gather information

If not supplied in `$ARGUMENTS`, ask the user for the following fields. Gather all before writing — do not write a partial ADR.

| Field | Description | Example |
|---|---|---|
| `title` | Short decision title | "Use Skills over MCPs for non-persistent tools" |
| `status` | Current status | `accepted`, `superseded`, or `deprecated` |
| `context` | What problem or situation prompted this decision? | "MCP tools load into context on every session..." |
| `options` | What alternatives were considered? | Option A: MCP server. Option B: Skill. |
| `decision` | What was decided and why? | "Use Skills — zero token cost until invoked" |
| `consequences` | What are the results and tradeoffs? | "+ lower token cost — manual invocation required" |
| `supersedes` | (Optional) Title or path of an ADR this replaces | "Use MCP for all integrations" |

If the user provides partial info in `$ARGUMENTS`, extract what you can and ask only for what's missing.

## Step 2: Generate date and slug

```bash
date +%Y-%m-%d
```

**Slug rules:** lowercase title, spaces → hyphens, strip special characters, max 50 chars.
Example: "Use Skills over MCPs for non-persistent tools" → `use-skills-over-mcps`

## Step 3: Format the ADR

```markdown
---
title: {title}
date: {YYYY-MM-DD}
status: {status}
supersedes: {supersedes, or omit if none}
---

# {title}

## Status

{Status} — {YYYY-MM-DD}

## Context

{context}

## Options Considered

{options — formatted as a list, with brief pros/cons per option}

## Decision

{decision}

## Consequences

{consequences — call out positives (+) and negatives (-) explicitly}
```

## Step 4: Store to Neurons vault

```bash
obsidian create \
  "vault=Neurons" \
  "path=shared/Architecture/ADRs/{YYYY-MM-DD}-{slug}.md" \
  "content={formatted ADR}"
```

**On success:** report `ADR saved: Neurons/shared/Architecture/ADRs/{YYYY-MM-DD}-{slug}.md`

**On failure:** output the formatted ADR directly in the conversation so it is not lost, then report the vault error.

## Step 5: Confirm and suggest follow-up

Tell the user:
- ADR title and status
- Vault path where it was saved
- If `supersedes` was set: offer to fetch the old ADR from the vault and update its status to `superseded` with a link to the new one
