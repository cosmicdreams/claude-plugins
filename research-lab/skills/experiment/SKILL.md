---
name: experiment
description: >
  Use when the user says "hill climb", "climb this", or "run an experiment": a metric-driven
  keep-or-revert loop. Not for scoring a single claim (research-lab:interrogate).
triggers:
  - "hill climb"
  - "climb this"
  - "run an experiment"
  - "research-lab:experiment"
allowed-tools: Bash, Read, Write, Edit, Workflow, mcp__t3-code__delegate_task
---

# Experiment

Pick a strategy, then let a script run the loop: it measures, keeps or reverts each trial in git, logs, decides when to escalate or stop, and writes the report. You propose and edit. Domain knowledge lives in the methodology.

Read before starting:
- `${CLAUDE_PLUGIN_ROOT}/skills/experiment/references/strategies.md` — router, strategy card, preload
- `${CLAUDE_PLUGIN_ROOT}/skills/experiment/references/strategies/<strategy>.md` — the chosen strategy's rules
- `${CLAUDE_PLUGIN_ROOT}/skills/experiment/references/methodology-spec.md` — methodology fields
- `${CLAUDE_PLUGIN_ROOT}/skills/experiment/references/iteration-protocol.md` — records and git protocol
- `${CLAUDE_PLUGIN_ROOT}/skills/experiment/references/judged-metrics.md` — judged runs only

`EXP` means `python3 ${CLAUDE_PLUGIN_ROOT}/skills/experiment/scripts/experiment.py`, `CHECK` means `EXP check`, and `JUDGED` means `python3 ${CLAUDE_PLUGIN_ROOT}/skills/experiment/scripts/judged.py`.

## Golden Rule: Worktree = Branch

Work in an exclusively owned, linked experiment worktree (a standard `git worktree add` beside the project's `main` checkout) — never the primary checkout or `main`/`master`. Never clear unrelated changes to make it clean.

## Step −1 — Strategy

Args may preload `strategy=<remediate|climb|compare|explore|auto>` and `scorer=<scripted|council|auto>`. Run `CHECK --strategy S --scorer C --methodology M` with whatever was given (per `strategies.md`):

- `ready` → continue; no pause. If `source.scorer` is `default` (strategy preloaded, scorer not), ask the router's scorer question; if the answer is `council`, re-run `CHECK` with `--scorer council` and obey it.
- `route` → run the router in `strategies.md`. "Not an experiment" → say so in one line and stop. Otherwise write and show the strategy card, with a drafted `methodology.md` if none was given, and **pause** for accept, edit or switch. Re-run `CHECK` with the accepted choice.
- `refused` → STOP; report `reason` and each `missing` item.

`climb` and `remediate` run with the scripted scorer; other strategies and the council scorer stop after the card with `CHECK`'s reason. After acceptance (or a `ready` preload) the run is unattended.

## Input contract

**Requires:** a methodology, an engagement directory `E`, and a dedicated worktree `W`. Take them from context, the card, or the args `methodology=`, `workdir=` and `engagement=`. A caller that passes `results=<dir>/results.jsonl` instead of `engagement=` means `E` is `<dir>`. Else **FAIL FAST**: "Need a measurable hypothesis and a target metric — point me at a methodology file." Stop.

## Step 0 — Start or resume

**Scripted:** if `E/state.json` exists, the run resumes: go to Step 1. Otherwise `EXP init --engagement E --worktree W --methodology M --strategy S --scorer scripted`; a refusal is a STOP with its reason. Then `cd W` and stay there: the hooks that keep an unattended run going only see engagements of the worktree the session is in.

**Judged:** the whole loop is: run `JUDGED next`, perform its one action per `judged-metrics.md`, repeat. The first call is the resume. On `pause`, report the gate or rule and reason, and wait for Chris's `resolve`. On `stop`, go to Step 3. Judged is **refused for now** — the acceptance smoke test failed; see **Status** in `judged-metrics.md`. Once unblocked: confirm `mcp__t3-code__delegate_task` is available, then `JUDGED validate --host t3`; any error → STOP.

## Step 1 — The loop (scripted)

Run `EXP next --engagement E` and do its one action, then repeat:

| Action | Do |
|---|---|
| `baseline` | `EXP baseline --engagement E` |
| `propose` | Pick ONE change at the returned escalation level (strategy reference). Skip anything in `tried` or that contradicts a keep. `EXP trial begin --engagement E --change "…" --tradeoff "…"`, edit files in `W`, `EXP trial commit --engagement E`, `EXP trial score --engagement E`. |
| `edit` / `rework` | Finish or rework the open trial's edits, then `trial commit` and `trial score`. |
| `resolve` | `EXP trial score --engagement E` |
| `confirm` | `EXP confirm --engagement E` |
| `pause` | Report the reason and end the session. Chris clears it with `EXP resume`. |
| `stop` | Go to Step 3. |

Rules:
- Run `baseline`, `trial score` and `confirm` in the foreground with the longest timeout your shell allows; they measure `Runs` times and hold a lock while they work. Never start a second one; if one refuses because another is running, wait for it.
- Never run git yourself to commit, revert or reset a trial: `trial commit` stages every change in `W` outside `E`. The measurement commands must leave `W` clean; if `baseline` refuses because they did, fix the methodology (for example ignore generated files) rather than cleaning by hand.
- In `E`, never edit `state.json`, `results.jsonl` or `progress.log`. You write `strategy.md` (the card and any `router_disagrees`) and, after the last `report`, the "worth maintaining?" column of `report.md`; running `report` again overwrites that column.
- `propose` returns `tried` (changes discarded against the current incumbent), `kept` (changes kept so far) and, for remediate, `findings` (open finding IDs when the measure script prints `FINDING <id>` lines). Do not repeat a `tried` change.
- `tradeoff` is one sentence on what the change costs to keep (complexity, a dependency, changed behavior, maintenance).
- A climb with proof the target cannot be reached ends with `EXP conclude --kind bound|scope --evidence "…"` at any escalation level; remediate records an unfixable finding with `EXP exception add`.

**Parallel proposals:** independent ideas may be drafted in parallel, but trials are scored one at a time.

## Step 2 — Judged steps

Judged runs only. `JUDGED next`'s `propose` action uses these:

- **2a. Propose** from the ranked hypotheses and `propose`'s `diagnostics`; a change drawn from a critique names its source eval in `change`, at most `max_batch` critiques per trial.
- **2b. Cheap gate.** Redundant with a discard or contradicting a keep → log a `skip` with the returned iteration; no `trial begin`.
- **2c. Implement.** `JUDGED trial begin --worktree W --change TEXT`, edit, commit, `JUDGED trial commit --worktree W`.
- **2d–2g** are `next`'s capture, open, score, checks and log actions. Log only the `args` that `next` returns.

## Step 3 — Report

**Scripted:** `EXP report --engagement E` writes `E/report.md`. Fill its "worth maintaining?" column with your view, marked as yours, and show Chris the ending, the decisions to review and any validity or worth-keeping failure. Never call a run done unless its ending is `met` or `exceptions`.

**Judged:** on `stop target`, Chris reviews the artifacts; a rejection is `JUDGED resolve --decision reject --worktree W` and the climb continues. Report keeps vs discards, the latest calibrated or confirmed *M*, judge requests spent, and whether drift was monitored.

`EXP status --all --repo R` lists every engagement in a repository's worktrees. Offer a chart (`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/generate-chart.py E/results.jsonl`) or a vault archive.
