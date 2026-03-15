# NotebookLM CLI Reference

Complete command reference for agents interacting with NotebookLM.

**CRITICAL:** The CLI uses `key=value` argument syntax, NOT `--key=value`. Wrong syntax silently creates `Untitled.md` and returns exit 0.

---

## Commands

### Create a notebook
```bash
notebooklm create title="My Research Notebook" --json
```
Returns JSON with `id` field.

### Add a URL source
```bash
notebooklm source add url="https://example.com/article" notebook=NOTEBOOK_ID --json
```

### Add deep web research
```bash
# Fire and wait (blocking)
notebooklm source add-research query="topic keywords" mode=deep notebook=NOTEBOOK_ID

# Fire and don't wait (non-blocking)
notebooklm source add-research query="topic keywords" mode=deep notebook=NOTEBOOK_ID --no-wait
```

Modes: `deep` (20+ sources, 15-30 min), `fast` (fewer sources, 2-5 min)

### Wait for research to complete
```bash
notebooklm research wait notebook=NOTEBOOK_ID --import-all --timeout 1800
```
`--import-all` automatically adds discovered sources to the notebook.
`--timeout` in seconds (default 1800 = 30 min).

### List sources
```bash
notebooklm source list notebook=NOTEBOOK_ID --json
```
Returns array of sources with `id`, `title`, `status`, `url` fields.

### Delete a source
```bash
notebooklm source delete id=SOURCE_ID notebook=NOTEBOOK_ID
```

### Ask a question
```bash
# Ask and get the answer in stdout
notebooklm ask query="What are the key patterns?" notebook=NOTEBOOK_ID

# Ask and save the answer as a notebook note
notebooklm ask query="What are the key patterns?" notebook=NOTEBOOK_ID --save-as-note title="Key Patterns"
```

### List notebooks
```bash
notebooklm list --json
```

---

## Common Patterns

### Structured query for synthesis
```bash
notebooklm ask query="Summarize across all sources: (1) core concepts, (2) common patterns, (3) pitfalls." notebook=NOTEBOOK_ID
```

### Focused facet query (workshop mode)
```bash
notebooklm ask query="What do the sources say specifically about <facet>? Include contradictions." notebook=NOTEBOOK_ID
```

### Cross-examination query (seminar mode)
```bash
notebooklm ask query="What seems true about <topic> but might not be? What evidence supports and contradicts it?" notebook=NOTEBOOK_ID
```

---

## Gotchas

1. **Argument syntax**: `key=value` not `--key=value`. Wrong syntax = silent failure.
2. **Research time**: Deep mode takes 15-30 minutes. Use `--no-wait` and poll with `research wait`.
3. **Source limits**: Notebooks have a source limit. Curate aggressively.
4. **Large responses**: Ask queries may return long text. Pipe to file if needed.
5. **Rate limits**: Space out rapid-fire queries. 1-2 second pause between asks is safe.
