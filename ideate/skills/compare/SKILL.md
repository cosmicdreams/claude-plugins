---
name: compare
description: >
  Structured comparison of two or more options, or evaluation of how complete a plan or
  design is. Runs one of three strategies: gap (what is missing), fit (which option suits
  this context), trade-off (what each choice costs). Not for generating new ideas or
  general research.
triggers:
  - "compare"
  - "compare these options"
  - "compare A vs B"
  - "which is better"
  - "side by side"
  - "gap analysis"
  - "do a gap analysis"
  - "what am I missing"
  - "what have I overlooked"
  - "is my design complete"
  - "fit analysis"
  - "which fits our stack"
  - "which is right for us"
  - "which fits our project"
  - "trade-off analysis"
  - "tradeoff"
  - "what do I give up"
  - "help me choose between"
  - "evaluate options"
allowed-tools: Read, WebFetch, Bash, AskUserQuestion
---

# compare

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Use this skill for structured comparison and analysis tasks: comparing two or more options (tools, libraries, approaches, architectures), choosing between alternatives, or evaluating completeness of a plan or design. Invoke when the user asks to compare, choose between, evaluate, or analyze options — or when they ask what's missing, overlooked, or incomplete in something they've built or proposed. Runs one of three analysis strategies: gap (what's missing from a design or plan), fit (which option matches a specific context or team), or trade-off (what you gain or lose with each choice). Do NOT use for brainstorming new ideas, explaining concepts, fixing bugs, or general research.

Three strategies: **gap**, **fit**, **trade-off**. Auto-detect from user language; surface the detected strategy before proceeding.

## Confidence levels

Every scored cell carries one of:
- **CONFIRMED** — explicitly stated in source material
- **INFERRED** — derived from related signals
- **UNKNOWN** — no information available; absence of mention ≠ NO

**Asymmetric comparison rule:** If option A mentions feature X but option B does not, mark B as **UNKNOWN**, not NO. Apply this when extracting dimensions.

---

## Phase 0 — Strategy Detection

Priority order:

1. **Explicit type named:**
   - "gap analysis", "what am I missing", "what have I overlooked" → `gap`
   - "fit analysis", "which fits our" → `fit`
   - "trade-off", "help me choose" → `trade-off`

2. **Intent signals:**

| Signal | Strategy |
|--------|----------|
| One thing presented; user asks what's missing | `gap` |
| Multiple options + specific context (stack, constraints) | `fit` |
| Multiple options; user wants to understand the choice | `trade-off` |

3. **Ambiguous** — ask:
> "Which framing fits best? Gap (what's missing) · Fit (which is right for your context) · Trade-off (what you give up with each)"

Always surface the detected strategy before proceeding.

---

## Phase 1 — Option Intake

Collect options from inline text, URLs (WebFetch), or file paths (Read).

- `gap`: one option sufficient
- `fit` and `trade-off`: require at least 2 options

**Fit only** — capture context before dimension extraction:
> "What are your key constraints (stack, team skills, timeline)? What does a good outcome look like?"

---

## Phase 2 — Dimension Extraction

Extract from source material, not a fixed template. Produce 4–8 dimensions where options actually differ.

Show dimensions to the user and wait for confirmation before scoring.

---

## Phase 3 — Scoring

For each option × dimension cell: derive value from source only, assign confidence level, apply asymmetric comparison rule.

---

## Phase 4 — Strategy Report

### `gap`

```
## Gap Analysis: [Subject]

### What's covered well
[2-4 sentences on what the subject addresses completely.]

### Gaps
| Gap | Severity | Why it matters |
|-----|----------|----------------|
| [Missing thing] | Critical | [Specific consequence] |
| [Missing thing] | Important | [Specific consequence] |
| [Missing thing] | Minor | [Specific consequence] |

Severity: Critical = breaks correctness/security/completeness · Important = meaningful weakness · Minor = low impact

### Recommended additions
[Prioritized list. What to add, why, how to approach. Order by severity.]
```

### `fit`

```
## Fit Analysis: [Option A] vs [Option B] vs ...

### Your context
[Restate constraints and success criteria. Flag ambiguities.]

### Fit matrix
| Dimension | [Option A] | [Option B] | Weight |
|-----------|-----------|-----------|--------|
| [Dim 1]   | ✅ Strong (CONF) | ⚠️ Partial (INF) | High |
| [Dim 2]   | ❌ Weak (CONF) | ✅ Strong (CONF) | Medium |
| [Dim 3]   | UNKNOWN | ✅ Strong (CONF) | Low |

✅ Strong = fully meets constraint · ⚠️ Partial = gaps/trade-offs · ❌ Weak = does not meet
CONF = confirmed · INF = inferred · UNKNOWN = not mentioned

### Recommendation
**[Option]** is the best fit because [rationale tied to stated constraints].

### When you'd reconsider
[Specific conditions under which another option wins.]
```

### `trade-off`

```
## Trade-off Analysis: [Option A] vs [Option B] vs ...

### Comparison table
| Dimension | [Option A] | [Option B] |
|-----------|-----------|-----------|
| [Dim 1]   | value (CONF) | value (INF) |

### What you gain / lose with each option

**[Option A]**
- Gains: [what this optimizes for]
- Costs: [what you give up]

**[Option B]**
- Gains: [...]
- Costs: [...]

### The core tension
[1-2 sentences naming the fundamental value conflict.]

### Decision heuristic
Choose **[Option A]** if [X] matters more.
Choose **[Option B]** if [Y] matters more.
```

The trade-off report does not name a winner.

---

## Phase 5 — Key Unknowns

If UNKNOWN cells exist, add:

```
## Key unknowns
- If **[Option X]** supports [feature], it would [strengthen/weaken] the [conclusion] because [reason].
```

Omit entirely if no UNKNOWN cells.

---

## Phase 6 — Follow-up offer

> "Want me to dig deeper into any dimension? Or run `ideate:reality-check` on the leading option?"

---

## Obsidian storage

Archive to `$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}/Research/<topic>/<YYYY-MM-DD>-<comparison-name>.md`. Confirm path.
