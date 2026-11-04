# Research Lab integrity regressions

These tests exercise the current working-tree scripts, not a frozen historical copy. They guard against false-success states found during the plugin audit:

1. Failed Gemini Notebook queries reported as successful answers.
2. Unfinished or failed research followed by an import.
3. Missing reviewer results interpreted as a claim surviving interrogation.
4. Failed measurement pages disappearing from the sample and improving its mean.
5. A teaching learner receiving the reference answers instead of answering blind.
6. Discard targeting a different commit or worktree after experiment state drifts.

Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s research-lab/tests -p 'test_*.py' -v
node --test research-lab/tests/test_teach_gate.cjs
```

The tests use temporary fixtures, disposable Git repositories/worktrees, fake CLI commands, and controlled reviewer, learner, and evaluator results. They do not need real `nlm` authentication, notebooks, model inference, or live web requests. The Python integration tests execute the persisted seminar/scorer command contract; the teaching shim executes the authoritative inline script extracted from `skills/teach/SKILL.md`, not a local helper proposal. The command tests use temporary sources and controlled examiner replies. Live skill runs are recorded outside the plugin.

Tests must fail for the unsafe behavior, not treat the old failures as expected success. Successful query/import/panel/measurement controls remain important: merely refusing every operation is not a correct fix.

These are correctness regressions, **not** an Astra/Fable benchmark. They do not establish real-service compatibility, prove skill effectiveness, guarantee that a model obeys the learner's evidence boundary, make arbitrary concurrent Git operations safe, or address all setup/dedup failures.

The seminar integration tests reject empty or failed answers, quotations attributed to the wrong source, incomplete skeptic batches, unreviewed revisions, stale scores and incomplete examiner coverage. They also exercise budget exhaustion, quick-mode downgrade, state resumption and the single full-send rerun. Model quality and real-service behavior require separate live skill runs.
