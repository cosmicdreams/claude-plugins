# Verdict Guide

Read this file at Phase 3 — Verdict, before delivering any verdict output.

---

## CLEARED

All five gates passed (Gate 3 may be PASS or WARN with justification accepted).

Output:
1. One-paragraph summary of the idea's validated strengths
2. **Structured evidence record** — one line per gate:
   - Gate N — [name]: [what was challenged] → [what the user said] → [why it passed]
3. Key risks identified and accepted (from gate responses)
4. Chain offer: *"This idea cleared the funnel. The natural next step is `ideate:plan-improvements` to identify gaps and improvement opportunities in the proposed approach. Run it now?"*

---

## CONDITIONAL

All gates passed but Gate 3 produced a WARN (unjustified complexity).

Output:
1. Summary of what passed
2. The specific complexity concern that was flagged
3. Next action: "Build the simplest version first. Return with evidence that the simpler approach is genuinely insufficient for the stated problem — not just less elegant."

---

## KILLED at Gate N

Output:
1. The gate that killed it — state it plainly
2. The specific objection that was not addressed
3. **Gate-specific recovery prescription** (use the row for the gate that killed it):

| Gate | Recovery |
|------|----------|
| Gate 1 | Restate the problem naming one specific person or role affected and one measurable pain they experience. No abstractions. Return when you can state it in one sentence. |
| Gate 2 | Validate with 5 real instances — users interviewed, cases observed, or data points reviewed. Describe the validation method and what you found. Return with evidence. |
| Gate 3 | *(Gate 3 does not kill — this row exists for reference only)* |
| Gate 4 | Write the failure post-mortem before building anything. Walk through the full sequence: who does what, what breaks, what the consequence is, who is affected. Return when you can narrate it concretely. |
| Gate 5 | Name the killer assumption explicitly. Design the cheapest possible test that would prove or disprove it. What is the one-week experiment? Return with the test result. |

Do not substitute a generic suggestion. Use the prescription for the specific gate that killed the idea.
