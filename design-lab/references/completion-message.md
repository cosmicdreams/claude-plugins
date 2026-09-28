# Completion message

`design-lab:run` ends by replying to its user with this message, word for word apart from the values in braces. `score_run.py` fills it in from the scorecard and writes it to `benchmark/completion.md` beside the report, so the reply is the file's contents and nothing is retyped from memory.

```text
design-lab finished the {site} component library.

- Figma file: {figma_url}
- Coverage: {coverage}; the built components carry {placements}.
- Accuracy against the live site: {accuracy}.
- Time: {library_time} to produce the library (the Figma build itself took {figma_build_time}); {total_time}.
- Tokens by model to produce the library: {library_tokens}. Added by benchmarking: {benchmark_tokens}.
- Developer audit: [benchmark report]({report_url})
- Not measured this run: {not_measured}.
- Known gaps: {gaps}; each is named with its reason under Known gaps on the Getting Started page in Figma.
```

## What each value means

- Coverage counts built components against the ones the run could have built: retirement candidates and schema-only entries are not buildable. Placements are author placements of inventoried components. Both come from `scripts/library_counts.py`, the module the Cover and Getting Started page use, so the numbers match the file.
- Library production time runs from `workflow.py init` to the start of the benchmark step (`workflow.py record --phase benchmark --status running`); total wall time runs to the end of scoring. Both are wall clock.
- Benchmark tokens are the model turns after the benchmark step started. The scorer is a plain script with no model in the loop, so these are only the orchestration turns around it; the completion reply itself is written after the report and is not counted.
