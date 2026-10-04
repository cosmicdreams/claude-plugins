---
name: evaluate
description: >
  Score a finished design-lab run and produce a presentable, self-contained HTML report —
  what was built, how faithful it is to the live site, what it cost, and how repeatable it
  is — plus a schema-validated scorecard and the fixed completion message. design-lab:run
  calls it as its last step; also use it on any earlier run folder. Not for checking the
  library against the standard (design-lab:verify) or for building anything.
---

# Evaluate a run

The benchmark closes a run. It turns the evidence a run left behind into one report a developer can audit, into `scorecard.json` for comparing runs over time, and into the completion message `design-lab:run` replies with. Capture happens during the run; scoring happens afterwards and can be repeated whenever the scorer improves. The run never depends on the scorer.

## During the run: leave complete evidence

Follow `references/benchmark.md`: the run checklist and the fixed opening prompt. Start with every identity flag:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py init --repo <repository> \
  --site-label "<neutral site name>" --site-url <local-site-address> --model <model>
```

`init` creates the run folder by the convention `design-lab:init` chose and prints it (that is `<workspace>` below), and records run identity in `project.json`; the operator comes from setup: plugin version and commit, site label, repository commit, local site address, operator, Claude configuration folder and model, transcript folder, and start time. Every phase change is appended to `phase-log.jsonl`. For a run started before 0.15, `workflow.py identity` fills in the same block afterwards.

Record schema churn with `workflow.py identity --schema-change "<what changed>"` (repeatable) when `components.json`, `tokens.json` or the build-record schema needed a change or workaround, or `--no-schema-change` when nothing did.

## Score it

The first time a run is scored, mark the start of the benchmark step first, so its time and tokens are kept apart from the time and tokens it took to produce the library:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py record --project <workspace> --phase benchmark --status running
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/score_run.py <workspace> --session current \
  [--compare <other-workspace> ...] [--site-label "<label>"] [--out <folder>]
```

The benchmark ends when its report is finished. The first scoring takes that end as scoring finishes, just before the files are written, and records it in the run's phase log as `workflow.py record --phase benchmark --status complete` would; re-scores read it and never move it. To re-score later, run `score_run.py` alone and do not mark a new start: once the benchmark has a recorded end, `workflow.py` ignores a second start and says so, and the scorer keeps the first start-and-end pair either way. The first scoring also stops the run's runner server, since the benchmark is the run's last step. By default the scorer writes into `<workspace>/benchmark/`: `scorecard.json`, validated against `schemas/scorecard.schema.json`; `report.html`, the developer audit; and `completion.md`, the completion message filled from `references/completion-message.md`. It also prints the message. `--out` may name any folder outside the workspace instead; when the site label names a client, keep it out of shared repositories.

- `--session <id>` (or `current`, the newest session in the run's recorded transcript folder) adds working time and the tokens Claude spent producing the library, by Claude model: input, output, cache-write and cache-read tokens, turns and tool calls per model, summed over the session's main transcript and its subagent transcripts (`<session-id>/subagents/*.jsonl`), and nothing else. The report names the Claude configuration folder (the account) it came from. Turns after the benchmark start are reported separately as the increase benchmarking caused. `--transcripts` takes transcript files instead; given a folder, it falls back to every session inside the run's time window, which also counts unrelated work.
- Time: the headline is working time, when Claude or its tools were working, read from the session transcript; waiting on the person (including a tool waiting for the person's answer), waiting on usage limits and waiting on the service are reported apart and not counted. Library production ends at the benchmark start, and the benchmark's own working time is reported separately. Wall time, from `init` to the end of the benchmark, is shown only when both ends were recorded. Without a transcript the report shows only the runner's Figma build time and says working time was not measured. `references/benchmark.md` defines each measure.
- Coverage leads the report: built out of the components the run could have built, the gap by reason, and the share of author placements the built components carry. Every count comes from `scripts/library_counts.py`, the module the Figma Cover and Getting Started page are drawn from, so the numbers match the file.
- `--compare` adds repeatability: node-by-node comparison with `compare_runs.py`, plus agreement of the accuracy verdicts across runs.
- Accuracy is recomputed from the specimen screenshots in `figma/compare/` and the geometry in `figma/results/`. The original measure is kept beside the corrected one, which counts height difference and unmatched area and applies the colour tolerance per channel (`figma_compare.py --corrected`).

## Read the result before showing it

Open the report and check the headline against the evidence. Every section says one of measured, partly measured, not measured, or scored later; a section without evidence says why and how to measure it next time, and never shows a guessed zero. Foundations and voice, and blinded visual judgement, are placeholders until people score them; their slots already exist in the scorecard.

Reply with `completion.md` as written.
