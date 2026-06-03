# NotebookLM CLI Reference

Complete command reference for agents interacting with NotebookLM. Generated from `notebooklm <cmd> --help` output — not written from memory.

**CRITICAL:** The CLI uses standard `--key value` flag syntax (like most CLIs). Do NOT confuse with the Obsidian CLI which uses `key=value` syntax.

---

## Commands

### Create a notebook
```bash
notebooklm create "My Research Notebook" --json
```
Title is a positional argument. **The `--json` envelope is nested** as of v0.6.0:
`{"notebook": {"id": "...", "title": "...", "created_at": null}}` (older builds
returned a top-level `{"id": ...}`). Parse defensively:
`d.get('id') or d.get('notebook',{}).get('id')`. Capture **stdout only** — merging
stderr (`2>&1`) corrupts the JSON when the CLI prints a warning.

### Set current notebook context
```bash
notebooklm use <notebook-id>
```
Sets the default notebook so `-n` can be omitted from subsequent commands. Supports partial ID matching.

### Add a URL source
```bash
notebooklm source add "https://example.com/article" -n NOTEBOOK_ID --json
```
Content is a positional argument. Type is auto-detected (URL, file, text, YouTube).

### Add deep web research
```bash
# Fire and wait (blocking) — import is allowed here
notebooklm source add-research "topic keywords" -n NOTEBOOK_ID --mode deep --import-all

# Fire and don't wait (non-blocking) — NO --import-all here
notebooklm source add-research "topic keywords" -n NOTEBOOK_ID --mode deep --no-wait
```
Query is a positional argument. Modes: `deep` (20+ sources, 15-30 min), `fast` (fewer sources, 2-5 min).
**v0.6.0 RULE: `--import-all` cannot combine with `--no-wait`.** On the non-blocking
path, fire without it and import later on the wait (below). Combining them errors out.

### Wait for research to complete (and import)
```bash
notebooklm research wait --import-all -n NOTEBOOK_ID
```
Blocks until deep research completes, then commits the found sources. If you fired
with `--no-wait`, **`--import-all` belongs on this wait command** — otherwise the
web UI leaves an "Add sources?" modal open and nothing is imported.

### List sources
```bash
notebooklm source list -n NOTEBOOK_ID --json
```

### Delete a source
```bash
notebooklm source delete SOURCE_ID -n NOTEBOOK_ID
```
Source ID is a positional argument. Supports partial ID matching.

### Ask a question
```bash
# Ask and get the answer in stdout
notebooklm ask "What are the key patterns?" -n NOTEBOOK_ID

# Ask and save the answer as a notebook note
notebooklm ask "What are the key patterns?" -n NOTEBOOK_ID --save-as-note --note-title "Key Patterns"

# Limit to specific sources
notebooklm ask "Compare these" -n NOTEBOOK_ID -s SOURCE_ID_1 -s SOURCE_ID_2

# Get structured JSON output with source references
notebooklm ask "Explain X" -n NOTEBOOK_ID --json
```
Question is a positional argument — no `--query` flag. Continues the last conversation by default. Switching notebooks auto-starts a new conversation.

### List notebooks
```bash
notebooklm list --json
```

---

## Common Patterns

### Structured query for synthesis
```bash
notebooklm ask "Summarize across all sources: (1) core concepts, (2) common patterns, (3) pitfalls." -n NOTEBOOK_ID
```

### Focused facet query (gather facet fan-out)
```bash
notebooklm ask "What do the sources say specifically about <facet>? Include contradictions." -n NOTEBOOK_ID
```

### Cross-examination query (synthesize / interrogate)
```bash
notebooklm ask "What seems true about <topic> but might not be? What evidence supports and contradicts it?" -n NOTEBOOK_ID
```

### Save synthesis as a note
```bash
notebooklm ask "Summarize key themes on <topic>" -n NOTEBOOK_ID --save-as-note --note-title "Summary: <topic>"
```

---

## Gotchas

1. **Flag syntax is `--key value`** — NOT `key=value`. The `key=value` syntax is for the Obsidian CLI, not NotebookLM.
2. **Question is positional** — `notebooklm ask "question"`, not `notebooklm ask --query "question"`.
3. **`--new` IS a real flag** (v0.6.0) and is **destructive** — it deletes the
   notebook's current server-side conversation before asking. `--json` implies
   `--yes`. Use `-c <id>` to continue a specific conversation instead.
4. **Research time**: Deep mode takes 15-30 minutes. Use `--no-wait` and monitor with `notebooklm research status`.
5. **Partial IDs**: Notebook and source IDs support prefix matching — `abc` matches `abc123def456`.
6. **Source limits**: Notebooks have a source limit. Curate aggressively.
7. **Rate limits**: Space out rapid-fire queries. 1-2 second pause between asks is safe.
8. **Duplicates are guaranteed** after `--import-all` deep research: seeds get
   re-imported and pages arrive under URL variants. Always run
   `notebook-dedup.sh NOTEBOOK_ID --apply` after import.
9. **Never pass an empty `-n`** — the CLI silently falls back to the *current
   context* notebook and pollutes it. Always pass an explicit, validated id.
10. **Degraded answers**: v0.6.0 `ask` can warn "No marked answer found" and return
    a short reasoning fragment instead of the synthesis. `notebook-ask.sh` retries
    once on this; if calling `ask` directly, re-run on that warning.
11. **Version drift breaks scripts** silently. A local-source pipx install makes
    `pipx upgrade` a no-op — `notebook-postflight.sh` flags both. Prefer
    `pipx install "notebooklm-py[browser]"` from PyPI.
