---
name: synthesize
description: >
  Combine digested material into a formed thing — a position write-up, a decision table, ranked
  hypotheses, or a generated artifact (NotebookLM report / data-table / mind-map). The hinge of
  the research arc: everything before it digests existing information; this is where you commit to
  a claim. Audience is insiders who already share your context (contrast teach, which is for
  outsiders). Non-terminal by design — re-runnable after interrogate returns a rejection. Say
  "synthesize this", "form a position", "write up the findings", "make a decision table", or
  "research-lab:synthesize". Needs digested input plus a question to answer; if you only have raw
  sources, run understand first.
triggers:
  - "synthesize this"
  - "form a position"
  - "write up the findings"
  - "form decisions from"
  - "make a decision table"
  - "rank the hypotheses"
  - "research-lab:synthesize"
  - "research-lab:seminar"
allowed-tools: Bash, Read, Write
---

# Synthesize

Combine digested input into a **formed thing**. This is the **hinge** of the research arc
(`frame → gather → understand → synthesize → interrogate → experiment → teach`): everything to its
left *digests* existing information; `synthesize` is where you *commit* to a claim or produce an
artifact. It is deliberately **not terminal** — a failed `interrogate` returns a verdict and you
may re-run `synthesize` (or `gather`) and resubmit.

**Stance:** author — you are writing the position, not collecting or stress-testing it.
**Notebook persona:** `notebooklm configure --mode concise` (tight position) or `--mode detailed`
(thorough write-up), set before any `ask`/`generate`.
**Audience:** insiders who already share your context. Artifacts here *assume* context; `teach`'s
artifacts *supply* it. Do not run a comprehension quiz here — that is a `teach` concern.

Sense-making techniques (pattern spotting, paradox hunting, naming the unnamed, contrast
creation): `${CLAUDE_PLUGIN_ROOT}/skills/synthesize/references/examination-techniques.md`.
**NotebookLM scripts:** `${CLAUDE_PLUGIN_ROOT}/scripts/notebook-*.sh`.

---

## Input contract

- **Requires:** digested input **+ a question to answer**. "Digested" means understood material —
  an `understand` record, a curated notebook you've read back, a written analysis — not a raw pile
  of sources.
- **Resolves from:** context → file / notebook id.

## Preflight

1. Check context for digested material **and** a clear question/decision to answer. If both present, use them.
2. Else check for an arg: a file path (an `understand` record, an analysis) or a notebook id to read back.
3. Else **FAIL FAST**: "Nothing to synthesize from — provide digested material and the question to answer. If you only have raw sources, run `understand` first; if you have no material at all, run `gather`." Stop. Do **not** invoke another skill to fill the gap.

If a notebook is in play, set the persona before querying:

```bash
notebooklm configure --mode concise   # or --mode detailed for a thorough write-up
```

---

## Model & fan-out

Solo **Opus**. Synthesis is reasoning-heavy, not context-bound — the 1M window holds the digested
input, so do **not** fan out. (Fan-out belongs to `gather` for coverage and `interrogate` for
isolation, not here.)

---

## What to produce

Pick the form that fits the question. Two families:

### A. A formed claim (for insiders)

- a **position write-up** — the defensible answer to the question, with its evidence,
- a **decision table** — Option / Strengths / Weaknesses / When to use / Risk,
- **ranked hypotheses** — each with confidence and the evidence for/against.

Use the sense-making techniques to get there: spot the cross-source patterns, hunt the paradoxes
(where consensus breaks down), name the unnamed recurring patterns, and create explicit contrasts
between options. These build on each other in that order.

### B. A generated artifact (sourced from the material)

When the deliverable is a structured artifact rather than prose, prefer NotebookLM's native
generators over hand-rolling — they cite the actual sources:

```bash
notebooklm generate data-table -n NOTEBOOK_ID   # native decision-tables / ranked rows
notebooklm generate report -n NOTEBOOK_ID --format briefing-doc   # or study-guide|blog-post|custom
notebooklm generate mind-map -n NOTEBOOK_ID      # structural decomposition
```

For a spatial/structural diagram, suggest a handoff to `ideate:diagram` **only if the user has
the `ideate` plugin installed** (separately installable — do not assume it). Otherwise describe the
structure in prose or use `generate mind-map`.

---

## Output

Write `04-synthesize.md` to the engagement directory (or present inline when standalone):

```markdown
# Synthesis: <topic>

## Question
<the decision/question this answers>

## Position
<the formed claim — confident, evidence-backed>

## Named Concepts
- **<Name>**: <definition and the evidence behind it>

## Decision Table
| Option | Strengths | Weaknesses | When to Use | Risk |
|--------|-----------|------------|-------------|------|
| ... | ... | ... | ... | ... |

## Ranked Hypotheses
1. **<Hypothesis>** — Confidence: <high/medium/low>
   Evidence for / against: <summary>

## Assumptions Examined
| Assumption | Supported? | Key Evidence |
|------------|-----------|--------------|

## Open Questions
<what remains unresolved from the material>
```

If a notebook is in play you *may also* save the position into it (best-effort — the vault copy below
is the authoritative store, so don't depend on it):

```bash
notebooklm note save -n NOTEBOOK_ID --title "Position: TOPIC" --content-file 04-synthesize.md \
  2>/dev/null || echo "(notebook note save unavailable — position preserved in the vault)"
```

### Vault archival (always — no plugin dependency)
```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
TOPIC_SLUG="<kebab-case-topic>"
DEST="Research/$TOPIC_SLUG/$(date +%Y-%m-%d)-synthesize.md"
mkdir -p "$VAULT_ROOT/$(dirname "$DEST")"
cp "04-synthesize.md" "$VAULT_ROOT/$DEST"
```

---

## Chaining

`synthesize` produces a **formed, supported claim** — exactly the input the next two verbs gate on. Suggest (never auto-invoke):

- **After synthesize** → `research-lab:interrogate` to adversarially peer-review the claim before you rely on it (the typical next move — it desk-rejects anything without assembled evidence, so bring the position *and* its support).
- **After synthesize** → `research-lab:teach` when the claim is sound and now needs to land with an outside audience.
- **After synthesize** → `research-lab:experiment` when the output is a testable hypothesis with a metric.

**The loop:** if `interrogate` returns a rejection, come back here, revise the position against the verdict, and resubmit. `synthesize` is non-terminal by design; this skill never calls `interrogate` and `interrogate` never calls back — the loop is driven by you in conversation.
