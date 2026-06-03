---
name: interrogate
description: >
  Adversarial peer-review of a formed, supported claim. Assembles the claim + evidence into a clean
  submission, desk-rejects before spawning anything if evidence is missing, then spawns a panel of
  fresh, context-isolated reviewers — each with a distinct lens (evidence-quality, alternative-
  explanation, reproducibility, internal-consistency) — to build the case against it. Solves the
  agentic self-confirmation problem: reviewers see only the submission, never the reasoning that
  produced it. Returns a verdict; never revises the claim itself. Say "interrogate this",
  "peer-review this claim", "tear this apart", "stress-test these findings", or
  "research-lab:interrogate". Needs a formed claim plus its supporting evidence; for an unformed
  idea use ideate:reality-check instead.
triggers:
  - "interrogate this"
  - "peer-review this claim"
  - "tear this apart"
  - "stress-test these findings"
  - "adversarially review"
  - "research-lab:interrogate"
allowed-tools: Bash, Read, Write, Workflow
---

# Interrogate

Adversarially peer-review a **formed, supported** claim. This is the **keystone** of the research
arc: it is what stops an agent (or a person) from convincing themselves they are right by
re-reading their own reasoning. `synthesize` proves a claim is *right*; `interrogate` tries to
prove it *wrong* and reports whether it survived.

**It attacks evidence, not assumptions.** Contrast `ideate:reality-check`, which attacks the
*assumptions* of an *unformed* idea and may kill it on a hunch, pre-evidence. `interrogate`
attacks the *evidence* of a *formed* claim, must refute on facts, and has a submission gate. Same
posture, opposite ends of the arc.

**Stance:** hostile reviewer — "assume it's wrong; build the case against it."
**Notebook persona (if a notebook is in play):** `notebooklm configure --persona "skeptical
examiner; cite or reject"`.

---

## Input contract

- **Requires:** **a formed claim + its supporting evidence.**
- **Resolves from:** context → file / notebook id.

## Preflight — the outer layer (cheap fail-fast, no reviewer paid for yet)

This is the first of two reinforcing layers. Do it **before spawning anything**:

1. Read context / file / notebook and assemble the claim and its evidence into one clean
   **submission** (claim, the evidence for it, the question it answers).
2. **FAIL FAST — desk-reject** if the submission is incomplete (this is interrogate's fail-fast step):
   - claim present but **no evidence** → "Claim present but no supporting evidence — bring the
     support, or run `synthesize` first to form a backed position." Stop.
   - **no claim** found → "No formed claim to interrogate — what is the position? For an *unformed*
     idea, use `ideate:reality-check` instead." Stop.
3. Only once a complete submission exists do you proceed to the panel. No reviewer is spawned for
   an incomplete submission — desk-rejection is the cheap gate.

Debating unsupported or unformed ideas is `reality-check`'s job, not peer review's.

---

## The inner layer — a context-isolated, perspective-diverse panel (Workflow)

The user invoked this skill, which **explicitly instructs a `Workflow` call** — so fan out. This
is not optional flavor: the panel's correctness depends on it.

**Why Workflow and not a solo Opus call:** each reviewer is a Workflow `agent()`, which by
construction receives **only the submission** — never this conversation or the reasoning that
produced the claim. That context isolation is *native* to dynamic workflows; it is a **correctness
mechanism**, not a context-shrinking one, so it survives a 1M-context session unchanged. Do **not**
"simplify" interrogate into a single in-context Opus call — that silently destroys the keystone by
letting the reviewer see (and rationalize from) the claim's own reasoning.

**Perspective-diverse panel, not N identical refuters.** Assign each reviewer a *distinct lens* —
diversity catches failure modes redundancy can't:

- **evidence-quality** — is the support strong, sufficient, and actually cited?
- **alternative-explanation** — does another hypothesis explain the same evidence?
- **reproducibility** — would an independent party get the same result from the same data?
- **internal-consistency** — does the claim contradict itself or its own evidence?

The panel vote is a `parallel()` **barrier** — you need all votes to tally. Reviewers debate
**evidence and facts**; unsupported or emotional objections do not count (inherited from
reality-check). Stance for every reviewer: "assume it's wrong; build the case against it."

### Right-sizing (scale to the ask via the `budget` API)

- A **quick check** → 1 reviewer, single pass.
- "**Thoroughly interrogate this**" → all 5 lenses + **loop-until-dry** (K consecutive clean
  rounds), with `budget.remaining()` as a **hard ceiling** so a maximally hostile panel cannot trap
  revision forever. (This is why termination is bounded — see the script.)
- **Model per lens:** Haiku where the lens is mechanical (internal-consistency, reproducibility
  checklist); Opus where refutation needs real reasoning (alternative-explanation).

### Reference Workflow script (adapt panel size + loop to the ask)

```javascript
export const meta = {
  name: 'interrogate-claim',
  description: 'Adversarial perspective-diverse peer review of a formed claim',
  phases: [{ title: 'Review' }],
}
// `args` carries the assembled submission { claim, evidence, question }.
const LENSES = [
  { key: 'evidence-quality',        model: 'haiku' },
  { key: 'alternative-explanation', model: 'opus'  },
  { key: 'reproducibility',         model: 'haiku' },
  { key: 'internal-consistency',    model: 'haiku' },
]
const VERDICT = {
  type: 'object',
  properties: {
    lens:        { type: 'string' },
    refuted:     { type: 'boolean' },
    grounds:     { type: 'string' },   // the evidence-based reason; required
    severity:    { type: 'string', enum: ['fatal', 'major', 'minor', 'none'] },
  },
  required: ['lens', 'refuted', 'grounds', 'severity'],
}
let dryRounds = 0
const rounds = []
while (dryRounds < 2 && budget.remaining() > 40_000) {   // hard ceiling + loop-until-dry
  const votes = (await parallel(LENSES.map(L => () =>
    agent(
      `You are a hostile peer reviewer using ONLY the ${L.key} lens. Assume the claim is wrong and ` +
      `build the case against it on EVIDENCE AND FACTS only — unsupported or emotional objections ` +
      `do not count. Submission:\n${JSON.stringify(args)}`,
      { label: `review:${L.key}`, phase: 'Review', schema: VERDICT, model: L.model }
    )
  ))).filter(Boolean)
  const live = votes.filter(v => v.refuted && v.severity !== 'none')
  rounds.push(votes)
  if (live.length === 0) { dryRounds++ } else { dryRounds = 0 }
  if (live.some(v => v.severity === 'fatal')) break   // a fatal grounds ends it early
}
return { rounds, ceilingHit: budget.remaining() <= 40_000 }
```

---

## Verdict (this skill returns, it does not revise)

Tally the panel and report **a verdict**, not a rewrite:

- **Survived** — no live refutation across K clean rounds. State that and on what grounds it held.
- **Rejected** — name the lens, the severity, and the exact evidence gap ("rejected: evidence gap
  on claim X — the reproducibility lens shows the result depends on an unstated sampling choice").

**Loop & termination:** `interrogate` never calls `synthesize` or `gather`. When it returns a
rejection, **you** (in conversation) decide whether to re-run `synthesize` against the verdict and
resubmit. Termination is bounded by loop-until-dry + the `budget.remaining()` ceiling, so a
hostile panel cannot trap revision indefinitely.

Write `05-interrogate.md` (verdict, per-lens grounds, round count) to the engagement directory when one exists.

---

## Chaining

- **Rejected** → `research-lab:synthesize` to revise the position against the verdict, then resubmit here. This is the arc's one loop.
- **Survived** → `research-lab:teach` to make the now-hardened claim land with an outside audience, or `research-lab:experiment` if it implies a testable hypothesis.
