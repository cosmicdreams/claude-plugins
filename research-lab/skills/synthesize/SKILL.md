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

Combine digested input into a **formed thing**. The **hinge** of the research arc: everything to
its left digests existing information; `synthesize` is where you commit to a claim or produce an
artifact. Non-terminal — a rejected `interrogate` verdict sends you back here.

**Stance:** author — writing the position, not collecting or stress-testing it.
**Notebook persona:** `nlm chat configure NOTEBOOK_ID --response-length shorter` (tight position) or
`--response-length longer` (thorough write-up), set before any query or generator.
**Audience:** insiders who already share your context. Artifacts here *assume* context; `teach`'s
artifacts *supply* it.

Sense-making techniques: `${CLAUDE_PLUGIN_ROOT}/skills/synthesize/references/examination-techniques.md`
**NotebookLM scripts:** `${CLAUDE_PLUGIN_ROOT}/scripts/notebook-*.sh`

---

## Input contract

- **Requires:** digested input **+ a question to answer.** "Digested" means understood material — an
  `understand` record, a curated notebook you've read back, a written analysis — not a raw pile of sources.
- **Resolves from:** context → file / notebook id.

## Preflight

1. Check context for digested material **and** a clear question/decision to answer. If both present, use them.
2. Else check for an arg: a file path or notebook id.
3. Else **FAIL FAST**: "Nothing to synthesize from — provide digested material and the question to answer. If you only have raw sources, run `understand` first." Stop.

If a notebook is in play, set persona before querying:

```bash
nlm chat configure NOTEBOOK_ID --response-length shorter   # or: longer
```

---

## What to produce

Pick the form that fits the question.

### A. A formed claim (for insiders)

Use the sense-making techniques to get there — spot cross-source patterns, hunt paradoxes (where
consensus breaks down), name unnamed recurring patterns, and create explicit contrasts between
options. These build on each other in that order.

- **position write-up** — the defensible answer with its evidence
- **decision table** — Option / Strengths / Weaknesses / When to use / Risk
- **ranked hypotheses** — each with confidence and the evidence for/against

### B. A generated artifact (sourced from the material)

When the deliverable is a structured artifact, prefer NotebookLM's native generators — they cite
actual sources:

Generators cost quota, so each needs `--confirm`:

```bash
nlm data-table create NOTEBOOK_ID --confirm
nlm report create NOTEBOOK_ID --format "Briefing Doc" --confirm
nlm mindmap create NOTEBOOK_ID --confirm      # visual only — see below if you need to parse it
```

`nlm` has no parseable mind-map equivalent to the retired `--kind note-backed`. When you need
structure you can read, use `nlm notebook describe NOTEBOOK_ID --json` instead.

If a generator fails server-side, check `nlm studio status NOTEBOOK_ID --json`. There is no in-place
retry, so a failed artifact has to be re-created.

---

## Output

Write `04-synthesize.md` to the engagement directory (or present inline when standalone):

```markdown
# Synthesis: <topic>

## Question
## Position
## Named Concepts
## Decision Table
| Option | Strengths | Weaknesses | When to Use | Risk |
## Ranked Hypotheses
## Assumptions Examined
| Assumption | Supported? | Key Evidence |
## Open Questions
```

If a notebook is in play, co-locate the position as a note:

```bash
nlm note create NOTEBOOK_ID --title "Position: TOPIC" --content "$(cat 04-synthesize.md)"
```

Hand `04-synthesize.md` to `lib:vault-store` for Obsidian archival. research-lab does not
reimplement the vault write; the position also stays in the engagement directory.

---

## Chaining

Suggest (never auto-invoke):

- **After synthesize** → `research-lab:interrogate` to adversarially peer-review the claim (typical next move).
- **After synthesize** → `research-lab:teach` when the claim is sound and needs to land with an outside audience.
- **After synthesize** → `research-lab:experiment` when the output is a testable hypothesis with a metric.

**The loop:** if `interrogate` returns a rejection, revise the position against the verdict and
resubmit. `synthesize` is non-terminal; neither verb calls the other — the loop is driven in conversation.
