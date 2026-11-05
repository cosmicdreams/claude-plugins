# Strategy: `compare`

Choose between variants and say what each costs. There is no incumbent to beat step by step and no target: the output is a decision with its trade-offs, or "no path to pursue". `experiment.py` enforces every rule below.

## Variants

`Variants:` in the methodology picks the mode:

- **given**: one `Variant <name>:` line per option you were handed (for example Redis vs database cache). Build each one.
- **generated**: write `Count:` variants of the stated `Idea:`. Make them genuinely different answers to the idea, each differing in one main choice, so the comparison says something. A redesign of the current approach is a generated variant.
- **grid**: `Grid <param>:` lines and an `Apply:` command; the script builds every point itself (`build-grid`). Use it for tuning known settings.
- `Include incumbent: yes` measures the unchanged base too, so "none of these beats what we have" is a possible answer.

Each variant is one commit on the base, on its own branch `<branch>--<name>`; the experiment branch never moves. Build a given or generated variant with `variant begin --name N --tradeoff "…"` (generated also `--description "…"`), edit, then `variant commit`; the script returns the worktree to the base. `variant discard --name N` drops one before measuring.

## Measuring and deciding

`measure` runs every variant `Runs` times in an interleaved, seeded order, so drift over time spreads across all of them. A variant whose measurement fails is marked invalid, and one that fails `Checks` is marked as failing; the others continue.

Among viable variants:

- None viable, or none beats the incumbent by more than the margin when it is included → ending **no path to pursue**, with each variant's reason.
- A clear best (ahead of the second by more than the margin) → `confirm` re-measures it; if it holds, ending **decision** on the margin.
- Several within noise of the best → `next` returns `decide` with that group. Choose on trade-offs with `decide --choose N --reason "…"`: what each costs to keep, risk, reversibility. Say plainly in the reason that the measurements did not separate them.

## Reporting

The report lists every viable variant with its median, noise, distance from the best, checks and trade-off, marks the choice, and for a grid shows the response surface and each parameter's sensitivity. Fill the "worth adopting?" column with your view. The winner is never merged; the report names its branch.
