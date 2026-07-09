---
name: ideas-funnel:funnel-export
description: >
  Exports high-signal Beads cards or review items into Raw/ for wiki ingest.
  Respects ready caps and keeps automation below the human decision boundary.
  Trigger phrases: "export funnel", "/ideas-funnel:funnel-export".
triggers:
  - /ideas-funnel:funnel-export
  - export funnel
allowed-tools:
  - Bash
  - Read
  - Write
---

**Used by:** Fable supervisor recommendation + human when ready/review lanes need to graduate.

# ideas-funnel:funnel-export

Move selected high-signal cards into `Raw/` as ingestable source material.

## Rules

- Do not export every card in a lane. Use caps.
- Prefer cards with multiple signals, high relevance, or explicit human interest.
- Write one markdown file per exported idea under `Raw/YYYY-MM-DD-<slug>.md`
  or `Raw/Inbox/<domain>/YYYY-MM-DD-<slug>.md`.
- Include original Beads id, source URL, summary, why it matters, and next step.
- Update the Beads card metadata when `bd` is available:
  `graduated_to_raw=YYYY-MM-DD`, `raw_path=<path>`.

## Output

Return JSON:

```json
{
  "exported": 0,
  "skipped": 0,
  "raw_paths": []
}
```
