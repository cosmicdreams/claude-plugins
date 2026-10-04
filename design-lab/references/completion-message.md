# Completion message

`design-lab:run` ends by replying to its user with this message, word for word apart from the values in braces. `score_run.py` fills it in from the scorecard and writes it to `benchmark/completion.md` beside the report, so the reply is the file's contents and nothing is retyped from memory.

```text
design-lab finished the {site} component library.

- Figma file: {figma_url}
- Coverage: {coverage}; the built components carry {placements}.
- Accuracy against the live site: {accuracy}.
- Time: {working_time}; the Figma build itself took {figma_build_time}; {wall_time}.
- Ran unattended after preflight: {unattended}.
- Tokens by model to produce the library: {library_tokens}. Added by benchmarking: {benchmark_tokens}.
- Developer audit: [benchmark report]({report_url})
- Not measured this run: {not_measured}.
- Known gaps: {gaps}; each is named with its reason under Known gaps on the Getting Started page in Figma.
```

## What each value means

- Coverage counts built components against the ones the run could have built: retirement candidates and schema-only entries are not buildable. Placements are author placements of inventoried components. Both come from `scripts/library_counts.py`, the module the Cover and Getting Started page use, so the numbers match the file.
- Working time is when Claude or its tools were working, read from the session transcript given with `--session`: every span from a person's prompt or a tool result to the end of the assistant's response, with the main session and its subagents merged so overlapping time counts once. Waiting on the person (including a tool waiting for the person's answer), on usage limits and on the service is not working time, and the message names each wait that occurred. Library production ends where the benchmark step starts (`workflow.py record --phase benchmark --status running`), and the benchmark's own working time is given separately. Without a transcript the message says working time was not measured. The Figma build time is the runner's own log, with no model in the loop. Wall time runs from `workflow.py init` to the end of the benchmark, which ends when its report is finished and is recorded by the first scoring; it is given only when both ends were recorded. `references/benchmark.md` defines each measure in full.
- Ran unattended after preflight counts, from the session transcript, every question the run asked the person and every turn that ended and waited for a prompt, between the preflight go-ahead (`workflow.py preflight`) and the benchmark's start, each with the phase it happened in. Waits before the go-ahead are setup, and a plan review the person chose at preflight, or the build's wait for the person to start the runner (`workflow.py connect`), is a planned stop, not an interruption.
- Benchmark tokens are the model turns after the benchmark step started. The scorer is a plain script with no model in the loop, so these are only the orchestration turns around it; the completion reply itself is written after the report and is not counted.
