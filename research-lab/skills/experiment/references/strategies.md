# Strategies: router, card and preload

Every run has a **strategy** (how candidates are generated, accepted and ended) and a **scorer** (how they are measured), chosen separately. `CHECK` below means `python3 ${CLAUDE_PLUGIN_ROOT}/skills/experiment/scripts/experiment.py check`.

## Strategies

| Strategy | Question it answers | Goal | Ends | Status |
|---|---|---|---|---|
| `remediate` | Work through this tool's findings | findings = 0 except documented exceptions | met · exceptions with evidence · paused | **runs** (scripted) |
| `climb` | Get this artifact to a target | metric, direction, numeric target | met (confirmed) · unreachable with evidence · paused | **runs** (scripted) |
| `compare` | Which of these is better, and at what cost? | no target; a preregistered primary metric and decision rule | decision with trade-offs · no path to pursue | **runs** (scripted) |
| `explore` | What's possible here? | none | budget spent; a ranked gallery | **runs** (scripted or council) |

Scorers: `scripted` (a trusted number from a script) or `council` (cross-family judges anchored to references; `metric_type: judged` in a methodology means `council`). `council` runs for `climb`, `compare` and `explore` on the transports listed in `council-status.json` (T3, or direct CLI calls without T3).

A redesign is not a strategy: it is `compare` with a generated variant, or a `climb`'s last escalation rung.

## Preload

Args `strategy=<name|auto>` and `scorer=<scripted|council|auto>`, or the same as `strategy:` / `scorer:` lines in the methodology. Precedence: **argument > methodology > router**. Run:

```bash
CHECK [--strategy S] [--scorer C] [--methodology M]
```

It prints JSON `{status, strategy, scorer, source, missing, reason}`:

- `ready` (exit 0): proceed, no pause. When `source.scorer` is `default` (a strategy was preloaded without a scorer), ask the router's scorer question; if it says `council`, re-run with `--scorer council`.
- `route` (exit 2): no strategy was given. Run the router below, show the card, pause.
- `refused` (exit 1): STOP and report `reason` and every `missing` item. Never fill a missing input by guessing.

A preloaded strategy skips the pause. If your own reading of the request (router below) would pick differently, write `router_disagrees: <strategy> because <reason>` in `strategy.md` and continue; it goes in the report, it does not block.

## Router

Ask in order; the first yes wins. Each answer cites evidence (a quote from the request, a file, a tool output).

1. **Is the answer already known** — a plan, spec or design to implement, tests to make pass? → **not an experiment.** Stop. Say so in one line and build it from current context; no experiment files, no hand-off to another plugin.
2. **Is there a tool's list of findings to work through** (Lighthouse audits, lint, phpstan, accessibility scan)? → `remediate`.
3. **Are there alternatives to choose between,** given or to be generated, including a grid of settings? → `compare`.
4. **Is there one artifact to improve toward a numeric target?** → `climb`.
5. **Is there no imaginable goal, only "what's possible here"?** → `explore`.

Then the scorer: **can a script produce a number you trust for this?** → `scripted`; otherwise (quality only recognisable by judgment: UI, copy, plan quality) → `council`. A `council` run may still have `scripted` guardrails.

Hints, not rules: "implement the plan", "until the tests pass" → 1. "track down / fix the
<tool> feedback" → 2. "X vs Y", "which is better", "try these settings" → 3. "get X to N",
"under 200 ms" → 4. "see what we could do with" → 5. The word "experiment" or "optimize" in a request decides nothing by itself.

A "get it to N" request that has no number yet is still `climb`: put the missing target on the card and ask for it at the pause.

## Strategy card

Write it to `strategy.md` in the engagement directory and show it:

```markdown
# Strategy card
- Strategy · scorer: climb · scripted
- Router answers: 1 no (…evidence…); 2 no (…); 3 no (…); 4 yes (…)
- Scorer: scripted, because <the trusted number and where it comes from>
- Goal: <metric, direction, target> | none (compare/explore) | findings = 0 (remediate)
- Guardrails: <checks that must keep passing>
- Scope: <may change> / <off-limits>
- Rejected: remediate — <one line>; compare — <one line>; explore — <one line>
- Budget: <iterations or judge requests>
- Hands back: <ending options and the report>
- Hand-off: <planned follow-on strategy, or none>
- Status: <runs | not built yet | blocked>
```

Then **pause**: Chris answers accept, edit (any field) or switch. After acceptance re-run `CHECK` with the accepted strategy and scorer; the run is unattended from there. If the accepted strategy or scorer is not built or blocked, stop after the card and say so.

## Fixtures

The router's acceptance cases:

| Request | Strategy · scorer |
|---|---|
| Implement the experiment skill faithfully from the plan | not an experiment |
| Track down Lighthouse feedback and remedy it | remediate · scripted |
| Get Lighthouse performance ≥ 90 on /home | climb · scripted |
| Improve T3 Code's layout (a UI hill climb) | climb · council, scripted guardrails |
| Same builder vs fresh agent for review fixes, 10 replayed PRs | compare · council |
| Redis vs database cache | compare · scripted |
| "See what we could do with the homepage hero" | explore · council |
