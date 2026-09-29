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
- Record the benchmark start (`workflow.py record --phase benchmark --status running`), score with `--session current` (or the session's id), then record it complete (`--status complete`). The start is where library production time and tokens end; the completion is the end of the wall time when the report is scored again later.
- Keep the workspace intact: `project.json`, `phase-log.jsonl`, `capture/`, `builds/`, `figma/state.json`, `figma/runner.log`, `figma/results/`, `figma/compare/`, `figma/dump/` and `benchmark/`.
- Keep the session transcript: it lives under the configuration folder in `projects/`, in the folder recorded as `run.claude.transcripts`.

## How time is measured

The report shows only time it measured, and says which. Working time is when Claude or its tools were working, read from the session transcript given with `--session` or `--transcripts`: every span from a person's prompt or a tool result to the end of the assistant's response counts, and the main session's spans and its subagents' spans are merged, so time when several were working at once counts once. The rest of the time between the transcript's first and last events is waiting, of two kinds: waiting on the person, when the assistant had finished its turn and the next event is a prompt a person typed; and waiting on usage limits, when the gap follows a record reporting a rate limit, a usage or spend limit (`isApiErrorMessage` with `error` `rate_limit`, status 429) or an overloaded service (a `system` `api_error` with status 529), ending when the limit resets if the record says when. Working time and both kinds of waiting add up to the transcript's span. The headline figure is the working time to produce the library, up to the benchmark step's start; the benchmark's own working time is reported separately, as its tokens are. Wall time is a clock on the wall from `workflow.py init` to the end of the benchmark, shown only when both ends were recorded. The Figma build time comes from the runner's log, with no model in the loop: each unbroken stretch of steps, from the first step served to the last step recorded, added up, where a pause of more than 15 minutes starts a new stretch. A run scored without a transcript shows the Figma build time and no production time at all, and says how to measure it.

## Fixed opening prompt

Start every benchmarked run with the same prompt, filling in only the bracketed values, so a second run of the same site and runs on different sites begin the same way. Do not add hints about the site.

> Using design-lab, build a complete Figma component library for the repository at [absolute repository path], whose site runs locally at [local site address] and publicly at [public address]. The target Figma file is [file address], which is empty. Initialise the workspace at [workspace path] with site label "[neutral site label]", operator "[name]" and model "[model]". Work through every phase with design-lab:run, finish with design-lab:verify and the benchmark, and reply with the completion message.

## Two levels of repeatability

- Build repeatability: rebuild from the same artifacts into a second empty Figma file and compare. The scorer reports this level when the extracted artifacts are identical apart from timestamps and folder paths.
- Pipeline repeatability: a second complete run from an empty workspace. Differences can then come from extraction, planning or judgement, not only from the build.
