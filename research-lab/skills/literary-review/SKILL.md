---
name: literary-review
description: >
  NotebookLM-powered research: create a notebook, seed sources, fire deep web research,
  curate sources with the user, run synthesis queries, and produce a structured summary.
  Use standalone for any knowledge gathering task, not just as a pipeline step.
  Say "research this topic", "build a notebook on", "literary review of", or "gather research on".
  Migrated from ideate:research with improvements for engagement directory integration.
triggers:
  - "literary review"
  - "research this topic"
  - "build a notebook on"
  - "gather research on"
  - "research-lab:literary-review"
allowed-tools: Bash, Read, Write
---

# Literary Review

Gather and synthesize knowledge via NotebookLM. Works standalone or as Phase 3 of a research engagement.

**NotebookLM CLI reference:** `${CLAUDE_PLUGIN_ROOT}/skills/literary-review/references/notebooklm-cli.md`
**NotebookLM scripts:** `${CLAUDE_PLUGIN_ROOT}/scripts/notebook-*.sh` — use these instead of calling `notebooklm` directly. They encode the correct CLI syntax.

---

## Phase 0 — Resume Detection

Check for an existing research session:

```bash
ENGAGEMENT_DIR="${ENGAGEMENT_DIR:-.}"
test -f "$ENGAGEMENT_DIR/.research.json" && python3 -c "
import json
with open('$ENGAGEMENT_DIR/.research.json') as f:
    d = json.load(f)
print(d.get('status', 'none'))
print(d.get('notebook_id', ''))
print(d.get('title', ''))
"
```

- `status: gathering` → research still running. Check with `notebooklm research status -n NOTEBOOK_ID`.
- `status: ready` → sources imported. Skip to Phase 3 (Source Review).
- `status: synthesized` → already done. Report and offer to re-query.
- Otherwise → start fresh at Phase 1.

---

## Phase 1 — Intake

Extract from the user's message or PI's spawn prompt:
- `topic`: research subject (notebook title and research query)
- `seed_urls`: starting point URLs (0 or more)
- `focus`: specific angle or constraints

**Defaults:**
- Research mode: **deep** (20+ sources)
- Research source: **web**
- Notebook title: `"Research: <topic>"`

Write session state:

```bash
python3 -c "
import json
state = {
    'version': '1.0',
    'title': 'Research: TOPIC',
    'topic': 'TOPIC',
    'focus': 'FOCUS',
    'seed_urls': [],
    'notebook_id': '',
    'status': 'creating'
}
with open('$ENGAGEMENT_DIR/.research.json', 'w') as f:
    json.dump(state, f, indent=2)
"
```

---

## Phase 2 — Build the Notebook

### Option A: New notebook (no existing notebook)

Use the setup script to create, seed, and fire research in one step:

```bash
NOTEBOOK_ID=$(${CLAUDE_PLUGIN_ROOT}/scripts/notebook-setup.sh "Research: TOPIC" \
  --seed-url "URL1" --seed-url "URL2" \
  --research "TOPIC FOCUS" --no-wait)
```

Update `.research.json` with the notebook ID and set status to `gathering`.

### Option B: Existing notebook

If the user provided a notebook ID, skip creation. Set it in `.research.json` and proceed to Phase 3.

### Wait for research (if --no-wait was used)

Spawn a background agent to wait:

```
Agent(
  description="Wait for NotebookLM research",
  subagent_type="general-purpose",
  run_in_background=true,
  prompt="Wait for NotebookLM deep research to complete.
  Run: notebooklm research wait -n NOTEBOOK_ID
  When complete, run: notebooklm source list -n NOTEBOOK_ID --json
  Count sources with status=ready.
  Update $ENGAGEMENT_DIR/.research.json: set status='ready', source_count=N."
)
```

Tell the user: research is running (15-30 minutes). Offer to add more URLs while waiting.

---

## Phase 3 — Source Review

```bash
notebooklm source list -n NOTEBOOK_ID
```

Show the source list. Ask the user/PI:
> "Here are the gathered sources. Remove any irrelevant ones? Add any missing URLs?"

Handle removals:
```bash
notebooklm source delete SOURCE_ID -n NOTEBOOK_ID
```

Handle additions:
```bash
notebooklm source add "URL" -n NOTEBOOK_ID --json
```

---

## Phase 4 — Synthesis

Run a structured synthesis query using the ask script:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/notebook-ask.sh NOTEBOOK_ID \
  "Summarize the key themes, best practices, and important distinctions across all sources on: TOPIC FOCUS. Structure: (1) core concepts, (2) common patterns, (3) known pitfalls or debates."
```

Save the synthesis as a notebook note:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/notebook-ask.sh NOTEBOOK_ID \
  "Summarize the key themes, best practices, and important distinctions across all sources on: TOPIC FOCUS. Structure: (1) core concepts, (2) common patterns, (3) known pitfalls or debates." \
  --save-as-note --note-title "Research Summary: TOPIC"
```

---

## Phase 5 — Output

Write `02-literary-review.md` to the engagement directory. Structure:

```markdown
# Literary Review: TOPIC

## Notebook
- ID: NOTEBOOK_ID
- Sources: N curated sources
- Research mode: deep web

## Core Concepts
<from synthesis>

## Common Patterns
<from synthesis>

## Known Pitfalls and Debates
<from synthesis>

## Key Sources
<top 5 sources with brief descriptions>
```

Update `.research.json` status to `synthesized`.

### Vault archival (standalone mode only)

If running standalone (not inside research-lab:run):
```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
TOPIC_SLUG="<kebab-case-topic>"
DEST="Research/$TOPIC_SLUG/$(date +%Y-%m-%d)-literary-review.md"
mkdir -p "$VAULT_ROOT/$(dirname "$DEST")"
cp "$ENGAGEMENT_DIR/02-literary-review.md" "$VAULT_ROOT/$DEST"
```

---

## User Preferences

- Always deep mode. Fast is for lookups, not research.
- Web by default. Drive only when explicitly asked.
- Seed first — add known URLs before firing research.
- Review before synthesizing — show sources, let the user curate.
- Save synthesis as a notebook note for later retrieval.
