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

Read `${CLAUDE_PLUGIN_ROOT}/skills/literary-review/references/notebooklm-cli.md` for exact CLI syntax.

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

- `status: gathering` → research still running. Check status and report.
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

### Create notebook

```bash
notebooklm create title="Research: TOPIC" --json 2>&1
```

Parse the `id` from JSON output. Update `.research.json` with `notebook_id`.

### Add seed URLs (if any)

For each seed URL:
```bash
notebooklm source add url="URL" notebook=NOTEBOOK_ID --json 2>&1
```

Log failures but continue — a failed seed is not fatal.

### Fire deep research

```bash
notebooklm source add-research query="TOPIC FOCUS" mode=deep notebook=NOTEBOOK_ID --no-wait 2>&1
```

Update status to `gathering`.

### Wait for research

Spawn a background agent to wait:

```
Agent(
  description="Wait for NotebookLM research",
  subagent_type="general-purpose",
  run_in_background=true,
  prompt="Wait for NotebookLM deep research to complete.
  Run: notebooklm research wait notebook=NOTEBOOK_ID --import-all --timeout 1800
  When complete, run: notebooklm source list notebook=NOTEBOOK_ID --json
  Count sources with status=ready.
  Update $ENGAGEMENT_DIR/.research.json: set status='ready', source_count=N."
)
```

Tell the user: research is running (15-30 minutes). Offer to add more URLs while waiting.

---

## Phase 3 — Source Review

```bash
notebooklm source list notebook=NOTEBOOK_ID 2>&1
```

Show the source list. Ask the user/PI:
> "Here are the gathered sources. Remove any irrelevant ones? Add any missing URLs?"

Handle removals:
```bash
notebooklm source delete id=SOURCE_ID notebook=NOTEBOOK_ID 2>&1
```

---

## Phase 4 — Synthesis

Run a structured synthesis query:

```bash
notebooklm ask query="Summarize the key themes, best practices, and important distinctions across all sources on: TOPIC FOCUS. Structure: (1) core concepts, (2) common patterns, (3) known pitfalls or debates." notebook=NOTEBOOK_ID 2>&1
```

Save as a notebook note:
```bash
notebooklm ask query="<same query>" notebook=NOTEBOOK_ID --save-as-note title="Research Summary: TOPIC" 2>&1
```

---

## Phase 5 — Output

Write the literary review document:

```bash
cat > "$ENGAGEMENT_DIR/02-literary-review.md" << 'REVIEW_EOF'
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
REVIEW_EOF
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
