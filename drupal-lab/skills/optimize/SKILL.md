---
name: optimize
description: >
  Run or resume a full Drupal cache and performance engagement against local DDEV:
  cache-header preflight, source gathering, synthesis, methodology, ratchet
  experimentation, and a final report with cache-survival metrics. Not for standalone
  gathering (research-lab:gather) or experiments (research-lab:experiment).
triggers:
  - "optimize this drupal site"
  - "drupal performance engagement"
  - "cache optimization engagement"
  - "drupal-lab:optimize"
  - "research-lab:run"
---

# Drupal Optimization Engagement

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Run a full Drupal performance-optimization engagement against local DDEV: cache-header preflight, source gathering via NotebookLM, digest + synthesis, methodology authoring, iterative experimentation with ratchet optimization, and a final report with cache-survival metrics. Use when starting or resuming a Drupal cache/performance engagement. Say "optimize this Drupal site's caching", "run a Drupal perf engagement", "cache optimization engagement", or "drupal-lab:optimize". Not for standalone source gathering (use research-lab:gather), standalone experiments (use research-lab:experiment), or quick brainstorming (use ideate:brainstorm).

Orchestrate a full Drupal cache/performance engagement against **local DDEV only**. This skill
composes research-lab verbs (`gather`, `synthesize`, `interrogate`, `experiment`) around
Drupal-specific preflight and methodology steps.

## Dependency

research-lab must be installed. Fail fast if absent:

```bash
RESEARCH_LAB_ROOT="$(ls -d ~/.claude/plugins/cache/local/research-lab/* 2>/dev/null | sort -V | tail -1)"
[ -z "$RESEARCH_LAB_ROOT" ] && echo "Install research-lab: claude plugin install research-lab@local --scope user" && exit 1
```

## Hard Rules

- Never modify `worktrees/main/`. All changes happen in a dedicated worktree.
- Always target local DDEV. Never hit remote environments (dev, staging, production).
- The experiment loop controls termination. Do not declare the engagement complete until
  the loop terminates: target achieved, budget exhausted, or futility threshold.

## Pipeline

### Phase 0 — Resume Detection

```bash
ls "analysis-reports/research/<engagement>/" 2>/dev/null
```

Completed phase outputs skip ahead:
- `01-preflight.md` exists → skip to Gather
- `02-gather.md` exists → skip to Synthesize
- `04-synthesize.md` exists → skip to Methodology
- `05-methodology.md` exists → skip to Experiment
- `results.jsonl` with keeps → skip to Report

### Phase 1 — Setup

Confirm with the user: engagement name (kebab-case), optimization target, any seed URLs.
Create worktree via `admin:create-worktree`. Bootstrap DDEV via `drupal-lab:process-lifecycle`.
Provision database (local dump → Acquia pull → export from main DDEV, in order).

After database import, always run:
```bash
ddev drush updatedb -y && ddev drush config:import -y && ddev drush cr
```

Create the engagement directory: `analysis-reports/research/<engagement>/`

### Phase 2 — Preflight

Discover content types and sample one published page per type:
```bash
ddev drush sql:query "SELECT nfd.type, MIN(pa.alias) as alias FROM node_field_data nfd INNER JOIN path_alias pa ON CONCAT('/node/', nfd.nid) = pa.path WHERE nfd.status = 1 GROUP BY nfd.type ORDER BY nfd.type"
```

Add the homepage (`/`) to the sample list.

Run preflight script from inside the worktree:
```bash
${CLAUDE_PLUGIN_ROOT}/scripts/preflight.sh <worktree-ddev-url> <all-sample-pages>
```

Write output to `01-preflight.md`. Note per page: HTTP status, Dynamic Page Cache status,
`X-Drupal-Cache-Max-Age`, and session cookies.

Gate check: `${CLAUDE_PLUGIN_ROOT}/skills/optimize/references/phase-gates.md` (Phase 2 gate).

**Diagnostic vs. design decision**: If the preflight reveals a measurable problem directly,
ask the user whether to investigate without the full research pipeline (skipping Gather and
Synthesize). If the user chooses diagnostic mode, write findings directly to
`04-synthesize.md` and proceed to Methodology.

### Phase 3 — Gather

```
Skill("research-lab:gather", args="topic=<topic> engagement=analysis-reports/research/<engagement>")
```

Output: `02-gather.md` + notebook ID.

### Phase 4 — Synthesize

```
Skill("research-lab:synthesize", args="notebook=<id> engagement=analysis-reports/research/<engagement> question=<optimization decision>")
```

For high-stakes engagements, optionally harden with `research-lab:interrogate`.

Output: `04-synthesize.md` with position, named concepts, decision table, and ranked hypotheses.

### Phase 5 — Methodology

Write `05-methodology.md` using the template from `${CLAUDE_PLUGIN_ROOT}/skills/optimize/references/methodology-template.md`.

Required: one metric with direction, sampling method documenting which pages are measured.
Confirm the metric with the user before proceeding.

| User goal | Wrong metric | Right metric |
|-----------|-------------|--------------|
| Maximize CDN hit rate | Dynamic Page Cache HIT % (internal) | % of pages still cached after a content edit |
| Reduce origin load | Cold time to first byte | Cache survival rate after tag invalidation |
| Improve authenticated user experience | Page cache HIT (anonymous only) | Dynamic Page Cache HIT rate for authenticated requests |
| Speed up page loads | Render pipeline time | Largest Contentful Paint or time to first byte at the edge |

Gate check: `$RESEARCH_LAB_ROOT/skills/experiment/references/methodology-spec.md`.

### Phase 6 — Experiment

```
Skill("research-lab:experiment", args="methodology=analysis-reports/research/<engagement>/05-methodology.md results=analysis-reports/research/<engagement>/results.jsonl workdir=<worktree-path>")
```

### Phase 7 — Report

Write `07-report.md`. Include: full page sample with per-page before/after status, single
metric baseline → final → improvement %, all iterations from `results.jsonl`.

Generate chart:
```bash
python3 "$RESEARCH_LAB_ROOT/scripts/generate-chart.py" analysis-reports/research/<engagement>/results.jsonl
```

### Phase 8 — Cleanup

Archive to Obsidian vault:
```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
cp "analysis-reports/research/<engagement>/07-report.md" "$VAULT_ROOT/Research/<engagement>/$(date +%Y-%m-%d)-report.md"
```

Clean up debug artifacts (e.g., `services.debug-cache.yml`). Stop DDEV only if the user
confirms they are done with the worktree.
