# Agent Interview Templates

Reference templates for Phase 2 (Agent Interviews) in the retro-session skill.

**Use only if agents are still active (Phase 0: FULL MODE).**
**Total time:** 15-20 minutes (interviews run in parallel when possible)
**Per agent:** 6 questions (~5-7 min each): 3 common + 3 role-specific

---

## Common Section (All Agents Answer)

These questions are asked of EVERY agent regardless of role. Cross-role convergence on the same answer = high-confidence signal.

### C1. Biggest Success (KEEP signal)

> What was the single most effective thing this session -- a practice, tool, or interaction that worked well and should be repeated?

**Format:** One sentence describing what worked, one sentence explaining why.

**Why this question:** Identifies practices to preserve. When multiple roles independently name the same thing, it's a strong KEEP signal.

### C2. Technical Insight to Preserve (LEARN signal)

> What non-obvious technical knowledge did you discover this session that would help a future agent working on similar issues?

**Format:** Describe the insight and which files/modules/APIs it applies to.

**Why this question:** Captures architectural discoveries, tricky APIs, test patterns, and codebase quirks. Developers surface code-level insights; validators surface test patterns; process agents surface tooling/infrastructure knowledge. All are valuable for MEMORY.md.

### C3. One Process Change (IMPROVE signal)

> If you could change ONE thing about how the team works for next session, what would it be?

**Format:**
- **Change:** [specific, implementable action]
- **Category:** TOOLING / COMMUNICATION / TESTING / WORKFLOW / INFRASTRUCTURE
- **Expected impact:** [what improves and by roughly how much]

**Why this question:** Forces prioritization. Consolidates the "start/stop" pattern into a single highest-leverage recommendation per agent. Cross-role convergence = high-confidence improvement signal.

---

## Developer-Specific Section

Asked only of agents in the implementer role. Focuses on code decision reasoning, pattern recognition across issues, and workflow friction.

### D1. Key Decision and Confidence

> For the issue you found most challenging: What was the key technical decision you made, what alternatives did you consider and reject, and how confident are you in the result?

**Format:**
- **Issue:** [number/description]
- **Decision:** [what you chose]
- **Rejected alternatives:** [what you considered and why you rejected each]
- **Confidence:** HIGH / MEDIUM / LOW
- **Risk area (if not HIGH):** [what could go wrong]

**Why this question:** Captures reasoning that code alone doesn't show. Rejected alternatives are especially valuable -- they prevent future agents from re-exploring dead ends. Confidence rating pairs with validator handoff assessment (V2) to identify perception gaps.

### D2. Cross-Issue Patterns

> Looking across ALL issues you worked on this session: What recurring pattern, common root cause, or repeated approach did you notice?

**Format:** Describe the pattern and which issues it appeared in.

**Why this question:** Only developers who worked multiple issues can see cross-cutting patterns. These often reveal systemic codebase issues or reusable fix strategies that should be documented.

### D3. Highest Workflow Friction

> What was the single biggest friction point in your workflow -- the thing that slowed you down most?

**Format:**
- **Friction:** [specific description]
- **Category:** TOOLING / COMMUNICATION / TESTING / CONTEXT_SWITCHING / WAITING
- **Time impact:** [rough estimate: minutes lost or percentage of time]

**Why this question:** Identifies concrete bottlenecks from the developer's perspective. Category tagging enables trend analysis across sessions. Distinct from C3 (process change) because this captures the OBSERVATION while C3 captures the RECOMMENDATION.

---

## Reviewer-Specific Section

Asked only of agents in the reviewer role. Focuses on failure analysis, developer blind spots, and infrastructure friction.

### V1. Failure Root Cause Classification

> For each issue that failed validation (partially or fully), classify the root cause:

**Format (per failure):**
- **Issue:** [number]
- **Root cause:** CODE_REGRESSION / TEST_DESIGN / INFRASTRUCTURE / HANDOFF_GAP / STANDARDS_ONLY
- **One-line explanation:** [what specifically failed and why]

**Definitions:**
- CODE_REGRESSION: The code change itself introduced a bug or broke existing behavior
- TEST_DESIGN: Tests are flawed, brittle, or test the wrong thing -- code was actually fine
- INFRASTRUCTURE: DDEV, environment, or tooling issue unrelated to the code
- HANDOFF_GAP: Missing context, unclear scope, or incomplete information from developer
- STANDARDS_ONLY: Only phpcs/formatting issues, no functional problems

**Why this question:** The failure taxonomy is the validator's highest-value unique output. It separates code quality issues from process/infrastructure issues. Trend analysis across sessions reveals whether failures are shifting categories (e.g., fewer CODE_REGRESSION but more HANDOFF_GAP = different intervention needed).

### V2. Developer Blind Spots and Handoff Quality

> What did you catch that the developer couldn't have seen from their side? Rate overall handoff quality.

**Format:**
- **Blind spots found:** [environmental, integration, or cross-module issues]
- **Handoff quality:** CLEAN / MINOR_GAPS / SIGNIFICANT_REWORK / BLOCKED
- **If not CLEAN:** [what was missing from the handoff]

**Why this question:** Captures the unique validator perspective -- they see the code in a full runtime environment that developers may not have. The handoff rating tracks the developer-validator interface quality over time. Paired with D1 confidence rating, this reveals calibration gaps (developer says HIGH confidence but validator says SIGNIFICANT_REWORK = calibration problem).

### V3. Infrastructure and Resource Friction

> What DDEV, environment, or tooling friction did you encounter? How did it affect validation speed?

**Format:**
- **Friction encountered:** [specific issue]
- **Time impact:** [minutes lost or workaround needed]
- **Suggestion:** [what would prevent this next time]

**Why this question:** Validators are the primary consumers of DDEV infrastructure and the first to feel resource contention. Their friction reports directly inform DDEV slot management, cleanup protocols, and infrastructure improvements. This data is hard to extract from logs alone.

---

## Process-Improvement-Specific Section

Asked only of the process-improvement agent. Uses the O-E-I-R (Observation-Evidence-Impact-Recommendation) format for structured systemic analysis.

### P1. Pipeline Flow Analysis

> Where did work flow smoothly through the pipeline and where did it stall? Identify the primary bottleneck.

**Format (O-E-I-R):**
- **Observation:** [what you saw in the pipeline flow]
- **Evidence:** [which issues/agents/stages demonstrate this]
- **Impact:** [how it affected throughput, quality, or agent utilization]
- **Recommendation:** [specific change to improve flow]

**Why this question:** Only the process-improvement agent has the cross-pipeline view. Developers see their issues; validators see their test results; process sees the whole board. Bottleneck identification is this role's primary unique value.

### P2. Cross-Agent Interaction Patterns

> What interaction patterns between agents helped or hurt productivity? Identify the most effective and most problematic interaction.

**Format (O-E-I-R):**
- **Most effective interaction:** [what happened, between which roles, why it worked]
- **Most problematic interaction:** [what happened, between which roles, why it hurt]
- **Recommendation:** [how to amplify good patterns and mitigate bad ones]

**Why this question:** Agent interaction quality is invisible in code artifacts and hard to extract from message logs. The process agent's qualitative judgment about which interactions were productive vs. wasteful captures signals that automated analysis misses.

### P3. Systemic Root Causes

> Looking across ALL problems this session (not just one issue), what is the deepest root cause you identified -- the one thing that, if fixed, would prevent the most other problems?

**Format (O-E-I-R):**
- **Observation:** [the pattern of problems]
- **Evidence:** [specific instances across issues/agents]
- **Impact:** [how many downstream problems this root cause created]
- **Recommendation:** [intervention to address the root cause]

**Why this question:** Moves beyond symptom-level feedback to systemic analysis. The process agent is uniquely positioned to see causal chains across the pipeline. A single root cause fix can eliminate multiple surface-level problems.

---

## Interview Execution Guide

### Before Interviewing

1. Note which agents are available (Phase 0 determines FULL vs. POST-MORTEM mode)
2. Send all common questions first (C1-C3), then role-specific questions
3. Interviews can run in parallel -- send questions to all available agents simultaneously

### During Interviews

- **Accept structured answers** -- agents are AI, they excel at classification and structured output
- **Probe only when classifications conflict** -- e.g., developer says HIGH confidence but validator says SIGNIFICANT_REWORK
- **Do not ask agents to compute metrics** -- they report qualitative observations, the retrospective skill computes metrics separately in Phase 3
- **Time-box** -- if an agent hasn't responded in 3 minutes, move on

### After Interviews

- **Cross-reference C3 answers** -- if 2+ agents name the same process change, it's high-priority
- **Cross-reference D1 confidence with V2 handoff quality** -- calibration gaps are actionable
- **Map every answer to KEEP / IMPROVE / LEARN** for the action card output
- **Capture verbatim** -- quote agents directly in the report, don't paraphrase

### Signal Mapping

| Question | Primary Signal | Secondary Signal |
|----------|---------------|-----------------|
| C1 (Success) | KEEP | -- |
| C2 (Technical insight) | LEARN | -- |
| C3 (Process change) | IMPROVE | -- |
| D1 (Decisions/confidence) | LEARN | IMPROVE (if low confidence pattern) |
| D2 (Cross-issue patterns) | LEARN | KEEP (if pattern is a good strategy) |
| D3 (Workflow friction) | IMPROVE | -- |
| V1 (Failure classification) | IMPROVE | LEARN (failure pattern knowledge) |
| V2 (Blind spots/handoff) | IMPROVE | LEARN (calibration insights) |
| V3 (Infrastructure friction) | IMPROVE | -- |
| P1 (Pipeline flow) | IMPROVE | KEEP (smooth flow areas) |
| P2 (Interaction patterns) | KEEP / IMPROVE | -- |
| P3 (Root causes) | IMPROVE | LEARN |

---

## Design Rationale

### Why this structure works for AI agents

1. **Structured output formats**: Every question specifies an exact response format (classifications, ratings, O-E-I-R). AI agents produce more consistent, comparable answers with explicit structure than with open-ended prompts.

2. **Classification over narration**: Questions like V1 (failure taxonomy) and D1 (confidence rating) use enumerated categories. This produces data that can be tracked across sessions without interpretation ambiguity.

3. **Role-appropriate formats**: Developers get decision/confidence structures. Validators get taxonomies and ratings. Process gets O-E-I-R for systemic analysis. Each format matches how that role naturally processes information.

4. **No data-computation asks**: Agents report what they OBSERVED and JUDGED, not metrics they'd need to calculate. Metric computation happens in Phase 3 from artifacts, not from agent memory.

### Why the scope is right (15-20 min total)

- 12 total unique questions, but each agent answers only 6 (3 common + 3 role-specific)
- At ~1-2 min per structured answer, each interview takes 5-7 minutes
- Parallel interviews: wall-clock time is ~7 min for all three, well within 15-20 min budget
- Sequential interviews: ~20 min total, at the upper bound but still within budget
- Every question has a clear deliverable format -- no open-ended exploration that could run long

### What signals this template extracts that code/JSONL mining cannot

1. **Rejected alternatives** (D1): Code shows what was chosen, not what was considered and discarded
2. **Confidence calibration** (D1 vs V2): The gap between developer confidence and validator assessment reveals systematic blind spots
3. **Failure root cause classification** (V1): Logs show pass/fail, not WHY something failed at a systemic level
4. **Cross-agent interaction quality** (P2): Message logs show what was said, not whether it was helpful
5. **Systemic root causes** (P3): Requires qualitative judgment to connect dots across the pipeline
6. **Prioritized recommendations** (C3): Agents weigh trade-offs that artifact analysis cannot
