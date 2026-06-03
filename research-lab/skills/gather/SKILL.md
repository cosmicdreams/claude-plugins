---
name: gather
description: >
  Collect and curate sources on a question or topic. Create a NotebookLM notebook, seed sources,
  fire deep web research, curate with the user, run synthesis queries, and produce a structured
  source summary. The "librarian" verb of the research arc — it brings material in; digesting it
  is understand's job. Use standalone for any knowledge-gathering task. Say "gather research on",
  "research this topic", "build a notebook on", "collect sources on", or "research-lab:gather".
  Formerly research-lab:literary-review (renamed in 2.0).
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

Collect and curate knowledge via NotebookLM + deep web research. The **librarian** of the research arc (`frame → gather → understand → synthesize → interrogate → experiment → teach`): it brings material *in*. It does not digest that material — that is `understand`. Works fully standalone.

**Stance:** librarian — comprehensive collection, then ruthless curation. **Notebook persona:** `notebooklm configure --mode default`.

**NotebookLM command-line interface reference:** `${CLAUDE_PLUGIN_ROOT}/skills/gather/references/notebooklm-cli.md`
**NotebookLM scripts:** `${CLAUDE_PLUGIN_ROOT}/scripts/notebook-*.sh` — use these instead of calling `notebooklm` directly. They encode the correct command-line interface syntax.

---

## Input contract

- **Requires:** a framed question (from `frame`) or a standalone topic.
- **Resolves from:** context → arg.

## Preflight

1. Check context for a framed question or topic already in play (e.g. output of `frame`). If present, use it.
2. Else check for a topic/question passed as an arg.
3. Else **FAIL FAST**: "Give me a topic or question to research. If it's still fuzzy, run `frame` first to sharpen it." Stop. Do **not** invoke another skill.

Then run the dependency preflight below.

---

## Dependency preflight (run after the input contract passes)

Passive dependency check. It **never blocks and never prompts** — it auto-applies
safe remedies (e.g. injecting Playwright into the pipx venv) and only *reports*
anything that needs you (interactive login). Run it and glance at the output; do
not gate the engagement on it.

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/notebook-preflight.sh
```

- `auth: EXPIRED` → tell the user to run `notebooklm login` once, then continue.
- `playwright: missing` lines are auto-fixed when the command-line interface is pipx-managed.
- No version check here on purpose — that is end-of-run guidance (see Phase 5).

Set the notebook persona for gathering (collection posture, no special examiner framing):

```bash
notebooklm configure --mode default   # run once the notebook exists / before any ask
```

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

Extract from the user's message or Principal Investigator's spawn prompt:
- `topic`: research subject (notebook title and research query)
- `seed_urls`: starting point URLs (0 or more)
- `focus`: specific angle or constraints
- `notebook_id`: existing NotebookLM notebook to reuse (if provided)

### Check for reusable notebooks

Before creating a new notebook, check if a relevant one already exists from a prior engagement. Topics like "Drupal cache optimization" or "CDN integration patterns" are project-agnostic — the same reference material applies across projects.

```bash
# List existing notebooks
notebooklm list 2>/dev/null | grep -i "<topic keywords>"
```

If an existing notebook covers the same domain, reuse it by passing its ID. You can still add project-specific seed URLs as new sources. Only create a new notebook if no relevant one exists.

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

Deep research takes 15–30 minutes. Run the wait as a **harness-tracked background Bash
task** (`run_in_background: true`) — the harness re-invokes the session on completion, so
there is no need to `ScheduleWakeup`-poll. Do **not** spawn a subagent just to block on a wait.

```bash
# Bash tool call with run_in_background: true
notebooklm research wait --import-all -n NOTEBOOK_ID
# --import-all belongs HERE, on the wait — it cannot combine with the --no-wait that
# fired the research. Without it, the web user interface leaves an "Add sources?" modal open.
```

When the background task completes, the session resumes: run
`notebooklm source list -n NOTEBOOK_ID --json`, count sources with `status=ready`, and
update `$ENGAGEMENT_DIR/.research.json` to `status='ready', source_count=N`.

Tell the user: research is running (15–30 minutes). Offer to add more URLs while waiting.

---

## Phase 3 — Source Review (dedup, then prune)

Deep research **always** produces duplicates and tangential sources. Two passes:

### 3a. Dedup — automatic (no user input)

NotebookLM duplicates because `--import-all` re-imports seed URLs the research pass
rediscovers, and because the same page arrives under trailing-slash / `#fragment` /
`?query` variants. Just remove them — this needs no judgement:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/notebook-dedup.sh NOTEBOOK_ID --apply
```

### 3b. Relevance prune — propose, user approves

List what remains, then propose cuts grouped by reason (off-topic, low-quality,
tangential cluster). Do NOT silently delete on relevance — that is judgement:

```bash
notebooklm source list -n NOTEBOOK_ID --json
```

> "Deduped to N. I'd also cut these M as off-topic/tangential: <grouped list>.
>  Reply 'prune' to cut them, 'keep all' to synthesize as-is, or name any to keep."

Apply approved removals:
```bash
notebooklm source delete SOURCE_ID -n NOTEBOOK_ID --yes
```

Add any missing URLs the user names:
```bash
notebooklm source add "URL" -n NOTEBOOK_ID --type url --json
```

---

## Phase 4 — Source summary

`gather` produces a **structured source summary** — a map of what was collected, not a formed
position. Forming a position is `synthesize`'s job; deeply digesting the sources is `understand`'s.
Keep this query descriptive ("what do the sources cover") rather than argumentative.

Run a structured summary query using the ask script:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/notebook-ask.sh NOTEBOOK_ID \
  "Summarize the key themes, best practices, and important distinctions across all sources on: TOPIC FOCUS. Structure: (1) core concepts, (2) common patterns, (3) known pitfalls or debates."
```

Save the summary as a notebook note:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/notebook-ask.sh NOTEBOOK_ID \
  "Summarize the key themes, best practices, and important distinctions across all sources on: TOPIC FOCUS. Structure: (1) core concepts, (2) common patterns, (3) known pitfalls or debates." \
  --save-as-note --note-title "Source Summary: TOPIC"
```

### Optional — facet fan-out (broad topics only)

When the topic is broad and benefits from parallel coverage, map facet queries to a Workflow
`pipeline()` (no barrier), one Haiku agent per facet. This is the documented parallel-coverage
shape; only reach for it on a wide topic — a narrow one is cheaper queried directly. Invoking
`Workflow` here is legitimate because the user invoked this skill, but the call must be explicit.

---

## Phase 5 — Output

Write `02-gather.md` to the engagement directory. Structure:

```markdown
# Gather: TOPIC

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

If running standalone (not inside a larger engagement):
```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
TOPIC_SLUG="<kebab-case-topic>"
DEST="Research/$TOPIC_SLUG/$(date +%Y-%m-%d)-gather.md"
mkdir -p "$VAULT_ROOT/$(dirname "$DEST")"
cp "$ENGAGEMENT_DIR/02-gather.md" "$VAULT_ROOT/$DEST"
```

### Postflight (version guidance)

Close with a check on the command-line interface's health. Informational only — surface it to the
user so the tool is in better shape next time (catches the "stale local-source
pipx install" trap where `pipx upgrade` silently does nothing):

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/notebook-postflight.sh
```

---

## User Preferences

- Always deep mode. Fast is for lookups, not research.
- Web by default. Drive only when explicitly asked.
- Seed first — add known URLs before firing research.
- Review before synthesizing — show sources, let the user curate.
- Save synthesis as a notebook note for later retrieval.

---

## Chaining

`gather` brings material in; it does not digest or argue. Suggest the next step in prose (never auto-invoke):

- **After gather** → `research-lab:understand` to digest the curated notebook into a shared mental model (the typical next move — pass the notebook id).
- **After gather** → `research-lab:synthesize` if the goal is to go straight to a formed position from the source summary.
