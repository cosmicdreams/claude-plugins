# Benchmarking a run

Every `design-lab:run` ends with the benchmark (`design-lab:evaluate`). A run only has to leave complete evidence behind; scoring is cheap and can be repeated.

## Run checklist

Before starting:

- The local site is running and answers at the address you will pass as `--site-url`.
- The Claude account and model are the ones intended for this run; `init` records the configuration folder (`CLAUDE_CONFIG_DIR`, or `~/.claude` when unset).
- The design-lab runner plugin is imported in Figma desktop on this machine (see `references/relay.md`).
- The target Figma file is new and empty.
- Screen recording is running, if the run is being recorded.
- The workspace is new: a run that reuses another run's artifacts measures the build, not the whole pipeline.
- Run the whole library in one Claude session where possible, so `--session current` finds every token it spent.

During the run:

- Start with `workflow.py init` and every identity flag (`--site-label`, `--site-url`, `--operator`, `--model`).
- Let the runner finish its compare and dump steps; they save the specimen screenshots and page dumps the scorer reads.
- Run `design-lab:verify` and register `verify-report.json`, or the conformance section stays empty.

At the end:

- Record schema churn: `workflow.py identity --schema-change "<what>"` for each change or workaround, or `--no-schema-change`.
- Record the benchmark start (`workflow.py record --phase benchmark --status running`), score, then record it complete. The start is where library production time and tokens end.
- Keep the workspace intact: `project.json`, `phase-log.jsonl`, `capture/`, `builds/`, `figma/state.json`, `figma/runner.log`, `figma/results/`, `figma/compare/`, `figma/dump/` and `benchmark/`.
- Keep the session transcript: it lives under the configuration folder in `projects/`, in the folder recorded as `run.claude.transcripts`.

## Fixed opening prompt

Start every benchmarked run with the same prompt, filling in only the bracketed values, so a second run of the same site and runs on different sites begin the same way. Do not add hints about the site.

> Using design-lab, build a complete Figma component library for the repository at [absolute repository path], whose site runs locally at [local site address] and publicly at [public address]. The target Figma file is [file address], which is empty. Initialise the workspace at [workspace path] with site label "[neutral site label]", operator "[name]" and model "[model]". Work through every phase with design-lab:run, finish with design-lab:verify and the benchmark, and reply with the completion message.

## Two levels of repeatability

- Build repeatability: rebuild from the same artifacts into a second empty Figma file and compare. The scorer reports this level when the extracted artifacts are identical apart from timestamps and folder paths.
- Pipeline repeatability: a second complete run from an empty workspace. Differences can then come from extraction, planning or judgement, not only from the build.
