# Retrospective Report Structure

Template for consistent retrospective output across sessions. Enables cross-session comparison and trend analysis.

**Target length**: 40-60 lines
**Purpose**: Standardized format so each retrospective can compare metrics to previous sessions

---

## Report Sections

### 1. Executive Summary (5-7 lines)

```
**Session**: [date range, e.g., 2026-02-16 to 2026-02-17]
**Duration**: [X hours, Y minutes]
**Team**: [N agents + 1 lead]
**Scope**: [X issues/areas attempted] → [Y completed]
**Quality**: [X% quality gates pass] | **First-pass rate**: [Y%]
**Key metric**: [Most important finding, e.g., "Identified DDEV cleanup as #1 bottleneck"]
```

**Why this section**: At a glance, what was accomplished and how well.

---

### 2. What Worked Well (3-5 items, KEEP DOING signals)

- **[Pattern name]**: [One-sentence description of what worked]
  - Evidence: [Where it was observed, agent quotes if available]
  - Recommendation: [Why we should keep doing this]

Example:
```
- **Tight test-fix-validate loop**: Developers fix issues, validators immediately re-test in same DDEV
  - Evidence: 56% first-pass rate (issues passed validation on first attempt)
  - Recommendation: Maintain this workflow; it provides fast feedback and prevents rework
```

**Minimum evidence**: 2+ independent occurrences or sources

---

### 3. What Didn't Work (3-5 items, IMPROVE signals)

- **[Problem name]**: [One-sentence description of blocker/inefficiency]
  - Root cause: [Why did this happen]
  - Impact: [Time lost, quality gap, utilization impact]
  - Recommendation: [Proposed fix]

Example:
```
- **DDEV resource contention**: Validators blocked waiting for DDEV slots
  - Root cause: 3 worktrees active, only 3 DDEV instances available, cleanup not immediate
  - Impact: 30% of validator time spent waiting for DDEV availability
  - Recommendation: Implement automatic DDEV cleanup after validation completes
```

**Minimum evidence**: 1 major blocker OR 2+ minor issues

---

### 4. Code Knowledge Learned (3-5 technical insights, LEARN signals)

- **[Topic]**: [What was discovered]
  - Where: [Files/modules/APIs involved]
  - Why it matters: [Impact on future work]

Example:
```
- **Entity field validation pattern in Drupal 11**: Core uses pre_validate hooks + custom validators on field definition
  - Where: core/modules/field/src/Entity/FieldConfig.php, Entity\ValidationAdapter
  - Why it matters: Reusable pattern for any module needing field-level validation; saves time on future Settings Tray or form issues
```

**Captured for**: MEMORY.md and future agent context

---

### 5. Start/Stop Recommendations (3 each, derived from agent feedback)

**START doing:**
1. [Action] — Why: [Agent feedback or evidence]
2. [Action] — Why: [Agent feedback or evidence]
3. [Action] — Why: [Agent feedback or evidence]

**STOP doing:**
1. [Activity] — Why: [Time saved or problem prevented]
2. [Activity] — Why: [Time saved or problem prevented]
3. [Activity] — Why: [Time saved or problem prevented]

Example:
```
START doing:
1. Phase 0 test design review in validate-patch — Why: Caught 4 test design issues before DDEV, saved 30 min of rework
2. Immediate DDEV cleanup after validation — Why: Reduced validator idle time from 30% to <5%

STOP doing:
1. Waiting for all issues before running validators — Why: Streaming pipeline proved faster; start validation as soon as code is ready
```

---

### 6. Action Items for Next Session (Immediate, Next Sprint, Future)

**Immediate** (before next session):
- [Fix/implement/document]
- [Fix/implement/document]

**Next sprint** (next 1-2 week cycle):
- [Process change to deploy]
- [Workflow improvement to test]

**Future** (longer-term roadmap):
- [Architectural improvement]
- [Major refactoring]

---

### 7. Memory Updates (what to save to MEMORY.md)

```
Add to MEMORY.md:

**Session Baseline**:
- First-pass rate: [X%]
- Agent utilization: [X%]
- Idle ratio: [X%]
- Quality gates pass: [X%]
- Code regression rate: [X%]

**Code Learnings**:
- [Technical insight 1]
- [Technical insight 2]
- [Technical insight 3]

**Process Changes**:
- Started: [what we start doing]
- Stopped: [what we stop doing]
- Improved: [what got better]

**Trend Analysis**:
- Compared to 2026-02-13 session: [improving/degrading in what areas?]
- Baseline target for next session: [specific metrics to aim for]
```

---

## Metrics Tracking (5 Key Metrics)

These numbers enable cross-session trend analysis:

### 1. First-Pass Rate
**Definition**: Tasks that passed validation on first attempt (no rework)
**Calculation**: (issues passing validation round 1) / (total issues) × 100%
**Target**: 80%+ (current baseline: 56%)
**Why**: Lower rework = faster pipeline

### 2. Agent Utilization
**Definition**: Time agents spent in productive work vs. total session time
**Calculation**: (active work minutes) / (total session minutes) × 100%
**Target**: 85%+ (current baseline: 70%)
**Why**: High utilization = efficient resource use

### 3. Idle Ratio
**Definition**: Time agents spent waiting (blocked on dependencies, DDEV availability, etc.)
**Calculation**: (waiting minutes) / (total session minutes) × 100%
**Target**: <15% (current baseline: 30%)
**Why**: Lower idle = fewer bottlenecks

### 4. Quality Gates Pass %
**Definition**: Percentage of code changes that pass all gates first-time (phpcs, phpstan, phpunit)
**Calculation**: (PRs passing all gates round 1) / (total PRs) × 100%
**Target**: 100% (current baseline: 100%)
**Why**: Prevents broken merges

### 5. Code Regression Rate
**Definition**: Bugs introduced by changes that were caught in testing
**Calculation**: (regression bugs) / (total issues fixed) × 100%
**Target**: 0% (current baseline: 0%)
**Why**: Zero regressions = high code quality

---

## Cross-Session Comparison Template

When writing the report, reference previous session:

```
**Compared to 2026-02-13 session**:
- First-pass rate: 56% (same as last session)
- Agent utilization: 70% (up from 65%)
- Idle ratio: 30% (down from 35% ✓ improvement)
- Quality gates: 100% (maintained)
- Code regression: 0% (maintained)

**What changed**: DDEV cleanup protocol implementation reduced validator idle time
**What stayed same**: First-pass rate suggests developer workflow unchanged (still need to improve)
**What worsened**: (none)
**Next focus**: Increase first-pass rate to 80% by improving code review thoroughness in Phase 2
```

---

## Rationale

### Why Standard Structure?
1. **Comparison**: Each session's data is in same format, enabling trend spotting
2. **Completeness**: Forces reflection on all dimensions (what worked, didn't, learned)
3. **Action cards**: Each section maps to specific action card categories (KEEP, IMPROVE, LEARN)
4. **MEMORY.md updates**: Clear what should be captured for future reference

### Why These 5 Metrics?
- **First-pass rate**: Developer + validator workflow quality
- **Utilization**: Resource efficiency
- **Idle ratio**: Bottleneck visibility (opposite of utilization, but different signal)
- **Quality gates**: Code safety
- **Code regression**: Quality of fixes

Together they span: **Throughput, Quality, Efficiency, Safety**

---

## Example: Complete Minimal Report

```
**Session**: 2026-02-16 to 2026-02-17
**Duration**: 6 hours 45 minutes
**Team**: 10 agents + 1 lead
**Scope**: 7 Settings Tray jQuery→HTMX issues → 7 completed
**Quality**: 100% quality gates pass | **First-pass rate**: 56%
**Key metric**: DDEV cleanup protocol eliminated 25% validator idle time

## What Worked Well
- Tight test-fix-validate loop: 56% first-pass rate, fast feedback
- DDEV resource management: New cleanup protocol reduced contention
- Cross-agent collaboration: Smooth handoffs between developers and validators

## What Didn't Work
- Code review depth: 44% of issues needed rework for missing edge cases
- Validator DDEV startup: Initial startup took 3-5 min per instance
- Cross-issue pattern recognition: Developers working independently, not seeing shared patterns

## Code Knowledge Learned
- Settings Tray Drupal.Behaviors pattern: State management via data attributes
- jQuery→HTMX conversion: Use data-attributes for state, HTMX hx-swap for DOM updates
- Test harness for FunctionalJavaScript: WebDriver + custom waits for timing issues

## Start/Stop Recommendations
**START**: Phase 0 test design review before DDEV (caught 4 design issues)
**STOP**: Waiting for all issues before validation (streaming pipeline faster)

## Action Items
**Immediate**: Deploy DDEV cleanup protocol to all validators
**Next sprint**: Improve code review checklist for edge cases; target 80% first-pass rate
**Future**: Automate cross-issue pattern detection across issue queue

## Memory Updates
- Session baseline: 56% first-pass, 70% utilization, 30% idle
- Code learning: Settings Tray Behaviors, jQuery→HTMX patterns
- Process: Started cleanup protocol, stopped batch validation gates
```

---

## Notes

- **Flexibility**: Not every section will have exactly 3-5 items; this is a guide, not a constraint
- **Evidence**: Always cite sources (agent quotes, metrics, JSONL patterns, kanban board state)
- **Actionability**: Every item in "What Didn't Work" should map to a start/stop recommendation
- **Trend**: Compare current metrics to MEMORY.md baselines from previous sessions
