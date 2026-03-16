# NotebookLM CLI Reference

Complete command reference for agents interacting with NotebookLM. Generated from `notebooklm <cmd> --help` output — not written from memory.

**CRITICAL:** The CLI uses standard `--key value` flag syntax (like most CLIs). Do NOT confuse with the Obsidian CLI which uses `key=value` syntax.

---

## Commands

### Create a notebook
```bash
notebooklm create "My Research Notebook" --json
```
Returns JSON with `id` field. Title is a positional argument.

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
# Fire and wait (blocking)
notebooklm source add-research "topic keywords" -n NOTEBOOK_ID --mode deep --import-all

# Fire and don't wait (non-blocking)
notebooklm source add-research "topic keywords" -n NOTEBOOK_ID --mode deep --no-wait
```
Query is a positional argument. Modes: `deep` (20+ sources, 15-30 min), `fast` (fewer sources, 2-5 min). `--import-all` auto-imports found sources.

### Wait for research to complete
```bash
notebooklm research wait -n NOTEBOOK_ID
```
Blocks until deep research completes.

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

### Focused facet query (workshop mode)
```bash
notebooklm ask "What do the sources say specifically about <facet>? Include contradictions." -n NOTEBOOK_ID
```

### Cross-examination query (seminar mode)
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
3. **No `--new` flag** — the help text mentions "Use --new to start fresh" but it's not a formal option. Switching notebooks auto-starts a new conversation.
4. **Research time**: Deep mode takes 15-30 minutes. Use `--no-wait` and monitor with `notebooklm research status`.
5. **Partial IDs**: Notebook and source IDs support prefix matching — `abc` matches `abc123def456`.
6. **Source limits**: Notebooks have a source limit. Curate aggressively.
7. **Rate limits**: Space out rapid-fire queries. 1-2 second pause between asks is safe.
