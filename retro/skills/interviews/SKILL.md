---
name: interviews
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
**Read by:** `/retro:session` Phase 2

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

If files are missing: note the gap. `/retro:session` can still proceed with partial coverage — it will flag the missing files as a process gap in the report.

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

After interviews are collected, `/retro:session` Phase 2 reads them from `analysis-reports/retro-session/<sprint-name>/interviews/`. There is no agent availability dependency — the retro can run hours or days after the sprint ends.

**Cross-references:**
- **Interview templates:** `interview-templates.md` (this skill's directory)
- **Reads results:** `retro:session` Phase 2
- **Hook source:** `../hooks/subagent-stop-interview.sh`

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
