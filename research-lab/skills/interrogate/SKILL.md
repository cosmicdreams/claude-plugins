---
name: interrogate
description: >
  Adversarial peer review of a formed claim plus its evidence. Desk-rejects when evidence
  is missing, then spawns context-isolated reviewers with distinct lenses (evidence
  quality, alternative explanation, reproducibility, internal consistency) that see only
  the submission, never the reasoning behind it. Returns a verdict; never revises the
  claim. For an unformed idea use ideate:reality-check.
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

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Adversarial peer-review of a formed, supported claim. Assembles the claim + evidence into a clean submission, desk-rejects before spawning anything if evidence is missing, then spawns a panel of fresh, context-isolated reviewers — each with a distinct lens (evidence-quality, alternative- explanation, reproducibility, internal-consistency) — to build the case against it. Solves the agentic self-confirmation problem: reviewers see only the submission, never the reasoning that produced it. Returns a verdict; never revises the claim itself. Say "interrogate this", "peer-review this claim", "tear this apart", "stress-test these findings", or "research-lab:interrogate". Needs a formed claim plus its supporting evidence; for an unformed idea use ideate:reality-check instead.

Adversarially peer-review a **formed, supported** claim. The **keystone** of the research arc: it
stops an agent from convincing itself it is right by re-reading its own reasoning. `synthesize`
proves a claim is *right*; `interrogate` tries to prove it *wrong* and reports whether it survived.

**It attacks evidence, not assumptions.** Contrast `ideate:reality-check`, which attacks the
*assumptions* of an *unformed* idea. `interrogate` attacks the *evidence* of a *formed* claim,
must refute on facts, and has a submission gate.

**Stance:** hostile reviewer — "assume it's wrong; build the case against it."
**Notebook persona (if a notebook is in play):** `nlm chat configure NOTEBOOK_ID --goal custom --prompt "skeptical examiner; cite or reject"`.

---

## Input contract

- **Requires:** a formed claim + its supporting evidence.
- **Resolves from:** context → file / notebook id.

## Preflight — desk-reject gate (no reviewer paid for yet)

1. Read context / file / notebook and assemble the claim and its evidence into one clean
   **submission** (claim, evidence, question it answers).
2. **FAIL FAST — desk-reject** if the submission is incomplete:
   - claim present but **no evidence** → "Claim present but no supporting evidence — bring the
     support, or run `synthesize` first to form a backed position." Stop.
   - **no claim** found → "No formed claim to interrogate — for an *unformed* idea, use
     `ideate:reality-check` instead." Stop.
3. Only once a complete submission exists do you proceed to the panel.

---

## The panel — context-isolated, perspective-diverse (Workflow)

The user invoked this skill, which **explicitly instructs a Workflow call**. Each `agent()` call in
the Workflow receives **only the submission** — never this conversation or the reasoning that
produced the claim. That context isolation is a **correctness mechanism**: do not simplify
`interrogate` into a single in-context call, as that silently destroys the keystone.

Run the panel via:

```
scriptPath: ${CLAUDE_PLUGIN_ROOT}/skills/interrogate/scripts/interrogate-panel.js
args: {
  claim:    "<the formed position>",
  evidence: "<the assembled supporting evidence>",
  question: "<the question the claim answers>",
  thorough: false   // true = loop-until-dry (two consecutive clean rounds)
}
```

**Four lenses** (defined in the script): evidence-quality, alternative-explanation, reproducibility,
internal-consistency. Each is a parallel `agent()` with a schema-validated verdict.

**Right-sizing via the `budget` API** (handled in the script):
- Default → single pass.
- `thorough: true` → loop-until-dry with `budget.remaining()` as a hard ceiling.

The script returns `{ verdict, rounds, roundCount, ceilingHit }` where `verdict` is one of
`survived`, `rejected`, or `contested`. A valid fatal refutation is sufficient for rejection
even if another lens fails to respond correctly. `rounds` retains the valid votes and their
grounds; logs identify incomplete coverage by round, assigned lens, and failure reason.
Report those diagnostics alongside a fatal rejection; do not claim all four lenses responded.

Without a valid fatal refutation, any missing, malformed, or misattributed response stops
execution with an explicit error naming the round, assigned lens, and reason. Such responses
cannot establish clean rounds or survival. No budget to run even one round is also an execution
error, not a substantive verdict. Thrown agent/parallel errors propagate rather than becoming
votes. Local shim tests exercise this script's logic, not the actual Workflow host contracts.

---

## Verdict (this skill returns; it does not revise)

Tally the panel result and report **a verdict**, not a rewrite:

- **Survived** — no live refutation across the clean rounds. State on what grounds it held.
- **Rejected** — name the lens, the severity, and the exact evidence gap.
- **Contested** — complete panel without a decisive result (a minority split, or the ceiling
  reached before enough clean rounds); surface the votes and stopping condition.

An **execution failure** is not `contested` or another verdict. Report the failure diagnostics
without inventing a finding about the claim.

Write `05-interrogate.md` (verdict, per-lens grounds, round count, and any incomplete-coverage
diagnostics) to the engagement directory when a verdict is returned.

---

## Chaining

- **Rejected** → `research-lab:synthesize` to revise the position against the verdict, then resubmit.
- **Survived** → `research-lab:teach` to make the hardened claim land with an outside audience, or
  `research-lab:experiment` if it implies a testable hypothesis.
