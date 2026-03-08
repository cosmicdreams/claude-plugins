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

---

## Obsidian Storage

After each interview file is saved to `analysis-reports/`, archive it to the Neurons vault. This step is **optional and additive** — if Obsidian is not running, skip silently.

### Project Slug Resolution

Resolve the project slug in this order:

1. **Environment variable** — if `$OFFICE_PROJECT_NAME` is set, slugify and use it
2. **Kanban frontmatter** — scan `kanban/sprint-run/` card files for a `project:` field; use the first value found
3. **Ask the user** — if neither source yields a value, ask once: *"What project is this retrospective for?"* and use their answer as the slug

**Slugify rule:** lowercase, spaces → hyphens, remove all special characters except hyphens.
Example: `"Same Page Preview"` → `same-page-preview`

Resolve the project slug once per sprint (not once per agent). If collecting interviews across multiple agents in the same sprint, reuse the resolved slug.

### Sprint Slug

Derived from the sprint folder name already established (the `<sprint-name>` segment of `analysis-reports/retro-session/<YYYY-MM-DD>+<sprint-name>/`). Slugify the same way.

### Storage Script (per agent interview)

```bash
# Health check — non-blocking
obsidian help || { echo "Vault storage skipped (Obsidian not running)"; exit 0; }

# Resolve project slug (run once per sprint, reuse across agents)
if [ -n "$OFFICE_PROJECT_NAME" ]; then
  PROJECT_SLUG=$(echo "$OFFICE_PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')
else
  PROJECT_SLUG=$(grep -r '^project:' kanban/sprint-run/ 2>/dev/null | head -1 | sed 's/.*project: *//' | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')
fi

# If still unset, ask the user (done interactively — not in this script block)
# USER_INPUT captured via AskUserQuestion: "What project is this retrospective for?"
# PROJECT_SLUG=$(echo "$USER_INPUT" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')

SPRINT_SLUG="<sprint-slug-from-session>"  # e.g. sprint-1, jquery-fixes
AGENT_ROLE="<agent-role>"                 # e.g. implementer, reviewer, process-improvement
DATE=$(date +%Y-%m-%d)
VAULT_PATH="Retrospectives/${DATE}+${PROJECT_SLUG}+${SPRINT_SLUG}/interviews/${AGENT_ROLE}.md"

obsidian create \
  --vault=Neurons \
  --path="$VAULT_PATH" \
  --content="<interview-file-content>"
```

### Vault Document Format

Each interview file stored at `Retrospectives/<YYYY-MM-DD>+<project-slug>+<sprint-slug>/interviews/<agent-role>.md` must begin with this YAML frontmatter block:

```yaml
---
project: <project-slug>
sprint: <sprint-slug>
agent_role: <agent-role>
date: <YYYY-MM-DD>
tags: [retro, interview]
---
```

The frontmatter `project:` field enables cross-project Obsidian queries:
- `tag:interview` — see all agent interviews across all projects
- `project: same-page-preview` — see one project's agent interview history
- `agent_role: implementer` — see all implementer interviews across all projects and sprints

**Project isolation guarantee:** Because `project-slug` is embedded in both the vault path and the `project:` frontmatter field, interviews for Project A will never surface as context for Project B in a filtered query.
