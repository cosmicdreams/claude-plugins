---
name: optimize
description: >
  Run a full Drupal performance-optimization engagement against local DDEV: cache-header preflight,
  source gathering via NotebookLM, digest + synthesis, methodology authoring, iterative
  experimentation with ratchet optimization, and a final report with cache-survival metrics.
  Use when starting or resuming a Drupal cache/performance engagement. Say "optimize this Drupal
  site's caching", "run a Drupal perf engagement", "cache optimization engagement", or
  "drupal-lab:optimize". Not for standalone source gathering (use research-lab:gather), standalone
  experiments (use research-lab:experiment), or quick brainstorming (use ideate:brainstorm).
triggers:
  - "optimize this drupal site"
  - "drupal performance engagement"
  - "cache optimization engagement"
  - "drupal-lab:optimize"
  - "research-lab:run"
---

# Drupal Optimization Engagement

Orchestrate a full Drupal cache/performance engagement from preflight through final report, against
**local DDEV only**. You are the Principal Investigator. This skill was formerly
`research-lab:run`; it moved to drupal-lab in 2.0 because it is a Drupal-specific engagement, while
the general research primitives it calls stay in research-lab.

## Dependency — research-lab must be installed

This skill calls research-lab verbs (`gather`, `experiment`) via `Skill()` and reads research-lab's
Principal Investigator/researcher agent definitions and protocols. Resolve the research-lab install once, up front, and
**fail fast** if it is absent rather than improvising:

```bash
RESEARCH_LAB_ROOT="$(ls -d ~/.claude/plugins/cache/local/research-lab/* 2>/dev/null | sort -V | tail -1)"
if [ -z "$RESEARCH_LAB_ROOT" ]; then
  echo "drupal-lab:optimize requires the research-lab plugin. Install it:"
  echo "  claude plugin install research-lab@local --scope user"
  exit 1
fi
```

Use `$RESEARCH_LAB_ROOT` for research-lab resources:
- Principal Investigator role definition: `$RESEARCH_LAB_ROOT/agents/principal-investigator.md`
- Engagement directory structure + file naming: `$RESEARCH_LAB_ROOT/protocols/context-flow.md`
- Methodology spec (Phase 5 gate): `$RESEARCH_LAB_ROOT/skills/experiment/references/methodology-spec.md`

Drupal-specific scripts and references are local (`${CLAUDE_PLUGIN_ROOT}/...`).

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
- `01-preflight.md` exists → skip to Phase 3 (Gather)
- `02-gather.md` exists → skip to Phase 4 (Synthesize)
- `04-synthesize.md` exists → skip to Phase 5 (Methodology)
- `05-methodology.md` exists → skip to Phase 6 (Experiment)
- `results.jsonl` exists with keeps → skip to Phase 7 (Report)

Report resume state to the user before proceeding.

---

## Phase 1 — Setup

Confirm with the user:
- Engagement name (kebab-case, e.g., `cache-optimization`)
- Research topic / optimization target
- Any seed URLs or existing NotebookLM notebooks
- Target project root (e.g., `~/Sites/my-project`)

### 1a. Create worktree

Invoke the create-worktree skill. Do not create the worktree manually.

```
Skill("admin:create-worktree", args="project=<target-project-root> name=<engagement-name>")
```

This creates `<target-project-root>/worktrees/<engagement-name>/` on its own branch.

**Naming convention:** The worktree name is just the engagement name (e.g., `cache-optimization`), NOT prefixed with the project name. The worktree already lives under the project root, so the project prefix is redundant in the path. The DDEV instance name (set in `config.local.yaml`) is where the project prefix belongs: `<project>-<engagement>` (e.g., `mysite-cache-optimization`).

### 1b. Bootstrap DDEV

Invoke the process-lifecycle skill for DDEV setup. Do not run `ddev start` directly — the skill handles `config.local.yaml` creation, dependency installation, and ready checks.

```
Skill("drupal-lab:process-lifecycle", args="phase=init worktree=<target-project-root>/worktrees/<engagement-name>")
```

**DDEV naming:** Use `project_tld` in the project's `config.yaml` to namespace by project (see `lib:ddev` for the multi-project worktree convention). If `project_tld` isn't set, ensure `config.local.yaml` name includes the project prefix — e.g., `mysite-cache-optimization`.

### 1c. Provision database

A fresh worktree has an empty database. Try these sources in order — use the first that succeeds:

```bash
# Option 1: Local database dump (fastest, no network needed)
# Check for existing dumps in the project's databases/ directory
ls <target-project-root>/databases/*.sql* 2>/dev/null
# If found:
cd <worktree-path>
ddev import-db --file=<target-project-root>/databases/<latest-dump>

# Option 2: Pull from Acquia (gets production-like data, requires network + IP whitelist)
cd <worktree-path>
ddev pull acquia-dev --skip-files -y

# Option 3: Export from main DDEV (requires a free DDEV slot)
cd <target-project-root>/worktrees/main && ddev start
ddev export-db --gzip=false --file=/tmp/project-db.sql
ddev stop
cd <worktree-path>
ddev import-db --file=/tmp/project-db.sql
```

**After importing from ANY source**, always run the full post-database bootstrap:
```bash
ddev drush updatedb -y    # apply pending schema updates
ddev drush config:import -y  # sync config with codebase
ddev drush cr             # clear caches
```

This sequence is critical when the database dump is older than the codebase — skipping `updatedb` or `config:import` causes 500 errors.

If the project has custom bootstrap steps (e.g., Site Studio's `cohesion:import` + `cohesion:rebuild`), ask the user: "Does this project need any special bootstrap steps beyond database pull and cache clear?"

### 1d. Create engagement directory

In the orchestrating project (CLAUDE-PLUGINS), not the target:

```bash
mkdir -p "analysis-reports/research/<engagement>"
```

No subagents at setup — gather/synthesize/experiment manage their own fan-out when invoked.

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

Read `${CLAUDE_PLUGIN_ROOT}/skills/optimize/references/phase-gates.md` (Phase 2 gate).

### 2d. Diagnostic mode decision

After the preflight, assess the engagement type:

**Diagnostic engagement** — the problem is observable and measurable (e.g., 0% cache survival, UNCACHEABLE on all pages, specific error). The preflight already reveals the symptom. Research phases would add overhead without producing the root cause.

**Design engagement** — the question is "what's the best approach?" (e.g., "should we use Imperva or Cloudflare?", "what CDN integration pattern fits our architecture?"). Multiple perspectives and external research add genuine value.

**If diagnostic:** Ask the user: "The preflight reveals a measurable problem. I can investigate directly and skip to methodology+experiment. Or run the full research pipeline. Which do you prefer?"

If the user chooses diagnostic mode:
- Skip Phases 3-4 (gather, synthesize)
- The Principal Investigator investigates directly (enable debug headers, enumerate blocks, trace cache tags, etc.)
- Write findings to `04-synthesize.md` (Principal Investigator-authored diagnostic summary)
- Proceed to Phase 5 (Methodology)

**If design or user prefers full pipeline:** Continue to Phase 3.

---

## Phase 3 — Gather

Delegate source gathering to the research-lab `gather` verb. It owns the NotebookLM notebook
creation, deep-research, and curation; do not reimplement it here.

```
Skill("research-lab:gather", args="topic=<topic> engagement=analysis-reports/research/<engagement> notebook=<existing-notebook-id-or-omit>")
```

If you want parallel coverage of a broad topic, `gather` decides its own fan-out (Workflow
`pipeline()` facets) internally — you do not orchestrate researchers here.

Output: `02-gather.md` + a curated notebook id.

**Gate check** (Phase 3 gate): `02-gather.md` exists, has structured content, notebook ID recorded.

---

## Phase 4 — Synthesize

Digest and form a position from the gathered material. Delegate to the research-lab `synthesize`
verb (the dissolved workshop+seminar work now lives inside it):

```
Skill("research-lab:synthesize", args="notebook=<notebook-id> engagement=analysis-reports/research/<engagement> question=<the optimization decision to resolve>")
```

For a high-stakes engagement, optionally harden the position with `research-lab:interrogate` before
committing to a methodology — it adversarially peer-reviews the formed claim.

Output: `04-synthesize.md` with the position, named concepts, decision table, and ranked hypotheses.

**Gate check** (Phase 4 gate): `04-synthesize.md` exists with a formed position and ranked hypotheses.

---

## Phase 5 — Methodology

Write `05-methodology.md` using the template:

```bash
cat ${CLAUDE_PLUGIN_ROOT}/skills/optimize/references/methodology-template.md
```

**Required for this engagement:**
- **Single metric.** One number that goes up or down. Not two metrics, not a qualitative assessment. The experiment loop ratchets on this one number.
- **Sampling method.** Document exactly which pages are measured and how they were chosen. Use the content-type-based sample from Phase 2.
- **Direction.** State whether higher or lower is better.

**Metric selection guidance:** The metric must reflect what the user's infrastructure cares about, not Drupal internals. Ask: "What does your CDN/proxy/end-user experience when this problem occurs?"

| User goal | Wrong metric | Right metric |
|-----------|-------------|--------------|
| Maximize CDN hit rate | Dynamic Page Cache HIT % (internal) | % of pages still cached after a content edit |
| Reduce origin load | Cold time to first byte (measures render speed, not cache) | Cache survival rate after tag invalidation |
| Improve authenticated user experience | Page cache HIT (anonymous only) | Dynamic Page Cache HIT rate for authenticated requests |
| Speed up page loads | Render pipeline time | Largest Contentful Paint or time to first byte at the edge |

Fill in based on all prior phase outputs. **Confirm the metric with the user before proceeding** — getting this wrong wastes iterations.

**Gate check** (Phase 5 gate): `05-methodology.md` exists, has all required sections per `$RESEARCH_LAB_ROOT/skills/experiment/references/methodology-spec.md` (research-lab install), has exactly one metric with direction specified.

---

## Phase 6 — Experiment

Invoke the experiment skill. Do not run the experiment loop ad-hoc.

```
Skill("research-lab:experiment", args="methodology=analysis-reports/research/<engagement>/05-methodology.md results=analysis-reports/research/<engagement>/results.jsonl workdir=<worktree-path>")
```

The experiment skill handles: resume detection, reference reading, the full iteration loop (propose → gate → implement → measure → validate → decide → log), and termination.

If the experiment reports futility:
- Review the pattern of failures
- Consider revising the methodology (return to Phase 5)
- Or accept the best result and proceed to report

**Gate check** (Phase 6 gate): `results.jsonl` exists, experiment terminated via one of: target achieved, budget exhausted, or futility threshold.

---

## Phase 7 — Report

Read the report template for structure (lives in the research-lab install):

```bash
cat $RESEARCH_LAB_ROOT/templates/research-report.md
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

## Phase 8 — Cleanup

1. Archive the report to Obsidian vault:
```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
DEST="Research/<engagement>/$(date +%Y-%m-%d)-report.md"
mkdir -p "$VAULT_ROOT/$(dirname "$DEST")"
cp "analysis-reports/research/<engagement>/07-report.md" "$VAULT_ROOT/$DEST"
```

2. Clean up debug artifacts in the worktree (e.g., `services.debug-cache.yml`). Keep the actual fix commits — the user decides whether to submit them.

3. Stop DDEV only if the user confirms they're done with the worktree.
