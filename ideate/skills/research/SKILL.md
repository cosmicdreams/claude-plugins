---
name: research
description: >
  Deep research on a topic using NotebookLM before brainstorming. Creates a notebook,
  adds seed sources, fires deep web research (20+ sources), reviews sources with you,
  and produces a structured summary that chains into ideate:brainstorm automatically.
  Use when you need to gather evidence before ideation, not after. Say "research this",
  "gather research on", "let's research", "find sources on", or "build a notebook on".
  Not for quick lookups or single-source questions -- this skill runs deep mode by default
  and takes 15-30 minutes.
triggers:
  - "research this"
  - "gather research on"
  - "research before brainstorming"
  - "let's research"
  - "find sources on"
  - "build a notebook on"
  - "notebooklm research"
allowed-tools: Bash, Read, Write
---

# Skill: research

Gather research on a topic using NotebookLM, then hand off to `ideate:brainstorm`.
This skill encodes preferences for how to work — deep research by default, structured
intake, source review before synthesis.

---

## Phase 0 — Resume Detection

Check if a research session is already in progress:

```bash
test -f .research.json && python3 -c "
import json
with open('.research.json') as f:
    d = json.load(f)
print(d.get('status', 'none'))
print(d.get('notebook_id', ''))
print(d.get('title', ''))
"
```

- If `status` is `gathering` → research is still running. Check status and report.
- If `status` is `ready` → sources are imported. Skip to Phase 3 (Review & Handoff).
- Otherwise → start fresh at Phase 1.

---

## Phase 1 — Intake

Extract from the user's message:
- `topic`: The research subject (used for the notebook title and research query)
- `seed_urls`: Any URLs the user provided as starting points (0 or more)
- `focus`: Any specific angle or constraints ("best practices", "examples only", etc.)

**Default preferences (encode these):**
- Research mode: **deep** (comprehensive, 20+ sources — not fast)
- Research source: **web** (not Drive)
- Notebook title format: `"Research: <topic>"`

Write initial session state:

```bash
python3 -c "
import json, datetime
state = {
    'version': '1.0',
    'title': 'Research: TOPIC',
    'topic': 'TOPIC',
    'focus': 'FOCUS',
    'seed_urls': [],
    'notebook_id': '',
    'status': 'creating'
}
with open('.research.json', 'w') as f:
    json.dump(state, f, indent=2)
"
```

---

## Phase 2 — Build the Notebook

### Create notebook

```bash
notebooklm create "Research: TOPIC" --json 2>&1
```

Parse the `id` from the JSON output. Update `.research.json` with `notebook_id`.

```bash
python3 -c "
import json
with open('.research.json') as f:
    state = json.load(f)
state['notebook_id'] = 'NOTEBOOK_ID'
state['status'] = 'seeding'
with open('.research.json', 'w') as f:
    json.dump(state, f, indent=2)
"
```

### Add seed URLs (if any)

For each seed URL provided by the user:

```bash
notebooklm source add "URL" --notebook NOTEBOOK_ID --json 2>&1
```

Log any failures but continue — a failed seed is not fatal.

### Fire deep research

```bash
notebooklm source add-research "TOPIC FOCUS" --mode deep --no-wait --notebook NOTEBOOK_ID 2>&1
```

Update status to `gathering`:

```bash
python3 -c "
import json
with open('.research.json') as f:
    state = json.load(f)
state['status'] = 'gathering'
with open('.research.json', 'w') as f:
    json.dump(state, f, indent=2)
"
```

### Spawn background agent to wait and import

Use the Task tool to spawn a background agent:

```
Task(
  description="Wait for NotebookLM research to complete",
  subagent_type="general-purpose",
  run_in_background=True,
  prompt="""
Wait for NotebookLM deep research to complete and import all sources.

Run: notebooklm research wait -n NOTEBOOK_ID --import-all --timeout 1800

When complete:
1. Run: notebooklm source list --notebook NOTEBOOK_ID --json
2. Count the sources with status=ready
3. Write the count to .research.json:
   python3 -c "
   import json
   with open('.research.json') as f:
       state = json.load(f)
   state['status'] = 'ready'
   state['source_count'] = SOURCE_COUNT
   with open('.research.json', 'w') as f:
       json.dump(state, f, indent=2)
   "

Report: how many sources were imported, or if it timed out.
"""
)
```

Tell the user:
> "Research is running in the background. Deep research typically takes 15–30 minutes.
> I'll notify you when sources are imported and ready to review.
> While you wait: would you like to add any specific URLs you already know are relevant?"

---

## Phase 3 — Source Review

When the background agent completes (or user returns after waiting):

```bash
notebooklm source list --notebook NOTEBOOK_ID 2>&1
```

Show the list and ask the user:
> "Here are the sources NotebookLM gathered. Do any look irrelevant or should any be
> removed before we ask questions? You can also add any missing URLs now."

Handle removals if requested:
```bash
notebooklm source delete SOURCE_ID --notebook NOTEBOOK_ID 2>&1
```

---

## Phase 4 — Synthesis Query

Ask NotebookLM a structured synthesis question based on the topic and focus:

```bash
notebooklm ask "Summarize the key themes, best practices, and important distinctions across all sources on: TOPIC FOCUS. Structure the answer with: (1) core concepts, (2) common patterns, (3) known pitfalls or debates." --notebook NOTEBOOK_ID 2>&1
```

Save the answer as a note for future reference:

```bash
notebooklm ask "Summarize the key themes, best practices, and important distinctions across all sources on: TOPIC FOCUS. Structure the answer with: (1) core concepts, (2) common patterns, (3) known pitfalls or debates." --notebook NOTEBOOK_ID --save-as-note --note-title "Research Summary: TOPIC" 2>&1
```

---

## Phase 5 — Handoff to Brainstorm

Update `.research.json` to `synthesized`:

```bash
python3 -c "
import json
with open('.research.json') as f:
    state = json.load(f)
state['status'] = 'synthesized'
state['summary'] = 'SUMMARY_TEXT'
with open('.research.json', 'w') as f:
    json.dump(state, f, indent=2)
"
```

Present the synthesis summary to the user, then offer:

> "Research is complete. Ready to brainstorm? Run `ideate:brainstorm` and it will
> pick up this research as context automatically."

**Note for `ideate:brainstorm` chain-in:** When brainstorm detects `.research.json`
with `status: synthesized`, it should read the `summary` field and inject it as
context before generating ideas — the user does not need to re-paste the findings.

---

## User Preferences (evolve this section over time)

- **Research depth:** Always deep mode. Fast mode is for quick lookups, not ideation fodder.
- **Source scope:** Web by default. Drive research only when explicitly asked.
- **Seed first:** If the user has known-good URLs, add them before firing research — they anchor the research direction.
- **Review before synthesizing:** Always show the source list and ask before running the synthesis query. The user picks and chooses which assets should inform the discussion.
- **Save the summary as a note:** The synthesis answer goes into the notebook as a note so it's retrievable later, not just a transient chat answer.

---

## Obsidian Storage

After producing output, archive to the Neurons vault for long-term memory.

1. **Determine topic slug**: convert the research topic to kebab-case
   (e.g. "API authentication options" → `api-authentication-options`)

2. **Determine vault path**: read `obsidian-rules.md` from the workflow plugin references
   (`~/.claude/plugins/cache/local/workflow/*/references/obsidian-rules.md`) to confirm
   correct placement. Default: `Research/<topic>/<YYYY-MM-DD>-<topic>.md`

3. **Write to vault**:
   ```bash
   VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
   DEST_PATH="Research/<topic>/<YYYY-MM-DD>-<topic>.md"
   mkdir -p "$VAULT_ROOT/$(dirname "$DEST_PATH")"
   cat > "$VAULT_ROOT/$DEST_PATH" << 'EOF'
   <output-content>
   EOF
   ```

4. **Confirm**: "Saved to Neurons: Research/<topic>/<YYYY-MM-DD>-<topic>.md"
