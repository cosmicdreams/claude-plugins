# Strategy: `remediate`

Work through a tool's list of findings (Lighthouse audits, lint, phpstan, an accessibility scan) until none are left except documented exceptions. `experiment.py` enforces every rule below.

## Goal and endings

- `Measure:` prints the count of open findings (an integer), and may also print one `FINDING <id>` line per open finding; `propose` then lists them as `findings`, so you need not run the tool yourself. The methodology defines what counts as a finding for the tool, for example "failed Lighthouse audits", not every opportunity with nonzero savings.
- `Score:` (optional) is the tool's overall score: a command printing it, or `METRIC <name>` to read it from the same `Measure` run (avoids running the tool twice). It is a guardrail, not the goal; with `Runs: 1` its noise margin is 0, so any score drop discards. `Score target:` (optional) is only used to offer a follow-up `climb`.
- Goal: count ≤ `Target:` (default 0) plus the number of recorded exceptions.

Endings: **met** (count reaches the goal on a confirming re-measurement), **exceptions** (met, with exceptions recorded), or **paused** (budget spent or escalation ladder exhausted). When the list is empty but the score is below `Score target:`, the report offers a `climb` on the score; never start it yourself.

## Keep rule

Fixes interact, so remediation keeps a ratchet. A trial keeps when the count strictly falls, `Checks` pass, and the score has not dropped by more than its noise margin. Otherwise it is reverted. A trial that lowers the count but fails a guardrail gets one rework.

## Exceptions

A finding you cannot fix carries the same burden of proof as an unreachable climb: `exception add --finding "<id>" --kind bound|scope --evidence "<why it cannot be fixed within scope>"`. For example, a third-party script outside the scope constraints. Each exception is listed in the report for Chris.

## Proposing

Fix one finding, or one cause shared by several findings, per trial. When open findings outnumber the trials left, batch independent trivial fixes into one trial and name each in `change`. Escalation levels are as in `climb.md`; at level 2 ask another model family which findings share a root cause.
