---
name: gather
description: >
  The librarian verb: collect and curate sources on a question — create a NotebookLM
  notebook, seed it, fire deep web research, curate with the user, and produce a
  structured source summary. Bringing material in; digesting it is
  research-lab:understand.
triggers:
  - "gather research on"
  - "research this topic"
  - "build a notebook on"
  - "collect sources on"
  - "literary review"
  - "research-lab:gather"
  - "research-lab:literary-review"
allowed-tools: Bash, Read, Write, Agent, Workflow
---

# Gather

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Collect and curate sources on a question or topic. Create a NotebookLM notebook, seed sources, fire deep web research, curate with the user, run synthesis queries, and produce a structured source summary. The "librarian" verb of the research arc — it brings material in; digesting it is understand's job. Use standalone for any knowledge-gathering task. Say "gather research on", "research this topic", "build a notebook on", "collect sources on", or "research-lab:gather". Formerly research-lab:literary-review (renamed in 2.0).

Collect and curate knowledge via NotebookLM and deep web research. The **librarian** of the
research arc (`frame → gather → understand → synthesize → interrogate → experiment → teach`):
it brings material *in*. It does not digest that material — that is `understand`.

**Stance:** librarian — comprehensive collection, then ruthless curation.
**Notebook persona:** `notebooklm configure --mode default`.

**NotebookLM CLI reference:** `${CLAUDE_PLUGIN_ROOT}/skills/gather/references/notebooklm-cli.md`
**NotebookLM scripts:** `${CLAUDE_PLUGIN_ROOT}/scripts/notebook-*.sh` — use these instead of calling
`notebooklm` directly; they encode correct CLI syntax and retry degraded answers.

---

## Input contract

- **Requires:** a framed question (from `frame`) or a standalone topic.
- **Resolves from:** context → arg.

## Preflight

1. Check context for a framed question or topic already in play. If present, use it.
2. Else check for a topic/question passed as an arg.
3. Else **FAIL FAST**: "Give me a topic or question to research. If it's still fuzzy, run `frame` first." Stop.

Run the dependency preflight (passive, never blocks):

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/notebook-preflight.sh
```

- `auth: EXPIRED` → tell the user to run `notebooklm login` once, then continue.
- Auto-fixes Playwright when the CLI is pipx-managed; surface anything that needs user action.

---

## Phase 1 — Intake

Extract: `topic`, `seed_urls`, `focus`, and optionally an existing `notebook_id` to reuse.

Before creating a new notebook, check whether one already exists for the domain:

```bash
notebooklm list 2>/dev/null | grep -i "<topic keywords>"
```

If an existing notebook covers the same domain, reuse it — add project-specific URLs as new sources.

**Defaults:** research mode `deep` (20+ sources), source `web`, title `"Research: <topic>"`.

---

## Phase 2 — Build the Notebook

### Option A: New notebook

```bash
NOTEBOOK_ID=$(${CLAUDE_PLUGIN_ROOT}/scripts/notebook-setup.sh "Research: TOPIC" \
  --seed-url "URL1" --seed-url "URL2" \
  --research "TOPIC FOCUS" --no-wait)
```

### Option B: Existing notebook

Use the provided notebook ID. Proceed to Phase 3.

### Wait for research

Deep research takes 15–30 minutes. Run as a **background Bash task** (`run_in_background: true`) —
the harness re-invokes on completion:

```bash
notebooklm research wait --import-all -n NOTEBOOK_ID
```

`--import-all` belongs on the `research wait`, not the `--no-wait` that fired it.

---

## Phase 3 — Source review (optional dedup, then prune)

Dedup (automatic):
```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/notebook-dedup.sh NOTEBOOK_ID --apply
```

Relevance prune — list sources, propose cuts grouped by reason, user approves. Do not silently
delete on relevance judgement:
```bash
notebooklm source list -n NOTEBOOK_ID --json
notebooklm source delete SOURCE_ID -n NOTEBOOK_ID --yes
```

---

## Phase 4 — Source summary

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/notebook-ask.sh NOTEBOOK_ID \
  "Summarize the key themes, best practices, and important distinctions across all sources on: TOPIC FOCUS. Structure: (1) core concepts, (2) common patterns, (3) known pitfalls or debates." \
  --save-as-note --note-title "Source Summary: TOPIC"
```

### Optional — facet fan-out (broad topics only)

For a wide topic, map facet queries to a Workflow fan-out via `scriptPath`:

```
scriptPath: ${CLAUDE_PLUGIN_ROOT}/skills/gather/scripts/gather-facets.js
args: { topic, facets: [{key, query}], notebookId }
```

Only reach for this on a genuinely broad topic — a narrow one is cheaper queried directly.

When headroom is present (`command -v headroom`), large fetched sources can be compressed before
digestion to reduce context consumption.

---

## Phase 5 — Output

Write `02-gather.md` to the engagement directory (notebook ID, source count, core concepts,
common patterns, known pitfalls, key sources). Present inline when standalone.

In standalone mode, hand `02-gather.md` to `lib:vault-store` for Obsidian archival. Close with
the postflight version check:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/notebook-postflight.sh
```

---

## Chaining

- **After gather** → `research-lab:understand` to digest the curated notebook (typical next move).
- **After gather** → `research-lab:synthesize` to go straight to a formed position.
