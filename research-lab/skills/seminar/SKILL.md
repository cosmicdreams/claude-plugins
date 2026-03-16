---
name: seminar
description: >
  Cross-examine curated knowledge to form a defensible position. Takes a NotebookLM
  notebook and leading questions, uses structured examination techniques (pattern spotting,
  paradox hunting, naming the unnamed, contrast creation), and produces named concepts,
  a decision table, and ranked hypotheses. Works standalone with any notebook.
  Say "form decisions from this notebook", "cross-examine this research", "seminar on",
  or "help me form a position on".
triggers:
  - "cross-examine this research"
  - "form decisions from"
  - "seminar on"
  - "help me form a position"
  - "research-lab:seminar"
allowed-tools: Bash, Read, Write
---

# Seminar: Cross-Examination of Curated Knowledge

Transform curated research into a defensible position through structured interrogation.

Read `${CLAUDE_PLUGIN_ROOT}/skills/seminar/references/examination-techniques.md` for the four techniques.
**NotebookLM scripts:** Use `${CLAUDE_PLUGIN_ROOT}/scripts/notebook-ask.sh` for all notebook queries. Reference: `${CLAUDE_PLUGIN_ROOT}/skills/literary-review/references/notebooklm-cli.md`.

---

## Input

Required:
- **Notebook ID** — a NotebookLM notebook with curated sources
- **Leading questions** — specific questions to drive the examination
- **User context** — constraints, preferences, existing knowledge

Optional:
- **Workshop findings** — `03-workshop.md` if running in pipeline
- **Engagement directory** — for writing output

---

## Step 1 — Frame the Examination

From the leading questions and context, identify:
- **What decision needs to be made?** (not "learn about X" but "decide between A and B")
- **What assumptions are we carrying?** (list them explicitly to challenge)
- **What would change our mind?** (define the falsification criteria)

---

## Step 2 — Apply Examination Techniques

Use all four techniques from `examination-techniques.md`. For each, query the notebook with structured questions.

### Pattern Spotting
Ask the notebook: "What patterns appear across multiple sources on <topic>? Which patterns are supported by the most evidence?"

### Paradox Hunting
Ask the notebook: "What seems true about <topic> based on the sources but might not be? Where do sources contradict each other or contradict common wisdom?"

### Naming the Unnamed
Ask the notebook: "What recurring concepts in the sources don't have a standard name? What behaviors or patterns are described but not labeled?"

Give discovered patterns names. These become the engagement's vocabulary.

### Contrast Creation
Ask the notebook: "Compare <approach A> vs <approach B> based on the sources. What does each gain? What does each lose? When would you choose one over the other?"

---

## Step 3 — Challenge Assumptions

For each assumption identified in Step 1:
```bash
${CLAUDE_PLUGIN_ROOT}/scripts/notebook-ask.sh NOTEBOOK_ID \
  "What evidence supports the assumption that <assumption>? What evidence contradicts it?"
```

Record: assumption, supporting evidence, contradicting evidence, revised confidence.

---

## Step 4 — Synthesize Output

Write `04-seminar.md`:

```markdown
# Seminar: <topic>

## Decision Frame
<What decision does this inform?>

## Named Concepts
<New vocabulary — patterns we identified and named>
- **<Name>**: <definition and evidence>
- **<Name>**: <definition and evidence>

## Decision Table

| Option | Strengths | Weaknesses | When to Use | Risk |
|--------|-----------|------------|-------------|------|
| ... | ... | ... | ... | ... |

## Ranked Hypotheses

1. **<Hypothesis>** — Confidence: <high/medium/low>
   Evidence for: <summary>
   Evidence against: <summary>

2. **<Hypothesis>** — Confidence: <high/medium/low>
   ...

## Assumptions Challenged
| Assumption | Supported? | Key Evidence |
|------------|-----------|--------------|
| ... | ... | ... |

## Open Questions
<What we still don't know and can't answer from the sources>
```

---

## Standalone Mode

When used outside of research-lab:run:
1. Ask the user for the notebook ID, leading questions, and context
2. Run Steps 1-4
3. Present the output and offer:
   - "Ready to design a methodology based on these findings?"
   - "Want to run an experiment testing the top hypothesis?"
   - "Archive to vault?"

### Vault archival (standalone)
```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
TOPIC_SLUG="<kebab-case-topic>"
DEST="Research/$TOPIC_SLUG/$(date +%Y-%m-%d)-seminar.md"
mkdir -p "$VAULT_ROOT/$(dirname "$DEST")"
cp "04-seminar.md" "$VAULT_ROOT/$DEST"
```
