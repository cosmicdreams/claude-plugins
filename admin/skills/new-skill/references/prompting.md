# Prompting Current Claude Models

Rules for the words inside a skill or agent body. They come from Anthropic's Opus 5.5 guidance (claude.dev, "Getting the most out of Opus 5.5 in Claude and Claude Code", 2026-09-22). Current models work longer on their own, think before every reply, and follow stop rules closely, so older prompt habits now cost time or cause needless pauses.

## Remove

- **"Think hard", "think carefully", "think step by step", "ultrathink".** The model already thinks before every reply and decides how much. Removing the line makes replies start sooner with no clear quality drop. To change depth, change the effort setting, not the prose.
- **Requests to reproduce internal reasoning in the output** ("show your chain of thought", "include your full reasoning"). These can be declined and are a safeguard flag category, which can move the session to an older model. Ask for what you need instead: "Explain why you chose this approach in three sentences."
- **Vague style direction** ("avoid a generic look", "make it distinctive"). It swaps one default for another. List the specific patterns to leave out.

## Name the finish line

State what "done" looks like in checkable terms — "the tests pass", "every row has an owner", "the report file exists at X". With a clear finish line the model knows when to stop.

## Name the stops

The model obeys named stops closely, including ones that no longer need to be stops. Every stop in a skill should be one of:

1. **Missing information with no sensible default** — only the user can supply it.
2. **Destructive** — deleting data, force-pushing, dropping a database, tearing down an environment.
3. **Outward-facing** — posting to Slack, Jira, GitHub, or email; publishing; spending money.

Anything else — a progress report, "shall I continue?", a menu of options that don't block the work — should become: pick the default, say which default was taken in the status note, and keep going. Put status notes in the same message as the next action.

Skills whose purpose is the conversation (interviews, quizzes, annotation rounds) keep their interaction; this rule is about gates that interrupt autonomous work.

## Long runs

- Keep the task list in a file or in Beads (`bd`) and update it as items finish. Context gets summarized on long runs; the file survives and shows at a glance what is done and what is left.
- When fanning work out to subagents, check each subagent's evidence before accepting its result.

## Research, analysis, and review output

- Research and analysis: require the output to mark anything that could not be confirmed and say where it looked.
- Review: list only problems that would block the merge. For each, give the file and line, why it is wrong, and how to show it fails.
