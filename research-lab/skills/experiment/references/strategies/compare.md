# Strategy: `compare`

Choose between variants and say what each costs. There is no incumbent to beat step by step and no target: the output is a decision with its trade-offs, or "no path to pursue". `experiment.py` enforces every rule below.

## Variants

`Variants:` in the methodology picks the mode:

- **given**: one `Variant <name>:` line per option you were handed (for example Redis vs database cache). Build each one.
- **generated**: write `Count:` variants of the stated `Idea:`. Make them genuinely different answers to the idea, each differing in one main choice, so the comparison says something. A redesign of the current approach is a generated variant.
- **grid**: `Grid <param>:` lines and an `Apply:` command; the script builds every point itself (`build-grid`). Use it for tuning known settings. `{param}` in `Apply` is replaced already shell-quoted: do not put quotes around it, and do not write `${…}`.
- `Include incumbent: yes` measures the unchanged base too, so "none of these beats what we have" is a possible answer.

Each variant is one commit on the base, on its own branch `<branch>--<name>`; the experiment branch never moves. Every command takes `--engagement E`:

| Action | Command |
|---|---|
| `add-variants` | `EXP variant begin --engagement E --name N --tradeoff "…"` (generated mode also `--description "…"`), edit in `W`, `EXP variant commit --engagement E`. The action's `remaining` says what is still to build. `EXP variant discard --engagement E --name N` drops one before measuring. |
| `build-grid` | `EXP grid build --engagement E` |
| `measure` | `EXP measure --engagement E` (long: run it in the foreground) |
| `confirm` | `EXP confirm --engagement E` |
| `decide` | `EXP decide --engagement E --choose N --reason "…"` |

## Measuring and deciding

The margin is `Margin:` when set, else twice the pooled median absolute deviation of the variants' runs. Set `Margin:` when the metric is coarsely rounded or noisier than a few runs show, so one rounding step cannot separate variants.

`measure` runs every variant `Runs` times in an interleaved, seeded order, so drift over time spreads across all of them. A variant whose measurement fails is marked invalid, and one that fails `Checks` is marked as failing; the others continue.

Among viable variants:

- None viable, or none beats the incumbent by more than the margin when it is included → ending **no path to pursue**, with each variant's reason.
- A clear best (ahead of the second by more than the margin) → `confirm` re-measures it; if it holds, ending **decision** on the margin.
- Several within noise of the best → `next` returns `decide` with that group. Choose on trade-offs with `decide --choose N --reason "…"`: what each costs to keep, risk, reversibility. Say plainly in the reason that the measurements did not separate them.

## Reporting

The report lists every viable variant with its median, noise, distance from the best, checks and trade-off, marks the choice, and for a grid shows the response surface and each parameter's sensitivity. Fill the "worth adopting?" column with your view. The winner is never merged; the report names its branch.
