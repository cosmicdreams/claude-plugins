# Token Tracking Guide

## Purpose
Track token consumption per session and per agent to establish efficiency baselines and identify optimization opportunities.

## Baseline (Session 2026-02-16)
- Token tracking: NOT IMPLEMENTED (no data)
- Session duration: ~400 minutes
- Issues completed: 7
- Agents spawned: 10 + 1 lead
- Target: Establish baseline in next session

---

## Session Start: Capture Baseline

At the START of every team sprint session, the team-lead should record:

```markdown
## Token Tracking Log

**Session**: [date]
**Start time**: [timestamp]
**Agents planned**: [count]

### Agent Spawn Log
| Agent | Spawned At | Role | Notes |
|-------|-----------|------|-------|
| team-lead | HH:MM | coordinator | session start |
```

Save this to: `analysis-reports/token-log-[date].md`

### What to Track

Since Claude Code does not expose raw token counts to agents, we track proxy metrics:

| Metric | How to Capture | Why It Matters |
|--------|---------------|----------------|
| Agent count | Count spawned agents | More agents = more tokens |
| Agent lifetime | Start time to shutdown time | Longer = more tokens |
| Messages sent | Count SendMessage calls | Each message = token cost |
| Tool calls | Count tool invocations | Tools drive token usage |
| Issues per agent | Tasks completed per agent | Efficiency indicator |
| Rework cycles | Fix-loop count per issue | Rework = wasted tokens |

---

## During Session: Per-Agent Logging

When each agent is spawned, log:

```markdown
### [agent-name]
- **Spawned**: HH:MM
- **Role**: [developer/validator/analyzer/process-improvement]
- **Assigned issues**: [list]
- **Messages sent**: [count, update at end]
- **Tool calls**: [estimate]
- **Rework cycles**: [count]
- **Shutdown**: HH:MM
- **Lifetime**: [minutes]
```

### Lightweight Tracking (Minimum Viable)

If full logging is too expensive, track only these three per agent:
1. **Spawn time**
2. **Shutdown time**
3. **Issues completed**

This gives: agent-minutes per issue (proxy for token efficiency).

---

## Session End: Efficiency Analysis

Calculate these metrics at retrospective time:

### Session-Level
```
Total agent-minutes:     [sum of all agent lifetimes]
Issues completed:        [count]
Agent-minutes per issue: [total / issues]
Active agents (peak):    [max concurrent]
Rework ratio:            [rework cycles / total validations]
```

### Agent-Level Efficiency
```
| Agent | Lifetime | Issues | Min/Issue | Rework | Idle |
|-------|----------|--------|-----------|--------|------|
| dev-1 | 120m     | 2      | 60m       | 1      | 15m  |
| val-1 | 90m      | 3      | 30m       | 0      | 5m   |
```

### Trend Tracking (Cross-Session)
```
| Session | Agent-Min/Issue | First-Pass % | Agents | Issues |
|---------|----------------|--------------|--------|--------|
| 2026-02-16 | [NOT TRACKED] | 56% | 11 | 7 |
| [next]  | [fill in]      | [fill in]    | [count]| [count]|
```

---

## Optimization Signals

Use these patterns to identify token waste:

| Signal | Indicates | Action |
|--------|-----------|--------|
| Agent-minutes/issue > 60 | Complexity or blockers | Profile issue difficulty upfront |
| Rework ratio > 20% | Test design or code quality issues | Strengthen Phase 0 review |
| Peak agents > issues | Over-provisioning | Reduce team size |
| Idle time > 15% | Under-utilization | Apply idle timeout protocol |
| Messages/issue > 20 | Communication overhead | Streamline comms protocol |

---

## Integration

- **retro-session skill**: Token analysis section uses this data
- **MEMORY.md**: Store session baselines for cross-session comparison
- **idle-timeout protocol**: High idle time signals token waste
- **decision-framework.md**: Resource allocation decisions informed by efficiency data
