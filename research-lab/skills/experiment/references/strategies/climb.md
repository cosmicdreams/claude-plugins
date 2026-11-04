# Strategy: `climb`

Get one artifact to a numeric target by small, attributable changes. The incumbent is a commit; each trial is measured against it and kept only when it beats it by more than noise. `experiment.py` enforces every rule below; this page tells you what its actions mean and how to propose.

## Goal and endings

The methodology states `Target:`, `Direction:` and `Budget:`; `Measure:` prints the metric and `Checks:` exits 0 when guardrails pass. A climb ends in exactly one of three ways:

1. **Met.** The incumbent reaches the target on a confirming re-measurement (`next` returns `confirm` first). The only success.
2. **Unreachable, with evidence.** You found a *bound* (a measured floor or ceiling the target lies beyond) or a *scope block* (profiling puts the cost in something off-limits). Run `conclude --kind bound|scope --evidence "<what you measured and how>"`. Chris decides whether to widen scope or change the target.
3. **Paused, goal still open.** The budget is spent, or the escalation ladder is exhausted. Reported as unfinished, never as done.

A target beyond a methodology `Bound:` is refused before the climb starts.

## Keep rule

- Keep when the gain over the incumbent exceeds the margin (`Margin:`, or twice the median absolute deviation of the baseline runs) and `Checks` pass. Equal or worse is a discard.
- **Tie-break**, only when the methodology declares `Tiebreak:` (a simplicity measure, lower is simpler) and `Readability:`: a candidate within the margin is kept when it is strictly simpler and readable.
- **Guard retry:** a candidate that gains but fails `Checks` gets one rework (`next` returns `rework`); the rework amends the same trial commit. A second failure discards it.

## Proposing at each escalation level

After `Futility:` (default 5) discards in a row, the level rises and the count resets. `propose` returns the level:

| Level | Propose |
|---|---|
| 0 small changes | One local change from the ranked hypotheses. |
| 1 larger structural changes | Restructure the part that dominates the metric; still one idea per trial. |
| 2 fresh hypotheses from another model family | Ask a model of another family for a new hypothesis list, giving it the methodology and `results.jsonl`; take ideas from that list. |
| 3 restart from a different design | One trial that replaces the approach (a redesign), measured against the incumbent like any other. |

Past level 3 the run pauses. Before proposing at levels 2–3, check whether what you have learned amounts to a bound or scope block; if it does, `conclude` instead.

## Tradeoff

Every trial carries one sentence on what keeping it costs: added complexity, a new dependency, changed behavior, maintenance. It becomes a row in the report's "Decisions to review".
