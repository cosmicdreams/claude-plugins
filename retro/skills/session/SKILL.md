---
name: session
description: Runs a structured end-of-sprint retrospective that reads results.json (structured interviews), summarizes transcripts, interviews the user, and generates a report with actionable improvement cards. Invoke when the user says "run retrospective", "session review", "what worked and what didn't", "capture learnings", or "end of sprint review". Also invoke after sprint:run completes. Do not invoke mid-sprint while agents are still active, for individual issue reviews, or for status checks — those are not retrospectives.
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# Session Retrospective

Read structured sprint results, summarize transcripts, interview the user, generate a report, and create action cards.

**Input:** `analysis-reports/retro-session/<YYYY-MM-DD>+<sprint>/results.json` (written by sprint:run)
**Output:** `analysis-reports/retro-session/<YYYY-MM-DD>+<sprint>/SESSION-RETROSPECTIVE.md` + retro board cards

---

## Phase 0: Pre-Check

```bash
ls analysis-reports/retro-session/
# Identify the most recent <date>+<sprint> directory
cat analysis-reports/retro-session/<date>+<sprint>/results.json | jq '.results | length'
```

If results.json is absent, note the gap and proceed with transcript-only analysis.

---

## Phase 1: Read Structured Results

```bash
cat analysis-reports/retro-session/<date>+<sprint>/results.json | jq '{
  outcomes: [.results[].outcome],
  retro_interviews: [.results[].retro_interview],
  reviews: [.reviews[].retro_interview]
}'
```

Extract:
- All `retro_interview.what_worked` → KEEP candidates
- All `retro_interview.one_change` → IMPROVE candidates (cross-role convergence = high priority)
- All `retro_interview.technical_insight`, `key_decision`, and `cross_issue_pattern` → LEARN candidates
- Cross-reviewer `failure_root_cause` + `handoff_quality` → IMPROVE signals
- Any `outcome: "escalated"` or `outcome: "failed"` beads → flag as process gaps

---

## Phase 2: Transcript Summary

Locate session JSONL:

```bash
ls -lt ~/.claude/projects/<project-slug>/*.jsonl | head -3
```

When headroom is present, compress before summarizing (reversible mode):

```bash
command -v headroom >/dev/null \
  && headroom wrap "summarize_transcript.py --file <path> --focus all" \
  || python3 retro/skills/transcript/scripts/summarize_transcript.py --file <path> --focus all
```

Otherwise use the transcript skill's summarize script directly. Extract:
- Session duration and tool call count
- Error and retry patterns
- Agent utilization signals

---

## Phase 3: Metrics

Computed from structured results — no JSONL grep required.

**First-pass rate**: beads with `outcome: "completed"` and cross-review `verdict: "approved"` (or no review required) / total beads × 100%

**Quality gate pass %**: beads where all of phpcs, phpstan, phpunit are "clean"/"passing" or "skipped" / total × 100%

**Code regression rate**: cross-reviewer `failure_root_cause: "CODE_REGRESSION"` count / total reviewed × 100%

Kanban board analysis (if sprint:run was used):

```bash
bd list -l board-sprint --json | jq 'group_by(.status)'
bd blocked
```

Cross-session comparison: read `.claude/memory/MEMORY.md` for previous session baselines.

---

## Phase 3.5: User Interview

**Mandatory.** The user holds strategic context agents cannot provide.

Use `AskUserQuestion` with three questions drawn from session data:

```
Q1 (KEEP):    "What went well this session that we should keep doing?"
  multiSelect: true
  Options: [2-4 options from what_worked fields and metrics wins]

Q2 (IMPROVE): "What can be improved for next session?"
  multiSelect: true
  Options: [2-4 options from one_change fields, blockers, metric misses]

Q3 (LEARN):   "What needs further discussion before acting on?"
  multiSelect: true
  Options: [2-4 options from key_decision fields, open questions, new patterns]
```

User responses override agent feedback when they conflict.

---

## Phase 4: Technical Knowledge Capture

From `technical_insight`, `key_decision`, and `cross_issue_pattern` fields:
- Architectural patterns discovered
- Tricky APIs or modules and why they were confusing
- Reusable test patterns
- Non-obvious file/module relationships
- Bugs or quirks found in the codebase

Document 3-5 technical learnings for MEMORY.md update.

---

## Phase 5: Report Generation

Write to `analysis-reports/retro-session/<date>+<sprint>/SESSION-RETROSPECTIVE.md`. See `references/report-structure.md` for template.

Sections:
1. **Executive Summary** — dates, bead count, first-pass rate, quality gates %
2. **What Worked Well** — 3-4 successes with evidence (cite `what_worked` fields verbatim)
3. **What Didn't Work** — 3-4 blockers with root causes
4. **Technical Knowledge** — 3-4 insights from Phase 4
5. **Start/Stop Recommendations** — from `one_change` fields, cross-role convergence first
6. **Action Items** — Immediate / Next sprint / Future
7. **Memory Updates** — baselines, code learnings, trends

Cite agent fields verbatim where possible.

---

## Phase 6: Action Card Generation

Read `retro:kanban` for full mechanics. Summary:

**Categorize (KEEP/IMPROVE/LEARN):**
- KEEP: minimum 2+ independent sources naming the same thing
- IMPROVE: minimum 1 major issue or 2+ minor issues
- LEARN: minimum 1 occurrence (technical knowledge always qualifies)

**Source weight:** Critical (4+ sources) | High (2-3) | Medium (1)

**Create cards:**

```bash
bd create "Card title" \
  --prefix retro \
  -p 1 -t task \
  --labels "board-retro,lane-backlog,target-skill,cat-improve,effort-m,session-<date>" \
  --description "$(cat <<'EOF'
## Finding
[1-2 sentences]

## Sources
- [agent/field]: [observation]

## Recommendation
[What to do]

## Effort
[S/M/L]

## Priority
[Critical/High/Medium/Low]
EOF
)"
```

Run dedup pass before presenting cards — see `retro:kanban` scrum procedure.

---

## Phase 7: User Review of Action Cards

**Mandatory.** Read `retro:kanban` for the full user review flow.

- Present each card via `AskUserQuestion` (max 4 per call)
- Options: Approve → move to `lane-approved` | Reject → `bd close` | Modify → update then approve
- User may add missing cards directly with `lane-approved` label
- Append rejection/modification rationale to the report

---

## Obsidian Storage

After saving the report locally, archive to the Neurons vault.

```bash
if [ -n "$OFFICE_PROJECT_NAME" ]; then
  PROJECT_SLUG=$(echo "$OFFICE_PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')
else
  PROJECT_SLUG=$(bd list -l board-sprint --json 2>/dev/null | jq -r '.[0].metadata.project // empty' | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')
fi
# If still unset: ask via AskUserQuestion — "What project is this retrospective for?"

SPRINT_SLUG="<sprint-slug>"
DATE=$(date +%Y-%m-%d)
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
VAULT_PATH="Retrospectives/${DATE}+${PROJECT_SLUG}+${SPRINT_SLUG}/SESSION-RETROSPECTIVE.md"
mkdir -p "$VAULT_ROOT/$(dirname "$VAULT_PATH")"
```

Vault frontmatter:

```yaml
---
project: <project-slug>
sprint: <sprint-slug>
date: <YYYY-MM-DD>
tags: [retro, sprint]
---
```

---

## Minimal Quality Criteria

A good retrospective:
- Reads results.json from sprint:run (or notes absence as a process gap)
- Collects user input via Phase 3.5
- Identifies what worked, what didn't, and why
- Generates actionable improvement cards approved by the user

---

## Cross-References

- **retro:interviews** — Schema reference for interview fields
- **retro:kanban** — Retrospective-actions board: card creation, scrum, user review
- **retro:transcript** — Diagnostic transcript reader for deeper agent session analysis
- **sprint:run** — Writes results.json consumed by this skill
- **references/report-structure.md** — Report template
- **references/metrics-baseline.md** — Metric definitions
- **references/feedback-targets.md** — Action card target routing
