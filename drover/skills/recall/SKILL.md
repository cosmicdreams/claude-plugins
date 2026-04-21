---
name: recall
description: >
  Search drover ticket history for verified solutions matching a keyword or fingerprint.
  Walks every registered project board and surfaces past Actual solution blocks so
  you can reuse fixes when similar errors reappear. Use when you encounter an error
  and want to know whether it's been solved before.
triggers:
  - "drover:recall"
  - "has drover seen"
  - "search drover solutions"
  - "find past fix for"
  - "recall drover"
allowed-tools: Bash, Read
---

# drover:recall — Search past drover solutions

Runs `recall-search.sh` over every registered drover project and returns ranked
matches with verified Actual solution blocks. Use when a new error looks familiar
and you want to know if drover's already got a fix on record.

## Usage

```
/drover:recall "<query>"
/drover:recall --fingerprint <fp>
/drover:recall --include-projected "<query>"
```

Examples:
- `/drover:recall "paragraph reference"` — keyword search over verified solutions
- `/drover:recall --fingerprint f4a9c0b1d2e3` — exact fingerprint lookup
- `/drover:recall --include-projected "memory exhausted"` — includes unverified Projected-only hits

## Step 1: Pre-flight

```bash
SCRIPT="${CLAUDE_PLUGIN_ROOT:-$(ls -d ~/.claude/plugins/cache/local/drover/*/ | tail -1)}/scripts/recall-search.sh"
[ -x "$SCRIPT" ] || { echo "recall-search.sh not found or not executable"; exit 1; }
```

## Step 2: Run the search

```bash
# Forward all arguments as-is — the script handles flags and the query.
"$SCRIPT" "$@"
```

## Step 3: Interpret results

Ranked output format:

```
[verified]   drover-a1f  [ahri]           fp:f4a9c0b1d2e3
  root_cause: Paragraph reference to a deleted entity caused a fatal hydration error.
  fix_summary: Added a null-guard in the paragraph render hook.

[verified]   drover-b2g  [massport]       fp:e7d3a1c8b9f0
  root_cause: Similar fatal on unpublished paragraph translations.
  fix_summary: Extended the same null-guard to the translation hook.

[unverified] drover-proj-x  [kellogg]     fp:c1b2a3d4e5f6
  root_cause: Hypothesized paragraph reference edge case (Projected, not yet verified).
  fix_summary: Guard proposed but not yet applied.
```

Labels:
- `[verified]` — ticket has an `Actual` block written by a user or backfill signal.
  Authoritative.
- `[unverified]` — Projected-only. The implementer agent's hypothesis, not yet
  confirmed. Only appears with `--include-projected`.

## Step 4: Dig deeper (optional)

For a full ticket body (including fix commit, review metadata, notes history):

```bash
cd <project_path>
bd show <ticket_id> --format markdown
```

## Notes

- Recall quality depends on the Actual corpus. If recall returns thin results,
  capture more solutions via `/drover:solution <ticket-id>` when you fix errors.
- Fingerprints are deterministic from error AST structure — cross-project matches
  are signal that the same root issue exists elsewhere.
- ADR reference: `2026-04-21-drover-solution-capture-schema.md`.
- Future centralization (ADR `2026-04-21-drover-cross-project-solution-centralization`)
  will extend recall to also search a shared Velir-wide knowledge repo after the
  Friday demo + compliance sign-off.
