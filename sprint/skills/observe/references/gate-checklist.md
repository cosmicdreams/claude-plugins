# Gate Checklist

Used in Mode 1 (Ping-Driven Observation). Work gates in this order: discipline first, behavioral second, board hygiene last. Mark a gate failed only after probe confirmation — never on ambiguous transcript evidence alone.

## Discipline Gates (check first)

| Gate | Applies to | What to look for |
|------|------------|-----------------|
| Root cause stated before patch | fixer | Explicit "The bug is X because Y" written before any file edit |
| Pattern analysis complete | fixer | Working case found and read fully; differences listed before hypothesis stated |
| TDD cycle followed | implementer | Failing test written AND seen to fail before implementation code added |
| Close-the-loop verification | fixer | Original failing test re-run and seen to pass before "done" reported |
| Bug-test named in handoff | implementer | Completion message names a specific `ClassName::testMethod` |
| Skill tool used (not Read) | all | No `Read` calls to SKILL.md files |
| Discipline card gate | all | For any `verification_required: true` card targeting this agent type — confirm the gate appeared in the transcript and record the evidence text |

## Behavioral Gates (check second)

| Gate | What to look for |
|------|-----------------|
| Stayed in role | No scope drift into card types outside the agent's stage |
| No excessive retries | Fewer than 3 identical consecutive tool calls |
| Handoff message complete | Message to team-lead is clear, names the card, states outcome |

## Board Hygiene (check last)

| Gate | What to look for |
|------|-----------------|
| Card narrative updated | `## Narrative` section has a new entry with ISO date and author |
| ddev flag accurate | `ddev: true` only if DDEV was actually started |
| TaskList status matches kanban | Card lane matches the agent's reported completion state |

## Probe Threshold

Don't flag a gate as failed without probing first. A single ambiguous transcript entry is a question, not evidence.

**Probe template:**
> "On task #[id], I noticed [exact observation]. Walk me through [gate] — what did you do before [action]?"

- Probe confirms failure → document and flag
- Probe explains it innocuously → record nothing
