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

## Hard Rules

1. **Delegate via Skill(), don't improvise.** When this skill says to invoke another skill, use `Skill()`. Do not read the other skill's SKILL.md and follow it inline — that bypasses usage tracking and misses protocol steps.
2. **Never modify `worktrees/main/`.** All code changes happen in a dedicated worktree created in Phase 1.
3. **The experiment loop controls termination.** You may not declare the engagement complete until the experiment loop terminates via: target achieved, budget exhausted, or futility threshold. No early exits based on "the baseline looks healthy."
4. **Always target local DDEV.** Never curl, measure, or audit a remote site (dev, staging, production). Every HTTP interaction targets the worktree's DDEV URL.

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

Confirm with the user:
- Engagement name (kebab-case, e.g., `ahri-cache-optimization`)
- Research topic / optimization target
- Any seed URLs or existing NotebookLM notebooks
- Target project root (e.g., `~/Sites/AHRI`)

### 1a. Create worktree

Invoke the create-worktree skill. Do not create the worktree manually.

```
Skill("admin:create-worktree", args="project=<target-project-root> name=<engagement-name>")
```

This creates `<target-project-root>/worktrees/<engagement-name>/` on its own branch.

### 1b. Bootstrap DDEV

Invoke the process-lifecycle skill for DDEV setup. Do not run `ddev start` directly — the skill handles `config.local.yaml` creation, naming, dependency installation, and ready checks.

```
Skill("drupal-lab:process-lifecycle", args="phase=init worktree=<target-project-root>/worktrees/<engagement-name>")
```

If the project has a custom bootstrap sequence (e.g., Site Studio's `cohesion:import` + `cohesion:rebuild`), the user will guide you through it. Ask: "Does this project need any special bootstrap steps beyond standard DDEV start + composer install?"

### 1c. Create engagement directory

In the orchestrating project (CLAUDE-PLUGINS), not the target:

```bash
mkdir -p "analysis-reports/research/<engagement>"
```

**No TeamCreate yet.** No subagents until Phase 3.

---

## Phase 2 — Preflight

### 2a. Discover content types

Before running the preflight script, discover all content types and sample one published page per type. This prevents testing only "easy" pages and missing entire uncacheable content types.

```bash
cd <worktree-path>
ddev drush sql:query "SELECT nfd.type, MIN(pa.alias) as alias FROM node_field_data nfd INNER JOIN path_alias pa ON CONCAT('/node/', nfd.nid) = pa.path WHERE nfd.status = 1 GROUP BY nfd.type ORDER BY nfd.type"
```

Add the homepage (`/`) to the list. This becomes the **page sample** used throughout the engagement.

### 2b. Run preflight

Run from inside the worktree directory (so DDEV drush commands work):

```bash
cd <worktree-path>
${CLAUDE_PLUGIN_ROOT}/scripts/preflight.sh <worktree-ddev-url> <all-sample-pages>
```

Write output to `01-preflight.md`. For each page, note:
- HTTP status code (replace 404s and redirects with valid pages for that content type)
- Dynamic Page Cache status
- `X-Drupal-Cache-Max-Age` (0 = uncacheable by Varnish/CDN, -1 = permanent)
- Session cookies (`Set-Cookie: SESS*`)

### 2c. Gate check

Read `${CLAUDE_PLUGIN_ROOT}/skills/run/references/phase-gates.md` (Phase 2 gate).

---

## Phase 3 — Literary Review

**Now create the team** — first time subagents are needed.

```
TeamCreate(name="research-<engagement>")
```

Spawn a researcher agent in literary-review mode. If an existing NotebookLM notebook is available, pass its ID — do not create a new notebook.

```
Agent(
  subagent_type="research-lab:researcher",
  name="researcher-lit",
  prompt="You are in literary-review mode.

  Follow the research-lab:literary-review skill protocol.

  Engagement directory: analysis-reports/research/<engagement>/
  Topic: <topic>
  Notebook ID: <existing-notebook-id-or-omit>
  Seed URLs: <urls>
  Focus: <focus>

  Write output to: analysis-reports/research/<engagement>/02-literary-review.md

  Report completion to the PI when done."
)
```

**Gate check** (Phase 3 gate): `02-literary-review.md` exists, has structured content, notebook ID recorded.

---

## Phase 4 — Workshop

Identify 3-5 facets from the literary review that need deeper investigation. Spawn one researcher per facet:

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

Invoke the seminar skill. Do not run it inline.

```
Skill("research-lab:seminar", args="notebook=<notebook-id> engagement=<engagement>")
```

Output: `04-seminar.md` with named concepts, decision table, and ranked hypotheses.

**Gate check** (Phase 5 gate): `04-seminar.md` exists with named concepts and ranked hypotheses.

---

## Phase 6 — Methodology

Write `05-methodology.md` using the template:

```bash
cat ${CLAUDE_PLUGIN_ROOT}/skills/run/references/methodology-template.md
```

**Required for this engagement:**
- **Single metric.** One number that goes up or down. Not two metrics, not a qualitative assessment. The experiment loop ratchets on this one number.
- **Sampling method.** Document exactly which pages are measured and how they were chosen. Use the content-type-based sample from Phase 2.
- **Direction.** State whether higher or lower is better.

Fill in based on all prior phase outputs. Confirm with the user before proceeding.

**Gate check** (Phase 6 gate): `05-methodology.md` exists, has all required sections per `${CLAUDE_PLUGIN_ROOT}/skills/experiment/references/methodology-spec.md`, has exactly one metric with direction specified.

---

## Phase 7 — Experiment

Invoke the experiment skill. Do not run the experiment loop ad-hoc.

```
Skill("research-lab:experiment", args="methodology=analysis-reports/research/<engagement>/05-methodology.md results=analysis-reports/research/<engagement>/results.jsonl workdir=<worktree-path>")
```

The experiment skill handles: resume detection, reference reading, the full iteration loop (propose → gate → implement → measure → validate → decide → log), and termination.

If the experiment reports futility:
- Review the pattern of failures
- Consider revising the methodology (return to Phase 6)
- Or accept the best result and proceed to report

**Gate check** (Phase 7 gate): `results.jsonl` exists, experiment terminated via one of: target achieved, budget exhausted, or futility threshold.

---

## Phase 8 — Report

Read the report template for structure:

```bash
cat ${CLAUDE_PLUGIN_ROOT}/templates/research-report.md
```

Write `07-report.md` to the engagement directory. Include:
- The full page sample with per-page before/after status
- The single metric: baseline → final → improvement %
- Every iteration from results.jsonl in a table
- What was fixed, what remains unfixable (and why)

Generate charts if results.jsonl has data:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/generate-chart.py analysis-reports/research/<engagement>/results.jsonl
```

---

## Phase 9 — Cleanup

1. Archive the report to Obsidian vault:
```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
DEST="Research/<engagement>/$(date +%Y-%m-%d)-report.md"
mkdir -p "$VAULT_ROOT/$(dirname "$DEST")"
cp "analysis-reports/research/<engagement>/07-report.md" "$VAULT_ROOT/$DEST"
```

2. Clean up the team (if created):
```
TeamDelete(name="research-<engagement>")
```

3. Clean up debug artifacts in the worktree (e.g., `services.debug-cache.yml`). Keep the actual fix commits — the user decides whether to submit them.

4. Stop DDEV only if the user confirms they're done with the worktree.
