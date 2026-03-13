---
name: compare
description: >
  Use this skill for structured comparison and analysis tasks: comparing two or more options
  (tools, libraries, approaches, architectures), choosing between alternatives, or evaluating
  completeness of a plan or design. Invoke when the user asks to compare, choose between,
  evaluate, or analyze options — or when they ask what's missing, overlooked, or incomplete
  in something they've built or proposed. Runs one of three analysis strategies: gap (what's
  missing from a design or plan), fit (which option matches a specific context or team), or
  trade-off (what you gain or lose with each choice). Do NOT use for brainstorming new ideas,
  explaining concepts, fixing bugs, or general research.
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

# Skill: compare

Structured comparison using one of three strategies: **gap**, **fit**, or **trade-off**. The strategy is auto-detected from the user's language, then a phase-by-phase workflow executes appropriate to that strategy.

---

## Confidence levels (used throughout)

Every scored cell carries one of three confidence levels:
- **CONFIRMED** — explicitly stated in the source material
- **INFERRED** — derived from related signals in the source
- **UNKNOWN** — no information available; absence of mention ≠ NO

**Asymmetric comparison rule:** If option A mentions feature X but option B does not, mark B as **UNKNOWN**, not NO. Apply this rule starting in Phase 2 when extracting dimensions — design dimensions knowing they will be scored asymmetrically.

---

## Phase 0 — Strategy Detection

Before anything else, determine which strategy to use. Apply this priority order:

**1. Explicit type named** — if the user says any of the following, use that strategy:
- "gap analysis", "gap", "what am I missing", "what have I overlooked", "what gaps" → `gap`
- "fit analysis", "fit", "which fits our", "which is right for us" → `fit`
- "trade-off", "tradeoff", "what do I give up", "help me choose" → `trade-off`

**2. Intent signals** — if no explicit type, infer from language:

| Signal | Strategy |
|--------|----------|
| User presents one thing and asks if it's complete or what's missing | `gap` |
| User has multiple options and a specific context (stack, team, constraints) | `fit` |
| User has multiple options and wants to understand the choice, no clear context | `trade-off` |

**3. Ambiguous** — if intent is unclear, ask before proceeding:
> "To give you the most useful analysis, which framing fits best?
> - **Gap** — you have one thing and want to know what's missing
> - **Fit** — you have options and want to know which is right for your specific context
> - **Trade-off** — you have options and want to understand what you give up with each"

**Always surface the detected strategy before proceeding:**
> "I'll run a **[strategy] analysis** — let me know if you want a different framing (gap / fit / trade-off)."

---

## Phase 1 — Option Intake

Collect the options to compare. Options may be provided as:
- Text descriptions inline in the user's message
- URLs → fetch with WebFetch
- File paths → read with Read tool
- A mix of the above

For each option, identify:
- `name`: Short identifying label
- `source`: text / url / file
- `type`: What kind of thing this is (tool, approach, design, plan, library, etc.)

**Minimum options by strategy:**
- `gap`: one option is sufficient — the gap is measured against a standard or best practice, not another option. Proceed.
- `fit` and `trade-off`: require at least 2 options. If only one is provided, ask for a second before proceeding.

**3+ options (fit and trade-off):** Ask if the user wants to narrow to a 2-option shortlist first. If they prefer to continue with 3+, proceed — the output will be wider but the format still works.

**If a URL fetch fails:** mark that source as UNAVAILABLE and continue with the remaining options. Do not abort.

**Fit strategy only — capture context here, before dimension extraction:**
> "To score fit accurately, tell me:
> - What are your key constraints? (existing stack, team skills, timeline, budget, etc.)
> - What does a good outcome look like for this decision?"

Wait for the response, then proceed to Phase 2 with context in hand.

---

## Phase 2 — Dimension Extraction

**Do not use a fixed template.** Extract evaluation dimensions from the source material.

**For `gap` strategy:** Extract dimensions from the subject being analyzed — what properties, qualities, or requirements would a complete version of this thing need to address? Use a standard, best practice, or spec as the reference frame, not another option.

**For `fit` and `trade-off` strategies:** Extract dimensions from the options themselves. Identify the most meaningful axes of difference between these specific options. Prefer dimensions where options actually differ — dimensions identical across all options add no analytical value.

In all cases: produce 4–8 dimensions, each with a short name and one-sentence description. Keep the asymmetric comparison rule in mind — design dimensions knowing that one option may be silent on a feature.

Show the proposed dimensions to the user before scoring:
> "Here are the dimensions I'll evaluate. Add, remove, or rename any before I proceed:
> 1. [Dimension name] — [what it measures]
> 2. ..."

Wait for confirmation or adjustment, then continue to Phase 3.

---

## Phase 3 — Scoring

For each option × dimension cell:
1. Determine the value from source material only — do not invent
2. Assign a confidence level (see Confidence levels above)
3. Apply the asymmetric comparison rule: absent from source = UNKNOWN, not NO

---

## Phase 4 — Strategy Report

Execute the output format for the detected strategy.

---

### Strategy: `gap`

**Use when:** User presents one thing (a design, plan, implementation, proposal) and wants to know what's missing relative to a standard, best practice, or expected completeness.

```
## Gap Analysis: [Subject]

### What's covered well
[Brief summary — 2-4 sentences — of what the subject does well or addresses completely.]

### Gaps
| Gap | Severity | Why it matters |
|-----|----------|----------------|
| [Missing thing] | Critical | [Specific consequence of absence] |
| [Missing thing] | Important | [Specific consequence of absence] |
| [Missing thing] | Minor | [Specific consequence of absence] |

Severity key:
- **Critical** — absence breaks correctness, security, or completeness
- **Important** — meaningful weakness but not fatal
- **Minor** — nice to have, low impact if absent

### Recommended additions
[Prioritized list. For each: what to add, why, and one sentence on how to approach it.
Order by severity descending. Be concrete — name specific things, not vague categories.]
```

---

### Strategy: `fit`

**Use when:** User needs to choose between options for a specific context (their stack, team, constraints, goals). User context was already captured in Phase 1.

```
## Fit Analysis: [Option A] vs [Option B] vs ...

### Your context
[Restate the constraints and success criteria as understood — 2-4 sentences.
If anything is ambiguous, flag it here.]

### Fit matrix
| Dimension | [Option A] | [Option B] | Weight |
|-----------|-----------|-----------|--------|
| [Dim 1]   | ✅ Strong (CONF) | ⚠️ Partial (INF) | High |
| [Dim 2]   | ❌ Weak (CONF) | ✅ Strong (CONF) | Medium |
| [Dim 3]   | UNKNOWN | ✅ Strong (CONF) | Low |

Fit scoring rubric (applied against the user's stated constraints):
- ✅ Strong — fully meets this constraint or priority
- ⚠️ Partial — partially meets; has trade-offs or gaps
- ❌ Weak — does not meet this constraint

Confidence: CONF = confirmed from source  INF = inferred  UNKNOWN = not mentioned

### Recommendation
**[Option name]** is the best fit for your context because [specific rationale
tied to their stated constraints and high-weight dimensions].

### When you'd reconsider
[Conditions under which the other option(s) would be the right choice — be specific.]
```

---

### Strategy: `trade-off`

**Use when:** User is choosing between options and wants to understand what they sacrifice with each choice. This report surfaces values and costs — it deliberately does **not** declare a winner.

```
## Trade-off Analysis: [Option A] vs [Option B] vs ...

### Comparison table
| Dimension | [Option A] | [Option B] |
|-----------|-----------|-----------|
| [Dim 1]   | value (CONF) | value (INF) |
| [Dim 2]   | value (CONF) | UNKNOWN |

### What you gain / lose with each option

**[Option A]**
- Gains: [what this choice optimizes for — specific, not vague]
- Costs: [what you give up — specific, not vague]

**[Option B]**
- Gains: [what this choice optimizes for]
- Costs: [what you give up]

[Repeat for each option.]

### The core tension
[1–2 sentences naming the fundamental value conflict between the options.
Example: "This is a choice between delivery speed and long-term maintainability."]

### Decision heuristic
Choose **[Option A]** if [X] matters more to you.
Choose **[Option B]** if [Y] matters more to you.
[Repeat for each option.]
```

The trade-off report does not name a winner. The point is to surface the values conflict and leave the decision with the user.

---

## Phase 5 — Key Unknowns

If any UNKNOWN cells are present, include this section after the strategy report. Omit it entirely if there are no UNKNOWN cells.

```
## Key unknowns

These gaps in the source material could change the analysis:

- If **[Option X]** supports [feature/dimension], it would [strengthen / weaken] the
  [recommendation / tension] because [specific reason].
[One entry per UNKNOWN cell that is materially relevant to the conclusion.]
```

---

## Phase 6 — Follow-up Offer

After the report and key unknowns, offer:
> "Want me to dig deeper into any specific dimension? Or run `ideate:reality-check` on the leading option?"

---

## Design Principles

**Dimensions from the material, not a template.** Fixed templates miss domain-specific differentiators. Extracting from the source catches what actually matters for this specific decision.

**Strategy shapes the output.** Each strategy answers a different question:
- Gap → *what's missing?*
- Fit → *what's right for me specifically?*
- Trade-off → *what do I give up?*

**Trade-off deliberately withholds a winner.** The point is to surface values, not to substitute for the user's judgment.

**Gap works with a single option.** Gap analysis compares against a standard or best practice — it does not require a second option.

**Fit needs context before dimensions.** Dimensions extracted without knowing the user's constraints may not illuminate the choice points that matter. Capture context in Phase 1.

---

## Obsidian Storage

After producing output, archive to the Neurons vault for long-term memory.

1. **Determine topic slug**: convert the comparison topic to kebab-case
   (e.g. "API authentication options" → `api-authentication-options`)

2. **Determine vault path**: read `obsidian-rules.md` from the office plugin references
   (`~/.claude/plugins/cache/local/office/*/references/obsidian-rules.md`) to confirm
   correct placement. Default: `Analysis/<topic>/<YYYY-MM-DD>-<comparison-name>.md`

3. **Write to vault**:
   ```bash
   VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
   DEST_PATH="Analysis/<topic>/<YYYY-MM-DD>-<comparison-name>.md"
   mkdir -p "$VAULT_ROOT/$(dirname "$DEST_PATH")"
   cat > "$VAULT_ROOT/$DEST_PATH" << 'EOF'
   <output-content>
   EOF
   ```

4. **Confirm**: "Saved to Neurons: Analysis/<topic>/<YYYY-MM-DD>-<comparison-name>.md"
