# Examination Techniques

Four structured techniques for cross-examining curated knowledge. Each technique produces a different type of insight. Use all four during a seminar.

Proven during the PNCB cache optimization experiment — these techniques extracted "Atomic Cache Commit", "Stale Success", and "Layer Sweep" as named concepts.

---

## 1. Pattern Spotting

**Goal:** Find recurring themes that multiple sources agree on.

**How:** Ask the notebook questions that force cross-source comparison.

**Example questions:**
- "What approaches appear in 3+ sources?"
- "Which recommendations are consistent across different contexts?"
- "What do all the successful case studies have in common?"
- "Where do the sources converge — what is settled wisdom?"

**What to record:** The pattern, which sources support it, how strong the consensus is.

---

## 2. Paradox Hunting

**Goal:** Find things that seem true but might not be, or where conventional wisdom breaks down.

**How:** Ask the notebook to identify contradictions and counter-examples.

**Example questions:**
- "What seems true about <topic> but might not be?"
- "Where do sources directly contradict each other?"
- "What's the strongest argument against the most common recommendation?"
- "What worked in one context but failed in another? Why?"
- "What assumption do most sources make without evidence?"

**What to record:** The paradox, the competing claims, what explains the contradiction.

**This technique catches "Stale Success"** — metric improvement hiding broken behavior.

---

## 3. Naming the Unnamed

**Goal:** Give names to recurring patterns that sources describe but don't label.

**How:** Look for behaviors, anti-patterns, or strategies that keep appearing without a standard term.

**Example questions:**
- "What behaviors do sources describe repeatedly but never name?"
- "Are there common failure modes that don't have a standard label?"
- "What strategies do practitioners use informally that aren't in any documentation?"

**How to name:** The name should be:
- **Evocative** — suggests what it means without explanation
- **Short** — 2-3 words maximum
- **Precise** — doesn't overlap with existing terms

**Examples from PNCB:**
- **Atomic Cache Commit** — deploying compound cache changes (tag + hook + config) as one unit
- **Stale Success** — a metric improvement that hides broken behavior
- **Layer Sweep** — auditing entire site layer-by-layer instead of page-by-page

**What to record:** The name, the definition, examples from sources, why the name matters.

---

## 4. Contrast Creation

**Goal:** Sharpen understanding by explicitly comparing alternatives.

**How:** Force side-by-side comparison of competing approaches.

**Example questions:**
- "Compare <A> vs <B>: what does each gain and lose?"
- "When would you choose <A> over <B>? When the reverse?"
- "What's the real cost of <A> that isn't obvious?"
- "If you had to argue FOR the worse option, what would you say?"

**What to record:** A decision table with columns: Option, Strengths, Weaknesses, When to Use, Risk.

---

## Combining Techniques

The techniques build on each other:
1. **Pattern Spotting** finds the consensus → the "safe" recommendations
2. **Paradox Hunting** challenges the consensus → where the safe path might fail
3. **Naming the Unnamed** gives vocabulary to the exceptions → makes them discussable
4. **Contrast Creation** structures the decision → turns findings into actionable options

Run them in this order. Each technique's output informs the next.
