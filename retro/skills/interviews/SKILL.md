---
name: interviews
description: Retro interview standard for sprint agents. Use when an agent receives a "Shutdown imminent" message from team-lead, when manually triggering agent self-documentation before shutdown, or when verifying interview coverage after a sprint. Agents follow this skill to write their own interview file before confirming shutdown readiness to team-lead.
triggers:
  - "shutdown imminent"
  - "verify interview coverage"
  - "interview templates"
  - "retro interview"
  - "write my interview"
---

# Retro Interviews Skill

Each sprint agent writes their own retro interview before shutting down. Team-lead sends a "Shutdown imminent" message, the agent follows this skill to self-document, then pings team-lead ready. Team-lead then sends `shutdown_request`.

**Output:** `analysis-reports/retro-session/<YYYY-MM-DD>+<sprint-name>/interviews/<your-role>.md`
**Read by:** `retro:session` Phase 2

---

## Agent Self-Documentation (Primary Path)

When you receive a "Shutdown imminent" message from team-lead:

### Step 1: Determine your role and question set

| Your role | Questions to answer |
|-----------|-------------------|
| implementer | C1, C2, C3, D1, D2, D3 |
| qa-validator / reviewer | C1, C2, C3, V1, V2, V3 |
| process-improvement | C1, C2, C3, P1, P2, P3 |
| team-lead | C1, C2, C3, TL1, TL2, TL3 |
| any other role | C1, C2, C3 |

### Step 2: Determine the output path

```
analysis-reports/retro-session/<YYYY-MM-DD>+<sprint-name>/interviews/<your-role>.md
```

Use today's date and the sprint name from your task context. If no sprint name is available, use the project name or `unnamed-sprint`. Create the directory if it does not exist.

### Step 3: Write your interview file

Answer all 6 questions (3 common + 3 role-specific) using the formats in `interview-templates.md`. Answer from your session memory — you lived the session, you do not need to read your own transcript.

Use this file header:
```markdown
# Retro Interview — <your-role>
Sprint: <sprint-name>
Date: <YYYY-MM-DD>
Agent: <your-name>
```

### Step 4: Confirm to team-lead

After writing the file, reply:
```
Retro interview complete. Written to analysis-reports/retro-session/<path>/interviews/<role>.md. Ready to shut down.
```

---

## Standard Shutdown Imminent Message (Reference for Team-Lead)

Team-lead sends this before every `shutdown_request`:

```
Shutdown imminent. Before we close out:

1. Follow `retro:interviews` — answer your 6 questions (3 common + 3 role-specific for your role)
2. Write your interview to: analysis-reports/retro-session/<YYYY-MM-DD>+<sprint-name>/interviews/<your-role>.md
3. Reply when the file is written and you are ready to shut down.
```

Team-lead waits for the "ready to shut down" reply, then sends `shutdown_request`.

---

## Verifying Coverage

After all agents have shut down:

```bash
ls analysis-reports/retro-session/<YYYY-MM-DD>+<sprint-name>/interviews/
```

Expected: one `.md` file per agent type active during the sprint.

`retro:session` can proceed with partial coverage — it flags missing files as a process gap.

---

## Legacy Hook Path (Deprecated)

The `subagent-stop-interview.sh` SubagentStop hook was the original automated path. It is unreliable — `SubagentStop` fires at agent idle, not at actual shutdown, and `last_assistant_message` is often absent from the payload. The team-lead driven approach above replaces it as the primary path.

The hook remains in place as a last-resort fallback for sessions where team-lead fails to send the shutdown imminent message.

---

## Integration

- **Templates:** `interview-templates.md` (this skill's directory)
- **Reads results:** `retro:session` Phase 2
- **Sprint shutdown protocol:** CLAUDE.md Graceful Shutdown section
