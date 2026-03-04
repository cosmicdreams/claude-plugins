---
name: session
description: Use at the end of a sprint after all agents are shut down, or when the user asks to run a retrospective. Invoke with /retro:session. Do not invoke during active sprint work or before agents have completed their tasks.
triggers:
  - "run retrospective"
  - "session review"
  - "what worked and what didn't"
  - "end of session review"
  - "capture session learnings"
doNotUse: "mid-session, for individual issue reviews, status checks"
---

# Session Retrospective Skill

Comprehensive interactive retrospective capturing agent feedback, session metrics, and generating actionable recommendations.

**Use at:** End of session (agent interviews are collected during sprint shutdown, not here)
**Use by:** team lead (main agent)
**Duration:** 25-35 minutes
**Note:** Agent interviews are captured by the SubagentStop hook during sprint shutdown and stored in `analysis-reports/retro-session/<YYYY-MM-DD>+<sprint-name>/interviews/`. This skill reads those files — no timing dependency on agent availability.

## Input Required

- **Session date range** (start/end dates)
- **Scope summary** (what issues/work was attempted)
- **List of active agents** (or confirmation they're shutdown)
- **Kanban board location** (if sprint:run was used)
- **Baseline metrics** (reference MEMORY.md for previous session comparison)

---

## Execution Flow

### Phase 0: Pre-Check (1 min)
- [ ] Check for stored interview files in `analysis-reports/retro-session/<YYYY-MM-DD>+<sprint-name>/interviews/`
- [ ] Note how many agents were interviewed (files present = interviews collected during sprint shutdown)
- [ ] If no interview files exist, note this gap — interviews were missed during sprint

### Phase 1: Setup (5 min)
- [ ] Note session start/end times
- [ ] Identify active agents still running
- [ ] Prepare agent interview questions
- [ ] Collect session context (scope, deliverables, team size)

### Phase 2: Read Stored Agent Interviews (5 min)

Agent interviews are collected by the retro plugin's SubagentStop hook during each agent's graceful shutdown (interview → capture → store). They are stored as individual files per agent.

- [ ] Read all files in `analysis-reports/retro-session/<YYYY-MM-DD>+<sprint-name>/interviews/`
- [ ] For each interview file, extract based on templates at:
- **Action Cards**: `kanban/retrospective-actions/1_backlog/`
- **Templates**: `retro:interviews` (interview-templates.md)
- [ ] Cross-reference C3 answers — if 2+ agents name the same process change, flag as high-priority
- [ ] Cross-reference D1 confidence with V2 handoff quality for calibration gaps
- [ ] Note any missing agent types (gaps in coverage)

**If no interview files exist**: Note the gap in the report. This means the Graceful Shutdown Sequence was not followed during the sprint — flag as a process issue.

### Phase 3: Data Analysis (10-15 min)

**3A: Kanban Board Analysis**
- [ ] *(Optional — only if sprint:run was used)* Review sprint board state at `kanban/sprint-run/`
  - Count cards in each status (DEVELOPING, VALIDATING, DONE)
  - Note blockers or stuck cards
  - Calculate first-pass rate: (cards with validation_attempts=1) / (total cards) × 100%
  - If `kanban/sprint-run/` does not exist, skip this section — retro runs on interviews + JSONL alone
- [ ] Check `kanban/retrospective-actions/` for any prior action cards (context for this retro)

**3B: JSONL Transcript Mining** (grep-level analysis)
*Locate session JSONL file at:* `~/.claude/projects/<sanitized-project-path>/<session-id>.jsonl` (e.g. `-Users-Chris-Weber-OpenSource-SAME_PAGE_PREVIEW` or `-Users-Chris-Weber-OpenSource-DRUPAL`)

```bash
# Extract key metrics from JSONL timestamps
grep '"timestamp"' session-id.jsonl | head -1  # session start
grep '"timestamp"' session-id.jsonl | tail -1  # session end

# Count work activity (tool calls = active work)
grep -c '"tool":\|"_progress"' session-id.jsonl

# Count idle/wait periods (keywords indicate blocking)
grep -i 'wait\|queue\|block\|unavailable' session-id.jsonl | wc -l

# Test results (count pass/fail patterns)
grep -c 'pass\|fail' session-id.jsonl

# Agent interactions (message frequency = collaboration signals)
grep -c '"type".*"message"\|"recipient"' session-id.jsonl
```

**3C: Metrics Calculation** (see `references/metrics-baseline.md` for details)
- [ ] **First-pass rate**: (Passed round 1) / (Total) × 100%
- [ ] **Agent utilization**: (Active minutes) / (Total minutes) × 100%
- [ ] **Idle ratio**: (Waiting minutes) / (Total minutes) × 100%
- [ ] **Quality gates pass %**: (All gates pass round 1) / (Total) × 100%
- [ ] **Code regression rate**: (Regressions found) / (Total issues) × 100%

**3D: Cross-Session Comparison**
- [ ] Compare to baseline metrics in MEMORY.md from previous session
- [ ] Identify improving vs. degrading trends
- [ ] Note which metrics met targets, which need improvement

### Phase 3.5: User Interview (5 min)

**This phase is mandatory. The user holds strategic context that agents and data analysis cannot provide.**

Use `AskUserQuestion` to interview the user with three questions grounded in the KEEP/IMPROVE/LEARN pillars. Populate suggested options from session data gathered in Phases 2-3.

```
AskUserQuestion with 3 questions, all with multiSelect: true:

Q1 (KEEP):    "What went well this session that we should keep doing?"
  multiSelect: true
  Options: [2-4 options drawn from session data, e.g., agent findings, metrics wins]

Q2 (IMPROVE): "What can be improved for next session?"
  multiSelect: true
  Options: [2-4 options drawn from blockers, friction points, metric misses]

Q3 (LEARN):   "What did you observe that needs further discussion before acting on?"
  multiSelect: true
  Options: [2-4 options drawn from open questions, new patterns, unresolved findings]
```

**Guidelines:**
- All three questions use `multiSelect: true` — user may identify multiple things worth keeping, improving, or discussing
- Options should be specific, drawn from this session's data — not generic
- User can always select "Other" for free-form input
- User responses override or supplement agent feedback — they have strategic context
- Capture all selected responses for the report
- If user feedback contradicts agent feedback or proposed action cards, the user's direction wins

### Phase 4: Code Knowledge Capture (5 min)
**What technical insights did the team discover?**
- [ ] Architectural patterns discovered (entity APIs, caching patterns, etc.)
- [ ] Tricky Drupal APIs or modules and why they were confusing
- [ ] Reusable test patterns that should be documented
- [ ] Non-obvious file/module relationships or dependencies
- [ ] Bugs or quirks found in the codebase
- [ ] Document 3-5 technical learnings for MEMORY.md

### Phase 5: Report Generation (5 min)

Generate comprehensive retrospective report (40-60 lines, see `references/report-structure.md` for template):

**Report Sections:**
1. **Executive Summary** — Session dates, team size, scope, quality gates %, first-pass rate
2. **What Worked Well** — 3-4 successes with evidence
3. **What Didn't Work** — 3-4 blockers with root causes
4. **Code Knowledge Learned** — 3-4 technical insights from Phase 4
5. **Start/Stop Recommendations** — 3 START + 3 STOP from agent feedback
6. **Action Items** — Immediate, Next sprint, Future
7. **Memory Updates** — Baselines, code learnings, trends

**Synthesis rules:**
- Cite agent feedback verbatim where possible
- Include JSONL evidence and metrics from Phase 3
- Cross-reference findings to sources (JSONL, agents, kanban, code inspection)

**Deliverable:** Markdown report saved to `analysis-reports/retro-session/<YYYY-MM-DD>+<sprint-name>/SESSION-RETROSPECTIVE.md`

### Phase 6: Action Card Generation (5 min)

Convert findings from the report into action cards. Read `retro:kanban` for the full mechanics.

**6A: Categorize findings (KEEP/IMPROVE/LEARN)**
- **KEEP DOING** — Pattern that worked well; minimum evidence: 2+ independent sources
- **IMPROVE** — Blocker or inefficiency; minimum evidence: 1 major issue or 2+ minor issues
- **LEARN** — Technical insight; minimum evidence: 1+ occurrences (code knowledge always qualifies)

**6B: Assign targets** — see `references/feedback-targets.md`

**6C: Calculate source weight** — Critical (4+ sources) | High (2–3) | Medium (1)

**6D: Write cards to `kanban/retrospective-actions/1_backlog/`**
- Use template: `references/action-card-template.md`
- Card ID format: `retro-YYYYMMDD-NNN`
- Review and refine each finding before writing (merge near-duplicates, sharpen recommendations)

**6E: Run scrum (dedup pass)** — see `retro:kanban` for the dedup procedure

### Phase 7: Review Proposed Action Cards with User (5–10 min)

**This phase is mandatory. Do not skip it.**

Read `retro:kanban` for the full user review flow. Summary:

- Present each card via `AskUserQuestion` with markdown preview (max 4 per call)
- Options per card: Approve → `approved/` | Reject → delete (log rationale) | Modify → edit then `approved/`
- User may identify missing cards — create them directly in `approved/`
- Append rejection/modification rationale to the retro report (institutional memory)

**Why this phase exists:** The retro generates cards from automated analysis. Only the user holds strategic context (e.g., "we're removing jQuery — don't invest in it"). Without this review, action cards can work against the team's direction.

---

**For agent interview templates, see:** `retro:interviews` (interview-templates.md)

---

## Minimal Quality Criteria

A good retrospective:
- Collects feedback from ≥2 agent types
- Identifies what worked, what didn't, and why
- Generates actionable start/stop recommendations

---

## Tips for Better Retrospectives

1. **Plan timing** - Schedule retrospective BEFORE final agent shutdown
2. **Ask, don't tell** - Interview agents; capture their observations, not your interpretation
3. **Quote agents verbatim** - Exact feedback is more powerful than paraphrasing
4. **Compare to baseline** - Reference previous session metrics in MEMORY.md
5. **Be specific** - "Start Phase 0 pre-check in validate-patch" not "improve testing"
6. **Assign owners** - Who implements each start/stop recommendation?
7. **Publish learnings** - Update MEMORY.md so next session builds on this one
8. **Code knowledge matters** - Document architectural patterns, tricky APIs, test patterns

---

## Integration Points

**Before Invoking:**
- All work is complete
- Confirm agent availability (Phase 0 handles this)
- Session context fresh in team's memory

**After Report:**
- Update MEMORY.md immediately with:
  - This session's metrics (first-pass %, utilization %, key insights)
  - Code learnings (architectural discoveries, tricky APIs, test patterns)
  - Process improvements (what we start/stop)
  - Trend analysis (compare to previous session baseline)
- Share action items with team
- Assign owners to start/stop implementation items
- Set targets for next session (e.g., "80% first-pass rate")

**For Next Session:**
- Read MEMORY.md baseline from previous session
- Target improvements identified in start/stop recommendations
- Measure if changes had impact on metrics
- Review code knowledge themes to deepen learnings

---

## Cross-References & Reference Files

**Related Skills:**
- **retro:interviews** — Agent shutdown interview process and templates
- **retro:kanban** — Retrospective-actions board mechanics: card creation, scrum, user review
- **sprint:run** — Kanban pipeline context and team coordination
- **process-lifecycle** — DDEV instance management and resource cleanup
- **validate-patch** — Quality gate definitions and pass/fail criteria

**Reference Files (in this skill's `references/` directory):**
- **feedback-targets.md** — Route action cards to specific targets (memory, claude-md, agent, skill, protocol, standard, future)
- **report-structure.md** — Consistent retrospective report template for cross-session comparison
- **metrics-baseline.md** — 5 key metrics and JSONL mining patterns for extraction
- **action-card-template.md** — Card format and frontmatter (12 interview questions in `retro:interviews` interview-templates.md)

**Related Documentation:**
- **decision-framework.md** — Autonomous vs. escalate decision boundaries
- **token-tracking.md** — Proxy metrics methodology (agent-minutes, message count)
- **MEMORY.md** — Session baselines and evolving metrics for comparison
- **DDEV-CLEANUP.md** — Resource management protocol (cleanup procedures)
- **CLAUDE.md** — Development practices updated by approved action cards

**Kanban Locations:**
- **`kanban/sprint-run/`** — Drupal core issue work pipeline
- **`kanban/retrospective-actions/`** — Process improvement action cards (`retro:kanban`)
