# Judged Metrics

Operating spec for `metric_type: judged` runs (v1). The metric comes from a panel of model
judges scoring text artifacts, not from a script. Scripted runs ignore this file.

`JUDGED` means `python3 ${CLAUDE_PLUGIN_ROOT}/skills/experiment/scripts/judged.py`. Every
subcommand takes `--engagement <dir> --protocol <methodology.md>` and prints one JSON object.
Exit 1 is a refusal (`{"error": ...}`) and writes nothing: report it and stop; do not work
around it by hand.

Judged runs execute in the orchestrating T3 session. The `experimentalist` agent refuses them.

## Status: blocked

The plan's acceptance smoke test failed on 2026-11-04, so judged runs are refused until a rerun
passes. Its first calibration was invalid for two integration reasons, both since addressed:
the panel omitted an option the host reports (`fastMode: false` for Claude judges; see Panel),
and a judge copied a string placeholder as its score (requests now show a numeric one). The
failure record is in the engagement `analysis-reports/research/experiment-hill-climb/smoke-result.md`.
Lift this block only by rerunning the smoke test and recording a pass here.

---

## Judging Protocol

Methodology section 1 says `metric_type: judged` and `direction: higher`. Section 9 (`## 9.
Judging Protocol`) holds one fenced `judging-protocol` JSON block:

```json
{
  "artifact_command": "scripts/capture.sh",
  "judges": [{"role": "primary", "tier": 5}, {"role": "second", "tier": 5, "distinct_family": true}],
  "categories": {"clarity": "Can a newcomer follow it?",
                 "accuracy": "Is every claim correct?",
                 "brevity": "Is anything unnecessary?"},
  "relative_to": "absolute",
  "references": ["refs/ref-1.md"],
  "target": 9.0,
  "margin_floor": 0.25,
  "max_batch": 3,
  "budget_calls": 60,
  "guardrails": ["scripts/check-links.sh"],
  "iterations": 20,
  "futility": 5
}
```

| Field | Meaning |
|---|---|
| `artifact_command` | `<cmd> <worktree> <out_dir>` writes UTF-8 text files and `<out_dir>/manifest.json` = `{"tree", "files": [{"path", "sha256"}]}`. |
| `judges` | 1–4 roles with a routing tier; `distinct_family` asks for a different model family from the other roles. |
| `categories` | 3–7 criteria, each with a one-line rubric. |
| `relative_to` | `absolute`, or `references`: each cell is scored against the best reference. |
| `references` | Fixed UTF-8 comparison texts, frozen into `references/` at the first `open`. Required for `references`; otherwise used only for drift detection. |
| `target` | Stop value for *M*: (0, 10] absolute, (−10, 10] references. |
| `margin_floor` | Minimum keep margin, [0.25, 5]. Calibration can raise it, never lower it. |
| `max_batch` | Maximum critiques one trial may address (≥ 1). |
| `budget_calls` | Hard cap on judge requests (≥ 2 × judges). |
| `guardrails` | Commands that must pass alongside the correctness checks. |
| `iterations`, `futility` | Iteration budget (default 20) and futility threshold (default 5), both ≥ 1. |

Paths in `artifact_command`, `references` and `guardrails` resolve relative to the directory
holding `methodology.md`, not the worktree, so a candidate cannot change what is captured or
checked. `validate` lists every failure; absolute mode without references passes with a warning
that drift is unmonitored. Tell Chris.

**Protocol fingerprint** covers categories and rubrics, `relative_to`, the reference manifest,
`margin_floor`, `judges`, the capture command and script, guardrails with their files' bytes,
and the methodology's Correctness Checks text. `target`, `budget_calls`, `max_batch`,
`iterations` and `futility` are outside it: raising the target needs no recalibration.

## Panel

Before each `open`, build `panel.json` = `{"<role>": {"provider", "model", "options": {...}}}`
with exactly the protocol's roles. Resolve each role's tier through the global routing table and
`~/.claude/model-access.md` (the denylist); honor `distinct_family`. Run `~/bin/allowance`: a
pool under 10% remaining **pauses** the run (report it and stop). Never substitute another model
for that reason. `options` must list every option the host reports for that model, including
defaults it adds (for example Claude judges report `fastMode: false`); `score` compares them
exactly. The panel changes only when routing or the denylist changes; a changed panel
makes the active calibration stale. Pass the same file to `next` and `open`.

## Metric and keep rule

Judge *j* scores each item in each category *k* from 0 to 10. Cell value *v(j,k)* = the score
(absolute), or the score minus the best reference's score in the same request (references).
**M** = min over all cells.

A measurement scores incumbent *I* and candidate *C* together. **Keep** only when, in that one
measurement: *M(C) − M(I) > m*, every cell *v_C − v_I ≥ −m*, the candidate's checks pass, and
the measurement is valid. Otherwise discard, or invalid. No keep reads a metric from an earlier
measurement.

## Calibration and noise

A calibration (and a confirmation) scores two independent captures of the incumbent against
each other: two requests per judge. Noise = the largest of |v(capture-1) − v(capture-2)| within
a request and |v(capture-i, request 1) − v(capture-i, request 2)|, over every judge and
category. *m* = max(`margin_floor`, noise). Calibrated cell = mean of its four scores;
calibrated *M* = min of those. Reference baseline = mean of each reference cell over both
requests. The margin is a heuristic, not a statistical guarantee.

The active calibration is the latest `calibrate` record. It is **stale** when the panel or
fingerprint changed, or a `withdraw` or tree-adopting `continue` resolution followed it. Stale
calibration withdraws any pending trial and forces a recalibration.

A **confirmation** re-scores the incumbent before `stop target`, because the measurement that
kept it was selected for being high. Only a confirmation newer than the active calibration
counts; one below target lets the climb continue.

## Drift

A measurement or confirmation in which any reference cell moves more than 2*m* from the
calibration's baseline is **invalid** (`drift: true`): no keep, no discard. It is logged
`invalid` and the run pauses. Without references drift is unmonitored and the report says so.

## Budget

Requests count when an evaluation is **opened**: 2 × judges for calibrate or confirm, judges
for measure. Spent = the sum over every evaluation ever opened, whatever its outcome, so a
restart sees the same total. When the next open cannot be afforded, `next` returns `stop
budget`. Report dollar spend when the host provides it, else `unknown`.

## The loop

Call `JUDGED next --worktree W --panel P` only when no judge request is in flight. It writes
nothing and returns one action. Perform it exactly, then call `next` again.

| action | Do |
|---|---|
| `pause` | Report `gate` or `rule` and `reason`. Wait for Chris (see Pauses). |
| `abandon` | `JUDGED abandon --eval E`. |
| `score` | `JUDGED score --eval E`. |
| `invalidate` | `JUDGED invalidate --eval E --reason stale`. |
| `run_checks` | With the worktree at `tree`, run the guardrails and the methodology's correctness checks. Then `JUDGED checks --eval E --worktree W --passed` (or `--failed`) `--details "<summary>"`. |
| `discard_trial` | `python3 ${CLAUDE_PLUGIN_ROOT}/skills/experiment/scripts/discard-trial.py --worktree … --branch … --base … --trial …` with the fields given. A refusal or Git failure leaves the trial unresolved: report and pause. |
| `log` | `${CLAUDE_PLUGIN_ROOT}/scripts/log-iteration.sh` with `args` exactly as given (results path first; 10th is the extras JSON). Never build log arguments by hand. |
| `capture` | `JUDGED capture --worktree W --role <role>`. A result of `invalid` is recorded by the script; call `next`. |
| `open` | Rebuild the panel (above), then `JUDGED open --purpose <purpose> --panel P --seed N` with a new integer seed. Then dispatch every request it lists. |
| `propose` | SKILL.md Steps 2a–2c with the returned `iteration` and `diagnostics`: `trial begin --change`, edit, commit, `trial commit`. A cheap-gate rejection is logged as a `skip` with that iteration via `log-iteration.sh`, with no `trial begin`. |
| `stop` | `reason` is `target`, `budget`, `iterations` or `futility`. Go to SKILL.md Step 3. |

### Dispatch

For each request from `open`, call `mcp__t3-code__delegate_task` with mode wait, the target
(provider, model, options) of the panel role, and the task text = the full contents of its
`request.md`. Add nothing: no paths, target, iteration, or which item is which. Then, in that
request's directory:

- `invocation.json` = `{"provider": <result providerInstanceId>, "model": <result model>,
  "options": {<id>: <value>, …}}`, taken from the delegate **result**, never from the request.
- `return.json` = the JSON object the judge returned, or `{"error": "<what happened>"}` on
  error, timeout or unparseable output. Never invent or repair scores.

A crash mid-dispatch leaves requests without `return.json`; `next` then returns `abandon`.

## Pauses and `resolve`

v1 never recovers automatically. Any `invalid` record (other than reason `stale`) or capture
failure since the latest resolution pauses the run, as do the G1–G3 gates (malformed
`trial.json`, a trial whose worktree, branch, cleanliness or HEAD no longer matches, or an
unknown change to the tree). Report it; Chris (or the agent on his instruction) clears it:

```bash
JUDGED resolve --decision withdraw|retry|continue|reject --note "…" [--worktree W]
```

`continue` and `reject` require `--worktree W` (they record its tree).

| decision | Effect |
|---|---|
| `withdraw` | Requires a pending trial. `next` reverts a committed one through the guarded helper, logs `skip` (`withdrawn: by Chris`), and makes the calibration stale. The change may be proposed again. |
| `retry` | Clears the pause; the failed step runs again (e.g. a new measurement or capture). |
| `continue` | Chris fixed the state by hand. With no pending trial, adopts the current tree as incumbent and makes the calibration stale. |
| `reject` | Human review rejected the incumbent at target (below). |

Withdrawn trials do not consume iterations or move the futility streak.

## Human review

At `stop target`, Chris reviews the incumbent's artifacts. Approval needs no record; the run is
finished. A rejection is `JUDGED resolve --decision reject --note "<why>" --worktree W`: target no longer
stops for that tree, the climb continues, and the note appears in the next diagnostics.

## Diagnostics

`score` writes `critiques.json`, decoded to `incumbent`, `candidate`, `capture-1`, `capture-2`
or the reference name. `propose` returns `diagnostics` items `{eval, kind, text}`: `incumbent`
(critiques of the current incumbent), `tried` (critiques of candidates discarded since), and
`review` (reject notes). Read them with the ranked hypotheses; name the source eval in `change`;
address at most `max_batch` critiques in one commit. Attribution is per batch.

## v1 limits

- **Text only.** Artifacts are UTF-8 text sent inline in the task. Screenshot judging is v2:
  one model family misread a trivial image in testing.
- **Blinding by instruction.** `request.md` omits the target, iteration, item roles and
  engagement paths, and tells the judge not to read files or run commands. `delegate_task`
  cannot give a judge a working directory or make it read-only, so this is not enforced.
- **Tampering.** `score` trusts `mapping.json`, `eval.json` and the calibration result as read
  from disk. A judge or anything else with write access could swap a mapping. Accepted for v1.
- **The margin** is a heuristic, not a significance test.
