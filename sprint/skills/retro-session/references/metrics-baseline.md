# Metrics Baseline & Calculation Methods

Defines 5 key metrics tracked across retrospectives, with calculation methods for extracting data from JSONL transcripts and kanban board state.

**Purpose**: Enable cross-session trend analysis and bottleneck identification

---

## Metric #1: First-Pass Rate

**Definition**: Percentage of issues/tasks that passed validation on the first attempt (no rework needed)

### Calculation

```
First-Pass Rate = (Issues passed validation round 1) / (Total issues worked) × 100%
```

### Data Sources

**From Kanban Board**:
- Count cards in DONE status that have `validation_attempts: 1`
- Count cards in DONE status with `validation_attempts: > 1` (these are rework)

**From JSONL Transcript**:
```bash
# Search for validation attempt patterns
grep -i "validation.*pass\|test.*pass\|phpunit.*passed" session-id.jsonl | wc -l

# Search for rework patterns (developer re-submit after validator rejection)
grep -i "rework\|resubmit\|second.*attempt\|re-validation" session-id.jsonl | wc -l
```

### Interpretation

- **Target**: 80%+ (focus: improve developer code quality)
- **High (80%+)**: Developers are shipping good code, low rework overhead
- **Medium (50-79%)**: Mix of well-implemented and missed-edge-case issues
- **Low (<50%)**: Developers need better code review discipline or validator expectations are misaligned

### Example Calculation

```
Session 2026-02-16:
- Cards completed: 7 Settings Tray issues
- Cards with validation_attempts=1: 4 (CLEAN_VALIDATION tag)
- Cards with validation_attempts>1: 3 (REWORK tag)

First-Pass Rate = 4 / 7 × 100% = 57.1%

Note: Close to baseline of 56%; suggests developer workflow unchanged
```

---

## Metric #2: Agent Utilization

**Definition**: Percentage of session time where agents were in productive work (not idle/waiting)

### Calculation

```
Agent Utilization = (Active work minutes) / (Total session minutes) × 100%

Where:
- Active work = time agent spent writing code, running tests, analyzing data, interviewing
- Idle/waiting = time agent spent blocked on DDEV slots, waiting for other agents, debugging
```

### Data Sources

**From JSONL Transcript** (grep-level):
```bash
# Find time gaps between tool calls (indicates waiting/idle periods)
grep '"timestamp"' session-id.jsonl | \
  awk -F'"' '{print $4}' | \
  while read ts; do
    # Calculate gap from previous timestamp
    # Large gaps (>30 sec) indicate idle periods
  done

# Count tool calls as proxy for active work
grep -c '"tool":\|"skill":\|"agent"' session-id.jsonl

# Search for explicit idle/wait patterns
grep -i "waiting\|blocked\|ddev.*unavailable\|queue" session-id.jsonl | wc -l
```

**From Agent Timeline**:
- Session start time (from JSONL first entry)
- Session end time (from JSONL last entry)
- Agent active periods (message sent/response received timestamps)
- Agent idle periods (long gaps between messages)

### Interpretation

- **Target**: 85%+ (focus: reduce blocking issues and bottlenecks)
- **High (85%+)**: Resources allocated well, minimal waiting
- **Medium (70-84%)**: Some bottlenecks (e.g., DDEV contention, inter-agent dependencies)
- **Low (<70%)**: Major bottlenecks; investigation needed (which agents are idle? why?)

### Example Calculation

```
Session 2026-02-16:
- Session duration: 6 hours 45 min = 405 minutes
- Active work periods: 283 minutes (developers + validators writing/testing)
- Idle periods: 122 minutes (validators waiting for DDEV, developers waiting for validation feedback)

Agent Utilization = 283 / 405 × 100% = 69.9%

Problem identified: Validators spending 122/405 = 30% of time idle
Root cause: DDEV cleanup not immediate after validation; next validator had to wait 2-3 min per instance
```

---

## Metric #3: Idle Ratio

**Definition**: Percentage of session time where agents were waiting/blocked (opposite of utilization, but measured separately for clarity)

### Calculation

```
Idle Ratio = (Waiting minutes) / (Total session minutes) × 100%

Waiting minutes = DDEV queue time + dependency waits + context switching overhead
```

### Data Sources

**From JSONL Transcript** (grep-level):

> **WARNING: Do NOT use keyword grep for idle detection.**
> `grep -ic 'wait|queue|block|unavailable'` is unreliable — it returned 277 hits in a
> 104-minute session because these words appear in JSON field names, task descriptions,
> and queue-operation type entries. There is no way to convert that count to idle minutes.
> Use the structured approach below instead.

```bash
# Blocking signal proxy: count explicit queue-operation entries
# (appears only when work is explicitly queued/waiting, not in normal text)
grep -c '"type":"queue-operation"' session-id.jsonl

# Utilization proxy: tool_use vs. agent_progress ratio
# High tool_use relative to agent_progress = agents doing work, not coordinating
TOOL_USE=$(grep -c '"type":"tool_use"' session-id.jsonl)
PROGRESS=$(grep -c '"type":"agent_progress"' session-id.jsonl)
echo "Tool use: $TOOL_USE, Agent progress: $PROGRESS"

# Targeted DDEV-specific wait detection (specific enough to be low-noise)
grep -i "ddev.*queue\|waiting for.*ddev\|blocked.*ddev" session-id.jsonl | wc -l

# Time gaps >30 seconds between messages = potential idle period
# (Use timestamp differences to calculate)
```

**From Kanban Board**:
- Cards in VALIDATING status but not yet in DONE indicate validators are idle/waiting
- Cards blocked (blockedBy field set) show dependency waits

### Interpretation

- **Target**: <15% (focus: eliminate bottlenecks)
- **Low (<15%)**: Smooth pipeline, minimal blocking
- **Medium (15-30%)**: Some bottlenecks affecting 1-2 agents
- **High (>30%)**: Significant blocking; retrospective should identify root causes

### Example Calculation

```
Session 2026-02-16:
- Total session: 405 minutes
- Validators waiting for DDEV: 82 minutes
- Developers waiting for validation: 35 minutes
- Other waiting (context switch, meeting, etc.): 5 minutes
- Total idle: 122 minutes

Idle Ratio = 122 / 405 × 100% = 30.1%

Bottleneck: DDEV resource contention accounts for 82/122 = 67% of idle time
Action: Implement immediate cleanup protocol
```

---

## Metric #4: Quality Gates Pass %

**Definition**: Percentage of code changes that pass all quality gates on first submission (phpcs, phpstan, phpunit)

### Calculation

```
Quality Gates Pass % = (Submissions passing all gates round 1) / (Total submissions) × 100%

Where:
- All gates = phpcs passed AND phpstan passed AND phpunit passed
- Round 1 = first code submission before any rework
```

### Data Sources

**From JSONL Transcript** (grep-level):
```bash
# Count phpcs runs
grep -i "phpcs\|coding.*standards" session-id.jsonl | grep -i "pass\|success" | wc -l
grep -i "phpcs\|coding.*standards" session-id.jsonl | wc -l

# Count phpstan runs
grep -i "phpstan\|static.*analysis" session-id.jsonl | grep -i "pass\|success" | wc -l
grep -i "phpstan" session-id.jsonl | wc -l

# Count phpunit runs
grep -i "phpunit\|test.*pass" session-id.jsonl | grep -i "pass\|all.*pass" | wc -l
grep -i "phpunit" session-id.jsonl | wc -l
```

**From Validator Report Cards**:
- Count cards with "Quality gates: PASS" tag
- Count cards with "Quality gates: FAIL" → "REWORK" → re-test flow

### Interpretation

- **Target**: 100% (no broken merges)
- **100%**: Code quality excellent; all changes merge-ready immediately
- **95-99%**: Minor formatting/style issues caught but no functional problems
- **<95%**: Functional bugs in code; indicates deeper code review issues

### Example Calculation

```
Session 2026-02-16:
- Total issues submitted: 7
- Issues passing phpcs round 1: 7
- Issues passing phpstan round 1: 6 (1 false-positive error)
- Issues passing phpunit round 1: 7

Result: All 7 issues eventually passed all gates, but 1 needed type-hint fix
Quality Gates Pass % = 6/7 = 85.7% first-pass, but 100% eventual

Note: Distinguish between "first-pass" (85.7%) and "eventual" (100%)
Better metric for bottleneck detection: first-pass rate
```

---

## Metric #5: Code Regression Rate

**Definition**: Percentage of fixes that introduced bugs caught during testing

### Calculation

```
Code Regression Rate = (Regression bugs found) / (Total issues fixed) × 100%

Target: 0% (no regressions introduced by our changes)
```

### Data Sources

**From Validator Failure Classifications**:
- Count failures with root_cause = "CODE_REGRESSION"
- These indicate the developer's code change broke something

**From JSONL Transcript** (grep-level):
```bash
# Search for test failure patterns indicating regression
grep -i "regression\|breaking.*change\|broke.*test\|unexpected.*failure" session-id.jsonl | wc -l

# Search for "before this change it worked" patterns
grep -i "before.*change\|this broke\|unrelated.*test" session-id.jsonl | wc -l
```

**From Kanban Board**:
- Cards with "REGRESSION: YES" in the body indicate rework due to regression

### Interpretation

- **0%**: Excellent code quality; changes don't break existing functionality
- **1-5%**: Acceptable; caught and fixed during validation
- **>5%**: Code review discipline issues; developers not checking side effects

### Example Calculation

```
Session 2026-02-16:
- Total issues fixed: 7 Settings Tray conversions
- Issues with rework needed: 3
  - Issue 1: Test design flaw (not regression)
  - Issue 2: Missing edge case in validation logic (not regression)
  - Issue 3: HTMX selector not matching all DOM elements (REGRESSION)
- Actual regressions: 1

Code Regression Rate = 1 / 7 = 14.3%

Problem: Higher than target 0%. Root cause: HTMX DOM selectors too narrow.
Action: Add integration test for all selector matches
```

---

## Composite Metrics (Derived from Base 5)

### Pipeline Efficiency Score

```
Pipeline Efficiency =
  (First-Pass Rate × 0.3) +
  (Agent Utilization × 0.3) +
  (Quality Gates Pass % × 0.2) +
  ((100% - Idle Ratio) × 0.2)
```

Weights: Code quality → throughput → execution efficiency

**Interpretation**:
- >85: Pipeline running smoothly
- 70-85: Some optimization opportunities
- <70: Major bottleneck(s) need addressing

---

## Cross-Session Trend Analysis Template

Compare current session to baseline:

```
**Baseline (2026-02-13)**:
- First-pass: 56%
- Utilization: 65%
- Idle ratio: 35%
- Quality gates: 100%
- Regression: 0%

**Current (2026-02-16)**:
- First-pass: 56% (→ no change, need investigation)
- Utilization: 70% (+5pp, improvement)
- Idle ratio: 30% (-5pp, improvement)
- Quality gates: 100% (maintained)
- Regression: 0% (maintained)

**Trend Analysis**:
- ✓ DDEV cleanup protocol working; idle time reduced 5pp
- ✗ First-pass rate flat; developer code review unchanged
- Next action: Implement Phase 0 test design review to catch test issues before DDEV
```

---

## Notes

- **JSONL mining is grep-level**: These calculations use keyword searches, not full JSON parsing. Pattern match for keywords and count.
- **Timestamps matter**: Use JSONL timestamps to calculate actual time elapsed vs. wallclock time
- **Multiple sources for triangulation**: If JSONL and kanban data differ, that's a signal to investigate
- **Session variation**: Sessions of different types (issue fixing vs. bulk refactoring vs. research) will have different baselines
- **Store baseline in MEMORY.md**: After each retrospective, save these 5 metrics to MEMORY.md for comparison

---

## JSONL Grep Patterns (Quick Reference)

```bash
# Time calculation (bash, extract and compare timestamps)
grep '"timestamp"' session-id.jsonl | head -1
grep '"timestamp"' session-id.jsonl | tail -1

# Work detection (tool calls indicate active work)
grep -c '"tool":\|"_progress"' session-id.jsonl

# Idle detection (structured — keyword grep is unreliable, see Metric #3 warning)
grep -c '"type":"queue-operation"' session-id.jsonl          # blocking signal proxy
TOOL_USE=$(grep -c '"type":"tool_use"' session-id.jsonl) && PROGRESS=$(grep -c '"type":"agent_progress"' session-id.jsonl) && echo "tool_use=$TOOL_USE agent_progress=$PROGRESS"

# Test results
grep -c 'pass\|fail\|error' session-id.jsonl

# Agent messages (interaction frequency)
grep -c '"type".*"message"\|"recipient"' session-id.jsonl
```

---

## Future Improvements (Phase 2)

- Hook-based continuous metric capture (if approved)
- Semantic event labeling from tool call patterns (e.g., "test_failure" from Bash(phpunit))
- Real-time bottleneck detection and alerts
- Automated metric calculation (instead of grep-level)
