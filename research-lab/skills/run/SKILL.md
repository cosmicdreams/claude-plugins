---
name: run
description: >
  Run a full research engagement: preflight audit, literary review via NotebookLM,
  multi-agent workshop swarm, cross-examination seminar, methodology authoring,
  iterative experimentation with ratchet optimization, and final report.
  Use when starting or resuming a research engagement. Say "run a research engagement",
  "research this topic end to end", "full research pipeline", or "research-lab:run".
  Not for standalone literary review (use research-lab:literary-review), standalone
  experiments (use research-lab:experiment), or quick brainstorming (use ideate:brainstorm).
triggers:
  - "run a research engagement"
  - "full research pipeline"
  - "research this end to end"
  - "start a research engagement"
  - "research-lab:run"
---

# Research Engagement Pipeline

Orchestrate a full research engagement from preflight through final report. You are the Principal Investigator (PI). Read `${CLAUDE_PLUGIN_ROOT}/agents/principal-investigator.md` for your role definition.

Read `${CLAUDE_PLUGIN_ROOT}/protocols/context-flow.md` for the engagement directory structure and file naming conventions.

---

## Phase 0 — Resume Detection

Check for an existing engagement directory:

```bash
ENGAGEMENT_DIR="analysis-reports/research/<engagement>"
ls "$ENGAGEMENT_DIR/" 2>/dev/null
```

If the directory exists, scan for completed phase outputs:
- `01-preflight.md` exists → skip to Phase 3
- `02-literary-review.md` exists → skip to Phase 4
- `03-workshop.md` exists → skip to Phase 5
- `04-seminar.md` exists → skip to Phase 6
- `05-methodology.md` exists → skip to Phase 7
- `results.jsonl` exists with keeps → skip to Phase 8

Report resume state to the user before proceeding.

---

## Phase 1 — Setup

### Golden Rule: Worktree = Branch

**Never modify code in any working directory named `main` or with the main branch checked out.**
All experiment work happens in a dedicated worktree. Create one now — not later.

1. Confirm with the user:
   - Engagement name (kebab-case, e.g., `pncb-cache-optimization`)
   - Research topic / optimization target
   - Any seed URLs or existing notebooks
   - Target project root (where the code lives, e.g., `~/Sites/AHRI`)

2. **Create a worktree in the target project** via `/create-worktree`:
```
Skill("admin:create-worktree", args="project=<target-project-root> name=<engagement-name>")
```
This creates `<target-project-root>/worktrees/<engagement-name>/` on its own branch.
The experimentalist commits changes here — never in `worktrees/main/`.

3. **Start DDEV in the new worktree** (not in main):
```bash
cd <target-project-root>/worktrees/<engagement-name>
ddev start
```
The worktree's DDEV URL becomes the target for preflight and measurement.

4. Create the engagement directory (in the orchestrating project, not the target):
```bash
mkdir -p "analysis-reports/research/<engagement>"
```

5. **No TeamCreate yet.** No subagents until Phase 3.

---

## Phase 2 — Preflight

Run the preflight script against the **worktree's DDEV URL** (never a remote site, never main):

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/preflight.sh <worktree-ddev-url> <pages>
```

Review the output. Write findings to `01-preflight.md`.

**Gate check** — read `${CLAUDE_PLUGIN_ROOT}/skills/run/references/phase-gates.md` (Phase 2 gate):
- If critical issues found → fix them before proceeding. Tell the user what needs fixing.
- If clean or only minor issues → proceed to Phase 3.

---

## Phase 3 — Literary Review

**Now create the team** — this is the first time subagents are needed.

```
TeamCreate(name="research-<engagement>")
```

Spawn a researcher agent in literary-review mode:

```
Agent(
  subagent_type="research-lab:researcher",
  name="researcher-lit",
  prompt="You are in literary-review mode.

  Follow the research-lab:literary-review skill protocol.

  Engagement directory: analysis-reports/research/<engagement>/
  Topic: <topic>
  Seed URLs: <urls>
  Focus: <focus>

  Write output to: analysis-reports/research/<engagement>/02-literary-review.md

  Report completion to the PI when done."
)
```

**Gate check** (Phase 3 gate): `02-literary-review.md` exists, has structured content, notebook ID recorded.

---

## Phase 4 — Workshop

Spawn N researcher agents (one per research facet):

Identify 3-5 facets from the literary review that need deeper investigation. For each facet:

```
Agent(
  subagent_type="research-lab:researcher",
  name="researcher-<N>",
  prompt="You are in workshop mode.

  Follow the research-lab:workshop skill protocol.

  Notebook ID: <notebook-id>
  Your facet: <specific-facet>
  Other researchers: <list-of-other-researcher-names-and-facets>
  Engagement directory: analysis-reports/research/<engagement>/

  Write your findings to: analysis-reports/research/<engagement>/03-workshop-<N>.md
  Share key discoveries with other researchers via SendMessage."
)
```

Spawn all researchers in parallel (multiple Agent calls in one message).

When all complete, synthesize their findings into `03-workshop.md`.

**Gate check** (Phase 4 gate): All `03-workshop-N.md` files exist, `03-workshop.md` synthesis written.

---

## Phase 5 — Seminar

Invoke the seminar skill to cross-examine the curated knowledge:

```
Skill("research-lab:seminar", args="notebook=<notebook-id> engagement=<engagement>")
```

Or run it inline: read `${CLAUDE_PLUGIN_ROOT}/skills/seminar/SKILL.md` and follow the protocol with:
- Leading questions derived from workshop findings and preflight results
- User context and constraints
- Contradictions or surprising findings from the workshop

Output: `04-seminar.md` with named concepts, decision table, and ranked hypotheses.

**Gate check** (Phase 5 gate): `04-seminar.md` exists with named concepts and ranked hypotheses.

---

## Phase 6 — Methodology

Write `05-methodology.md` using the template:

```bash
cat ${CLAUDE_PLUGIN_ROOT}/skills/run/references/methodology-template.md
```

Fill in the template based on:
- Preflight findings (what needs fixing)
- Literary review (known techniques)
- Workshop findings (deep insights per facet)
- Seminar output (named concepts, ranked hypotheses)

Confirm the methodology with the user before proceeding. This is the experiment's contract.

**Gate check** (Phase 6 gate): `05-methodology.md` exists, has all required sections per methodology-spec.md.

---

## Phase 7 — Experiment

Spawn an experimentalist agent:

```
Agent(
  subagent_type="research-lab:experimentalist",
  name="experimentalist-1",
  prompt="Follow the research-lab:experiment skill protocol.

  Methodology: analysis-reports/research/<engagement>/05-methodology.md
  Results log: analysis-reports/research/<engagement>/results.jsonl
  Working directory: <working-dir>
  Measurement harness: <path-to-measure-script>

  Read the methodology carefully before starting.
  Report each iteration result to the PI.
  Stop on futility threshold or target achievement."
)
```

Monitor iteration progress. If the experimentalist reports futility:
- Review the pattern of failures
- Consider revising the methodology (return to Phase 6)
- Or accept the best result and proceed to report

**Gate check** (Phase 7 gate): `results.jsonl` has at least one `keep` decision, or explicit user acceptance of current state.

---

## Phase 8 — Report

Check if `office:report` is available:

```bash
# Test if office:report skill exists
ls ~/.claude/plugins/cache/local/office/*/skills/report/SKILL.md 2>/dev/null
```

If available, invoke it with the research-lab template:
```
Skill("office:report", args="template=research engagement=<engagement>")
```

If not available, write the report inline. Read the template for structure:
```bash
cat ${CLAUDE_PLUGIN_ROOT}/templates/research-report.md
```

Write `07-report.md` to the engagement directory.

Generate charts if results.jsonl has data:
```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/generate-chart.py analysis-reports/research/<engagement>/results.jsonl
```

---

## Phase 9 — Cleanup

1. Archive the engagement report to Obsidian vault:
```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
DEST="Research/<engagement>/$(date +%Y-%m-%d)-report.md"
mkdir -p "$VAULT_ROOT/$(dirname "$DEST")"
cp "analysis-reports/research/<engagement>/07-report.md" "$VAULT_ROOT/$DEST"
```

2. Clean up the team:
```
TeamDelete(name="research-<engagement>")
```

3. Report to the user: engagement complete, where to find the report.
