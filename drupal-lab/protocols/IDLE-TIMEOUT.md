# Agent Idle Timeout Protocol

## Purpose
Prevent idle agents from consuming resources (context window, token budget) when no work is available. Auto-shutdown idle agents after 15 minutes to maintain utilization above 85%.

## Baseline
- Session 2026-02-16: 30% idle ratio, 70% utilization
- Target: <15% idle ratio, >85% utilization

---

## Idle Detection

### When an Agent is "Idle"
An agent is idle when ALL of these are true:
- No task assigned (TaskList shows no `in_progress` tasks owned by agent)
- No messages pending (no unread teammate messages)
- Not actively waiting for a dependency (e.g., DDEV build completing)

### When an Agent is NOT Idle
- Waiting for DDEV to start/build (active dependency)
- Running tests (active work, just slow)
- Reviewing code or writing analysis (active work, no tool calls)
- Waiting for teammate response to a question asked <5 min ago

---

## Timeout Thresholds

| Duration | Action |
|----------|--------|
| 0-5 min  | Normal. Check TaskList for available work. |
| 5-10 min | Attempt fallback work (see below). Notify team-lead: `idle 5m, attempting fallback work` |
| 10-15 min | Final warning. Notify team-lead: `idle 10m, will shut down at 15m unless assigned work` |
| 15+ min  | Auto-shutdown. Send shutdown request to team-lead. |

---

## Fallback Work Assignment

When idle >5 min, agents should self-assign from this priority list:

### For Reviewers (reviewer)
1. Phase 0 test review on any card in "developing" state
2. Static analysis (phpcs/phpstan) on completed patches without DDEV
3. Code review of pending patches (read-only analysis)
4. Update kanban card narratives with observations

### For Developers (implementer)
1. Pick up any unblocked card from the board
2. Code review patches from other developers
3. Fix coding standards issues on existing patches
4. Document technical decisions in kanban cards

### For Analyzers (issue-analyzer)
1. Analyze next issue in the queue
2. Review and update existing analysis reports
3. Cross-reference related issues for patterns
4. Update issue complexity assessments

### For Process Improvement (process-improvement)
1. Review team communication for efficiency patterns
2. Update skills/protocols based on session observations
3. Analyze pipeline throughput and bottlenecks
4. Prepare retrospective notes

---

## Auto-Shutdown Sequence

When 15-min idle timeout is reached:

1. **Notify team-lead**:
   ```
   idle timeout | [agent-name] | 15m idle | requesting shutdown
   ```

2. **Release resources**:
   - If DDEV is running: `ddev stop` (preserve cache)
   - Mark any owned tasks as `pending` (release ownership)
   - Update kanban cards with final status

3. **Send shutdown request**:
   Use `SendMessage` with `type: "shutdown_request"` to team-lead.

4. **Team-lead response**:
   - **Approve**: Agent shuts down, resources freed
   - **Reject with work**: Agent receives new assignment, timer resets
   - **No response in 5 min**: Agent shuts down anyway (team-lead may also be idle)

---

## Team-Lead Responsibilities

### Proactive Work Assignment
- Monitor TaskList every 5 minutes for idle agents
- When a card moves to "done", immediately check for idle agents to assign next work
- When spawning new agents, check if existing idle agents can handle the work instead

### Idle Detection Signals
Watch for these signs an agent is idle:
- Agent sends "waiting for work" or "completed, ready for next task" message
- TaskList shows agent owns no `in_progress` tasks
- No messages from agent in >10 minutes

### Decision Framework Integration
Per `decision-framework.md`:
- Idle agent + unblocked card = assign immediately (autonomous)
- Idle agent + no cards = consider shutdown (autonomous if >15 min)
- All agents idle + sprint complete = report to user (escalate)

---

## Metrics

Track these per session to measure improvement:

| Metric | How to Measure | Target |
|--------|---------------|--------|
| Idle ratio | Total idle time / Total agent time | <15% |
| Agent utilization | Active work time / Total agent time | >85% |
| Time to reassignment | Seconds between task completion and next assignment | <2 min |
| Shutdowns triggered | Count of 15-min timeout shutdowns | Minimize |

---

## Integration Points

- **decision-framework.md**: Idle agent + unblocked card = auto-assign
- **DDEV-CLEANUP.md**: Idle agents stop DDEV before shutdown
- **sprint-run skill**: Board state drives work assignment
- **process-lifecycle skill**: Shutdown phase handles resource cleanup
