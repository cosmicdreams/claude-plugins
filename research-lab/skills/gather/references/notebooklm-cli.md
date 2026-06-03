# NotebookLM CLI Reference

Command reference for agents interacting with NotebookLM. Verified against `notebooklm <cmd> --help`
for **v0.6.0** — not written from memory. If a command isn't here, run `notebooklm <group> --help`
before guessing; the surface is large and grouped.

**CRITICAL:** The CLI uses standard `--key value` flag syntax (like most CLIs). Do NOT confuse with the Obsidian CLI which uses `key=value` syntax.

**Command groups (run `notebooklm <group> --help` for the full list):**
`source`, `note`, `generate`, `research`, `share` are *groups* with subcommands. `create`, `use`,
`ask`, `list`, `configure` are top-level. A common mistake is calling a subcommand at top level —
e.g. it is `notebooklm generate revise-slide` and `notebooklm share public`, NOT `notebooklm revise-slide` / `notebooklm share --public`.

---

## Notebooks

### Create a notebook
```bash
notebooklm create "My Research Notebook" --json     # -u/--use also makes it the current context
```
Title is positional. **The `--json` envelope is nested** as of v0.6.0:
`{"notebook": {"id": "...", "title": "...", "created_at": null}}` (older builds returned top-level
`{"id": ...}`). Parse defensively: `d.get('id') or d.get('notebook',{}).get('id')`. Capture **stdout
only** — merging stderr (`2>&1`) corrupts the JSON when the CLI prints a warning.

### Set / list notebooks
```bash
notebooklm use <notebook-id>     # set current context so -n can be omitted (partial IDs ok)
notebooklm list --json           # list notebooks
```

### Configure chat behavior (run once before asking)
```bash
notebooklm configure -n NOTEBOOK_ID --mode default          # default | learning-guide | concise | detailed
notebooklm configure -n NOTEBOOK_ID --persona "You are a skeptical Drupal performance reviewer…"
notebooklm configure -n NOTEBOOK_ID --response-length longer # default | longer | shorter
```
`--mode` and `--persona` are mutually useful: `--mode` picks a predefined chat style; `--persona`
sets a custom prompt (up to 10,000 chars). research-lab verbs use these — `gather`/`synthesize`
(`--mode concise|detailed`), `teach` (`--mode learning-guide`), `interrogate` (`--persona …`).

---

## Sources

```bash
notebooklm source add "https://example.com/article" -n NOTEBOOK_ID --json   # content positional; type auto-detected (url/file/text/youtube)
notebooklm source list -n NOTEBOOK_ID --json
notebooklm source delete SOURCE_ID -n NOTEBOOK_ID --yes                      # SOURCE_ID positional, partial IDs ok
notebooklm source clean -n NOTEBOOK_ID --dry-run                            # see "Deduping" below
```
Other `source` subcommands (run `--help`): `add-drive`, `get`, `fulltext`, `guide` (AI summary +
keywords), `stale`, `wait`, `delete-by-title`, `rename`, `refresh`.

### Add deep web research
```bash
# Blocking — import allowed here
notebooklm source add-research "topic keywords" -n NOTEBOOK_ID --mode deep --import-all

# Non-blocking — NO --import-all here
notebooklm source add-research "topic keywords" -n NOTEBOOK_ID --mode deep --no-wait
```
Query is positional. Flags: `--from [web|drive]`, `--mode [fast|deep]` (deep = 20+ sources, 15–30
min; fast = fewer, 2–5 min), `--import-all`, `--cited-only` (with `--import-all`, import only cited
results), `--no-wait`, `--timeout` (per-phase seconds, default 1800).
**v0.6.0 RULE: `--import-all` cannot combine with `--no-wait`.** Fire without it on the non-blocking
path and import later on the wait (below).

### Monitor / finish research
```bash
notebooklm research status -n NOTEBOOK_ID                 # non-blocking check
notebooklm research wait --import-all -n NOTEBOOK_ID      # block until done, then commit found sources
```
If you fired with `--no-wait`, **`--import-all` belongs on the `research wait`** — otherwise the web
UI leaves an "Add sources?" modal open and nothing is imported.

### Deduping
`notebooklm source clean` natively removes **duplicate, error, and access-blocked** sources
(`--dry-run` to preview, `-y` to skip confirmation). It does NOT collapse URL *variants* (trailing
slash, `#fragment`, `?query`) — `notebook-dedup.sh` handles those by normalized URL. After an
`--import-all` deep research run, run `source clean` and then `notebook-dedup.sh NOTEBOOK_ID --apply`.

---

## Ask

```bash
notebooklm ask "What are the key patterns?" -n NOTEBOOK_ID                 # answer to stdout
notebooklm ask "Summarize X" -n NOTEBOOK_ID --save-as-note --note-title "X"# save answer as a note
notebooklm ask "Compare these" -n NOTEBOOK_ID -s SOURCE_ID_1 -s SOURCE_ID_2 # limit to sources (-s repeatable)
notebooklm ask "Explain X" -n NOTEBOOK_ID --json                           # structured output w/ references
```
Question is positional (or `--prompt-file <file|->`). `--save-as-note` is a **bare boolean**; the
title rides on a separate `--note-title`. Continues the last conversation by default; `-c <id>`
continues a specific one. `--timeout <s>` (default 30) for long prompts. Prefer
`${CLAUDE_PLUGIN_ROOT}/scripts/notebook-ask.sh` — it retries the v0.6.0 "No marked answer found"
degraded answer.
**`--new` is DESTRUCTIVE** — it deletes the notebook's current server-side conversation before
asking. `--json` implies `-y/--yes`.

---

## Notes

`note` is a group: `create`, `save`, `get`, `list`, `rename`, `delete`.

```bash
# Create a NEW note (this is how you persist an understand/synthesize record):
notebooklm note create -n NOTEBOOK_ID -t "Understanding: TARGET" --content - < /tmp/record.md
notebooklm note create -n NOTEBOOK_ID "Inline content" -t "Title"     # content positional, or --content -/stdin

# Update an EXISTING note (needs the note id) — NOT for creating:
notebooklm note save NOTE_ID -n NOTEBOOK_ID --content "new body" --title "new title"

notebooklm note list -n NOTEBOOK_ID --json
notebooklm note get NOTE_ID -n NOTEBOOK_ID
```
**`note create` vs `note save`:** `create` makes a new note (content positional or `--content -` from
stdin; `-t/--title`). `save` *updates* an existing note by `NOTE_ID` (`--content`, `--title`). There
is no `--content-file` flag — pipe a file via `--content -`. Saving an answer directly from a query
is `ask --save-as-note --note-title` instead.

---

## Generate (artifacts — the `teach` toolkit)

`generate` is a group. Subcommands: `report`, `slide-deck`, `revise-slide`, `audio`, `video`,
`cinematic-video`, `infographic`, `flashcards`, `quiz`, `data-table`, `mind-map`.

```bash
notebooklm generate report -n NOTEBOOK_ID --format briefing-doc   # briefing-doc | study-guide | blog-post | custom
notebooklm generate report -n NOTEBOOK_ID --format study-guide --append "Target audience: beginners"
notebooklm generate slide-deck -n NOTEBOOK_ID
notebooklm generate revise-slide -n NOTEBOOK_ID "<change>"         # NOTE: under `generate`, not top-level
notebooklm generate audio -n NOTEBOOK_ID                          # podcast-style overview
notebooklm generate infographic -n NOTEBOOK_ID
notebooklm generate flashcards -n NOTEBOOK_ID
notebooklm generate mind-map -n NOTEBOOK_ID
notebooklm generate data-table -n NOTEBOOK_ID                     # native decision tables / ranked rows
notebooklm generate quiz -n NOTEBOOK_ID --difficulty medium       # easy|medium|hard; --quantity fewer|standard|more
```
Most generators take `-s/--source` (repeatable), `--prompt-file`, and `--wait/--no-wait` with
`--timeout`/`--interval`. `quiz` powers `teach`'s Feynman gate — parse its questions/answers into the
gate's `[{q, answer}]` shape.

---

## Share

`share` is a group: `public`, `status`, `add`, `remove`, `update`, `view-level`.
```bash
notebooklm share public -n NOTEBOOK_ID --enable          # or --disable  (NOT `share --public`)
notebooklm share status -n NOTEBOOK_ID
notebooklm share view-level -n NOTEBOOK_ID ...           # what viewers can access (full notebook vs chat only)
notebooklm share add user@example.com -n NOTEBOOK_ID --permission viewer
```

---

## Gotchas

1. **Flag syntax is `--key value`** — NOT `key=value` (that's the Obsidian CLI).
2. **Question is positional** — `notebooklm ask "question"`, not `ask --query "question"`.
3. **Subcommands aren't top-level** — `generate revise-slide`, `share public`, `note create` (not
   `revise-slide` / `share --public` / a bare `note save` for new notes).
4. **`note create` to persist a record; `note save` only updates an existing note id.** No
   `--content-file` — pipe a file with `--content -`.
5. **`--new` (ask) is DESTRUCTIVE** — deletes the current server-side conversation; `--json` implies `--yes`.
6. **Research time**: deep mode 15–30 min — use `--no-wait` and `research status`/`research wait`.
7. **`--import-all` cannot combine with `--no-wait`** — import on the `research wait` instead.
8. **Partial IDs**: notebook/source/note IDs support prefix matching.
9. **Duplicates after `--import-all`**: run `source clean` (exact dups/errors/blocked) **and**
   `notebook-dedup.sh NOTEBOOK_ID --apply` (URL variants).
10. **Never pass an empty `-n`** — the CLI falls back to the *current context* notebook and pollutes
    it. Always pass an explicit, validated id (or set one with `notebooklm use`).
11. **Capture stdout only** for `--json` (no `2>&1`) — a warning on stderr corrupts the JSON.
12. **Degraded answers**: v0.6.0 `ask` can warn "No marked answer found" and return a short fragment;
    `notebook-ask.sh` retries once.
13. **Version drift breaks scripts** silently. A local-source pipx install makes `pipx upgrade` a
    no-op — `notebook-postflight.sh` flags both. Prefer `pipx install "notebooklm-py[browser]"` from PyPI.
