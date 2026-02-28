---
name: retro-interviews
description: NOT FOR MANUAL INVOCATION. Fires automatically via the SubagentStop hook as each agent exits. Read only when building or debugging the shutdown interview process, or when running a manual interview as a fallback because the hook is not active.
triggers:
  - "verify interview coverage"
  - "interview templates"
  - "manual agent interview"
  - "hook not capturing interviews"
doNotUse: "as a replacement for the SubagentStop hook — automated capture is the primary path"
---

# Retro Interviews Skill

Documents the agent shutdown interview lifecycle. The primary path is fully automated: the `subagent-stop-interview.sh` SubagentStop hook captures every sprint agent's interview during graceful shutdown. This skill is the reference for understanding that process, accessing templates, and falling back to manual collection.

**Fires:** Automatically at each agent's graceful shutdown (via SubagentStop hook)
**Output:** `analysis-reports/retro-session/<YYYY-MM-DD>+<sprint-name>/interviews/<agent-type>.md`
**Read by:** `/sprint:retro-session` Phase 2

---

## How Interviews Are Collected (Automated Path)

The `subagent-stop-interview.sh` SubagentStop hook intercepts every sprint agent's shutdown automatically:

1. Agent approves a `shutdown_request`
2. Hook intercepts — blocks stop and injects interview questions into agent's context
3. Agent answers the questions (round 2 of stop cycle)
4. Hook captures the response and writes it to `analysis-reports/retro-session/<sprint-name>/interviews/<agent-type>.md`
5. Agent exits

No manual action required from team-lead. Just trigger graceful shutdown as normal.

**Sprint folder naming:** `<YYYY-MM-DD>+<sprint-name>` — date provides real-world context and uniqueness; sprint name comes from the team config. Example: `2026-02-21+my-project-sprint-1`.

---

## Manual Collection (Fallback When Hook Is Inactive)

If the hook is not active, manually collect interviews before each agent shutdown:

1. Send the agent their 3 common questions + 3 role-specific questions (see templates below)
2. Save their response verbatim to `analysis-reports/retro-session/<sprint-name>/interviews/<agent-type>.md`
3. Then send `shutdown_request`

---

## Verifying Coverage

After all agents are shut down:

```bash
ls analysis-reports/retro-session/<YYYY-MM-DD>+<sprint-name>/interviews/
```

Expected: one `.md` file per agent type that was active during the sprint.

If files are missing: note the gap. `/sprint:retro-session` can still proceed with partial coverage — it will flag the missing files as a process gap in the report.

---

## Interview Templates

Full question sets are in `interview-templates.md` (this skill's directory).

All agents answer **3 common questions** (C1–C3) + **3 role-specific questions**:

| Role | Questions |
|------|-----------|
| implementer | C1, C2, C3 + D1 (decisions/confidence), D2 (cross-issue patterns), D3 (workflow friction) |
| reviewer | C1, C2, C3 + V1 (failure root causes), V2 (blind spots/handoff), V3 (infra friction) |
| process-improvement | C1, C2, C3 + P1 (pipeline flow), P2 (interaction patterns), P3 (root causes) |

**Signal mapping:**

| Question | Primary Signal |
|----------|---------------|
| C1 (Success) | KEEP |
| C2 (Technical insight) | LEARN |
| C3 (Process change) | IMPROVE |
| D1, D2 | LEARN |
| D3, V1, V2, V3 | IMPROVE |
| P1, P2, P3 | IMPROVE / KEEP / LEARN |

---

## Process Improvement Agent: Self-Guided Interview

The `process-improvement` agent has its interview questions embedded in its own definition (`agents/process-improvement.md`). It self-guides through the shutdown interview using the same C1/C2/C3/P1/P2/P3 framework. The hook still intercepts and captures the output.

---

## Integration with Session-Retrospective

After interviews are collected, `/sprint:retro-session` Phase 2 reads them from `analysis-reports/retro-session/<sprint-name>/interviews/`. There is no agent availability dependency — the retro can run hours or days after the sprint ends.

**Cross-references:**
- **Interview templates:** `interview-templates.md` (this skill's directory)
- **Reads results:** `sprint:retro-session` Phase 2
- **Hook source:** `../hooks/subagent-stop-interview.sh`
