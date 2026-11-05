# Strategy: `explore`

For questions with no imaginable goal ("see what we could do with the homepage hero"). Spread out, then converge. There is no target and no winner: the run hands back a gallery, the points of interest, and what is worth a `climb` or `compare` next. It always ends `explored`, on its rounds or budget, and never claims an improvement. `experiment.py` enforces every rule below.

## Methodology

`Question:` (the open question), `Count:` candidates per round (2–6, default 4), `Rounds:` (1–3, default 2), `Budget:` (measurements, or judge requests under council), and the scorer's inputs as in `compare.md`: `Measure:`, `Checks:`, `Direction:`, `Runs:` for scripted, or a `judging-protocol` block for council. `Include incumbent: yes` adds the unchanged base to round 1 as a reference point; include it whenever the question is about doing better than what exists, or the gallery has nothing to compare against. `Budget:` reserves no confirmation (explore never confirms). `check` refuses a plan the budget cannot cover. No margin is applied: candidates within a few MADs of each other are not separated, and a MAD of 0 on a coarsely rounded metric understates the noise.

## Rounds

Every command takes `--engagement E`; variants are built and measured exactly as in `compare.md`: one commit each on base, on its own branch `<branch>--<name>`. `variant commit` puts the worktree back to base, so your edits disappear from it; that is expected.

1. **Spread out.** `next` returns `add-variants`. Build `Count` candidates that differ from each other as much as the question allows: different ideas, not tweaks of one. You may draft them with parallel subagents; commit them one at a time with `variant begin --name N --tradeoff "…" --description "…"`, edit, `variant commit`.
2. **Rank.** `measure` (scripted), or the council round (`measure --panel P --seed N`, dispatch, `record` each reply, `score`) as in `compare.md`. A round is ranked, not decided: no confirmation, no winner.
3. **Announce.** `next` returns `announce` after every round, including the last. Read every candidate's result and critiques and mark one or two points of interest with `announce --name N --note "what is promising and which direction to vary"`: `next` moves on after the first, and a second is still accepted until the next round's first `variant begin`. Announcements are one-way notes: for the next round's variations, and after the last round for the report's next experiments.
4. **Converge.** Later rounds return `add-variants` with the announced points of interest. Build `Count` variations, each with `variant begin --name N --parent <announced name> --tradeoff "…" --description "…"`. Every variation is built from base: re-apply the parent's idea plus the new change.
5. After the last round, or when the remaining budget cannot cover another, the run ends `explored`. Run `report`.

## Report

The gallery lists every candidate by round with its rank, measurement (or council wins and ties), trade-off, parent and branch, and a "worth pursuing? (agent's view)" column you fill. Then the points of interest with their notes, and a "Next experiments" line per point of interest: fill each `_` with a proposed `climb` when a number now seems reachable, a `compare` when a clear choice has emerged, or "none" with why. `Held-out:` is not run by explore. Nothing is merged.
