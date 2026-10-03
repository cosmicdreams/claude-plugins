# Benchmarking a run

Every `design-lab:run` ends with the benchmark (`design-lab:evaluate`). A run only has to leave complete evidence behind; scoring is cheap and can be repeated.

## Run checklist

Before starting:

- The local site is running and answers at the address you will pass as `--site-url`.
- The Claude account and model are the ones intended for this run; `init` records the configuration folder (`CLAUDE_CONFIG_DIR`, or `~/.claude` when unset).
- The design-lab runner plugin is imported in Figma desktop on this machine, once, from `~/.design-lab/runner/` (see `references/relay.md`). At the start of the build, `workflow.py connect` starts its server and checks the target file by drawing a name-only Cover in it.
- No other design-lab run is building: design-lab builds one library at a time.
- The target Figma file is new and empty.
- Screen recording is running, if the run is being recorded.
- The workspace is new: a run that reuses another run's artifacts measures the build, not the whole pipeline.
- Run the whole library in one Claude session where possible, so `--session current` finds every token it spent.

During the run:

- Start with `workflow.py init` and every identity flag (`--site-label`, `--site-url`, `--operator`, `--model`).
- Answer preflight once. The run asks for everything it needs in one message and records the answers and the go-ahead with `workflow.py preflight`; then it says it is safe to leave it running and completes on its own. The benchmark counts every interruption after the go-ahead.
- Let the runner finish its compare and dump steps; they save the specimen screenshots and page dumps the scorer reads.
- Run `design-lab:verify` and register `verify-report.json`, or the conformance section stays empty.

At the end:

- The run records schema churn itself: `workflow.py identity --schema-change "<what>"` for each change or workaround, or `--no-schema-change`.
- Record the benchmark start once (`workflow.py record --phase benchmark --status running`), then score with `--session current` (or the session's id); a re-score runs the scorer alone. If another Claude session was open in the same project folder during the run, `--session current` may pick it: the report and the scorer's output name the session chosen, and `--session <id>` settles it. The start is where library production time and tokens end. The benchmark ends when its report is finished: the first scoring records that end in the phase log, as `workflow.py record --phase benchmark --status complete` would, and later re-scores keep it.
- Keep the workspace intact: `project.json`, `phase-log.jsonl`, `capture/`, `builds/`, `figma/state.json`, `figma/runner.log`, `figma/results/`, `figma/compare/`, `figma/dump/` and `benchmark/`.
- Keep the session transcript: it lives under the configuration folder in `projects/`, in the folder recorded as `run.claude.transcripts`.

## How time is measured

The report shows only time it measured, and says which. Working time is when Claude or its tools were working, read from the session transcript given with `--session` or `--transcripts`: every span from a person's prompt or a tool result to the end of the assistant's response counts, and the main session's spans and its subagents' spans are merged, so time when several were working at once counts once. The rest of the time between the transcript's first and last events is waiting, of three kinds. Waiting on the person: the assistant had finished its turn and the next event is a prompt a person typed, or a tool was waiting for the person's answer, from the call to its result (`AskUserQuestion`, and `ExitPlanMode` when a plan is put up for approval). Waiting on usage limits: after a record reporting a rate, session, usage or spend limit (`isApiErrorMessage` with `error` `rate_limit`, status 429), until the limit resets if the record says when. Waiting on the service: after a record reporting it overloaded or unavailable (a `system` `api_error` with status 529 or an `overloaded_error`). Working time and the three kinds of waiting add up to the transcript's span. The headline figure is the working time to produce the library, up to the benchmark step's start; the benchmark's own working time is reported separately, as its tokens are. Wall time is a clock on the wall from `workflow.py init` to the end of the benchmark. The benchmark ends when its report is finished: the first scoring takes the moment scoring finishes, just before the files are written, and records it in the run's phase log; re-scores read that end and never move it, and a run with a recorded start but no recorded end that was scored before shows no wall time. The Figma build time comes from the runner's log, with no model in the loop: each unbroken stretch of steps, from the first step served to the last step recorded, added up, where a pause of more than 15 minutes starts a new stretch. A run scored without a transcript shows the Figma build time and no production time at all, and says how to measure it.

## Unattended after preflight

The run asks everything up front, at preflight, records the go-ahead as the `preflight` phase, and records the target Figma URL without opening the file. From then until the benchmark starts, the scorer reads the session transcript and counts every question the run asked the person (the question and plan-approval tools) and every turn that ended and waited for a person's prompt, each with the phase it happened in. None means the run stayed unattended after preflight, and the report and the completion message say "Ran unattended after preflight: yes". Waits before the go-ahead are setup, and a plan review the person chose at preflight or the later runner connection wait is a planned stop rather than an interruption. A connection attempt that stops because the runner never came remains an interruption. When the transcript shows the session was not running with full access, the report says that tool spans may include waits for approval.

## Fixed opening prompt

Start every benchmarked run with the same prompt, filling in only the bracketed values, so a second run of the same site and runs on different sites begin the same way. Do not add hints about the site.

> Using design-lab, build a complete Figma component library for the repository at [absolute repository path], whose site runs locally at [local site address] and publicly at [public address]. The target Figma file is [file address], which is empty. Initialise the workspace at [workspace path] with site label "[neutral site label]", operator "[name]" and model "[model]". Work through every phase with design-lab:run, finish with design-lab:verify and the benchmark, and reply with the completion message. For preflight: build the plan as proposed.

## Two levels of repeatability

- Build repeatability: rebuild from the same artifacts into a second empty Figma file and compare. The scorer reports this level when the extracted artifacts are identical apart from timestamps and folder paths.
- Pipeline repeatability: a second complete run from an empty workspace. Differences can then come from extraction, planning or judgement, not only from the build.
