# `nlm` CLI Reference (NotebookLM MCP CLI)

Verified against **`nlm` 0.9.11** by probing the installed binary (`nlm --ai`, `nlm <group> --help`)
— not written from memory. If something isn't here, run `nlm <group> --help` before guessing; the
surface is large and grouped.

**Package:** `notebooklm-mcp-cli` · **Binaries:** `nlm` (command line), `notebooklm-mcp` (Model
Context Protocol server).

```bash
uv tool install notebooklm-mcp-cli     # recommended
pipx install notebooklm-mcp-cli        # alternative
nlm --ai                               # dump the full machine-readable command reference
```

---

## Migrating from the retired `notebooklm` CLI

The old CLI (pipx package `notebooklm-py`, repo `jacob-bd/notebooklm-cli`) was **archived
2026-06-26** and merged into this tool. Its login no longer works. Two structural changes drive
every rewrite below:

1. **Verb-first → noun-first.** `notebooklm ask ...` became `nlm notebook query ...`.
2. **The notebook id is POSITIONAL, not `-n`.** The sole exception is `research start`, where the
   positional slot holds the query, so the notebook stays on `-n/--notebook-id`.

| Retired `notebooklm` | Current `nlm` |
|---|---|
| `notebooklm list` | `nlm notebook list` |
| `notebooklm create "T" --json` | `nlm notebook create "T" --json` |
| `notebooklm use <id>` | *(gone — no current-context notebook; pass the id, or set an alias)* |
| `notebooklm ask "Q" -n ID` | `nlm notebook query ID "Q"` |
| `notebooklm ask "Q" -n ID --json` | `nlm notebook query ID "Q" --json` |
| `notebooklm ask ... -s SID -s SID2` | `nlm notebook query ID "Q" --source-ids SID,SID2` |
| `notebooklm ask ... --save-as-note --note-title "T"` | two calls: `nlm notebook query`, then `nlm note create ID --content "…" --title "T"` |
| `notebooklm source add URL -n ID --type url` | `nlm source add ID --url URL` |
| `notebooklm source list -n ID --json` | `nlm source list ID --json` |
| `notebooklm source delete SID -n ID --yes` | `nlm source delete SID --confirm` |
| `notebooklm source clean -n ID` | *(gone — use `notebook-dedup.sh`)* |
| `notebooklm source add-research "Q" -n ID --mode deep --no-wait` | `nlm research start "Q" -n ID --mode deep` |
| `notebooklm source add-research "Q" -n ID --mode deep --import-all` | `nlm research start "Q" -n ID --mode deep --auto-import` |
| `notebooklm research wait --import-all -n ID` | `nlm research status ID --max-wait 900` then `nlm research import ID` |
| `notebooklm configure -n ID --mode default` | `nlm chat configure ID --goal default` |
| `notebooklm configure -n ID --persona "…"` | `nlm chat configure ID --goal custom --prompt "…"` |
| `notebooklm generate report -n ID --format briefing-doc` | `nlm report create ID --format "Briefing Doc" --confirm` |
| `notebooklm generate slide-deck -n ID` | `nlm slides create ID --confirm` |
| `notebooklm generate audio -n ID` | `nlm audio create ID --confirm` |
| `notebooklm artifact retry AID -n ID --wait` | *(gone — inspect `nlm studio status ID`, then re-create)* |
| `notebooklm share public -n ID --enable` | `nlm share public ID` |
| `pipx install "notebooklm-py[browser]"` | `uv tool install notebooklm-mcp-cli` |

**Other renames to watch:** `--yes` → `--confirm`; generators now require `--confirm` because they
cost quota; quiz difficulty is numeric (`--difficulty 3`), not a word.

---

## Login & auth

Browser-based: `nlm login` opens a browser, you sign in, cookies are extracted automatically.
Cookies last roughly **2–4 weeks** and refresh headlessly when a saved profile exists.

```bash
nlm login                     # authenticate (opens browser)
nlm login --check             # probe only — use this in preflight, it creates no load
nlm login --profile work      # named profile for a second Google account
nlm login switch <profile>    # change the default profile
nlm login profile list        # list profiles with their email addresses
```

---

## Command groups

`nlm` accepts both **noun-first** (`nlm notebook create`) and **verb-first** (`nlm create notebook`)
forms. **Prefer noun-first** everywhere in this plugin — it is the documented primary form and the
one the mapping table above uses.

Groups: `login notebook source note label chats chat studio research alias config download share
export skill setup doctor batch cross pipeline tag audio report quiz flashcards mindmap slides
infographic video data-table`.

---

## Notebooks

```bash
nlm notebook list                        # list (also --json, --quiet, --title, --full)
nlm notebook create "Title" --json       # create; --json returns the id
nlm notebook get <id> --json             # details
nlm notebook describe <id> --json        # AI summary + suggested topics (parseable structure)
nlm notebook rename <id> "New Title"
nlm notebook delete <id> --confirm --json
nlm notebook query <id> "question"       # chat with sources
nlm notebook query <id> "question" --json
nlm notebook query <id> "follow up" --conversation-id <cid>
nlm notebook query <id> "question" --source-ids <id1,id2>
nlm notebook query <id> "question" --timeout 300    # default 120s
```

All querying — command line and Model Context Protocol — persists chat history into the NotebookLM
web interface.

---

## Sources

```bash
nlm source list <notebook-id> --json     # also --full, --quiet, --url, --drive
nlm source add <notebook-id> --url "https://…" --json     # --json returns the new source id
nlm source add <notebook-id> --url "https://…" --wait     # wait until processed
nlm source add <notebook-id> --text "content" --title "Title"
nlm source add <notebook-id> --file /path/to/doc.pdf
nlm source get <source-id> --json
nlm source describe <source-id> --json   # AI summary + keywords
nlm source content <source-id>           # raw text, no AI processing
nlm source delete <source-id> --confirm --json
```

**Failed URLs leave a stub.** When NotebookLM cannot fetch a URL, `source add` exits **1** with
`{"status":"error","error":"Could not add url source."}` — but a source record still lands in the
notebook, titled with the raw URL and carrying `status: 3` (ready sources are `status: 2`). Those
stubs hold no text and silently dilute later synthesis. `notebook-dedup.sh` reports them; pass
`--prune-failed --apply` to remove them. The status codes are observed, not documented.

---

## Research

Deep mode returns ~40 sources and takes about five minutes, but can run much longer on a broad
query — budget 15 minutes.

```bash
nlm research start "query" -n <notebook-id> --mode deep         # fire and return
nlm research start "query" -n <notebook-id> --mode deep --auto-import   # wait, then import
nlm research start "query" --title "New Notebook"               # create the destination too
nlm research status <notebook-id> --max-wait 900                # poll until done
nlm research status <notebook-id> --max-wait 0                  # single check
nlm research import <notebook-id>                               # task id auto-detects
nlm research import <notebook-id> --cited-only                  # only sources the report cited
```

Use `${CLAUDE_PLUGIN_ROOT}/scripts/notebook-research-wait.sh <id>` rather than hand-rolling the
status-then-import pair.

---

## Notes

```bash
nlm note list <notebook-id>
nlm note create <notebook-id> --content "body" --title "Title"
nlm note update <note-id> --content "new body"
nlm note delete <note-id>
```

`--content` takes a **string**; there is no stdin form. To store a file: `--content "$(cat file.md)"`.

---

## Chat configuration (notebook persona)

Persona is per-notebook now, not a global mode:

```bash
nlm chat configure <notebook-id> --goal default        # default | learning_guide | custom
nlm chat configure <notebook-id> --goal custom --prompt "Act as a skeptical examiner…"
nlm chat configure <notebook-id> --response-length longer   # longer | default | shorter
```

---

## Studio artifacts

All generators cost quota and require `--confirm`.

```bash
nlm report create <id> --format "Briefing Doc" --confirm   # Briefing Doc | Study Guide | Blog Post | Create Your Own
nlm report create <id> --format "Create Your Own" --prompt "…" --confirm
nlm slides create <id> --confirm
nlm slides revise <artifact-id> --slide '1 Make the title larger' --confirm
nlm audio create <id> --confirm --json                    # --format deep_dive|brief, --language
nlm video create <id> --confirm
nlm infographic create <id> --confirm
nlm mindmap create <id> --confirm                         # visual artifact; not parseable
nlm quiz create <id> --count 5 --difficulty 3 --confirm
nlm flashcards create <id> --confirm
nlm studio status <id> --json                             # all artifacts + status
nlm download audio <id> <artifact-id>
nlm download all <id> -d ./exports
```

There is no in-place retry. A failed artifact must be re-created.

---

## Aliases (shortcuts for identifiers)

```bash
nlm alias list                       # check before creating
nlm set alias myproject <notebook-id>
nlm source list myproject            # usable anywhere an id is expected
```

---

## Diagnostics & integration

```bash
nlm doctor                  # diagnose installation and configuration
nlm --version               # self-reports whether a newer release exists
nlm setup add claude-code   # configure the Model Context Protocol server for Claude Code
nlm skill install           # install the tool's own bundled skills
```

---

## House rule

Prefer the wrappers in `${CLAUDE_PLUGIN_ROOT}/scripts/` over raw `nlm` calls — they pin the correct
syntax, retry degraded answers, and keep progress output on stderr so stdout stays parseable:

`notebook-setup.sh` · `notebook-ask.sh` · `notebook-research-wait.sh` · `notebook-dedup.sh` ·
`notebook-preflight.sh` · `notebook-postflight.sh`
