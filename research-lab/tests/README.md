# Research Lab failure-integrity regressions

These tests exercise the current working-tree scripts, not a frozen historical
copy. They guard against four false-success states found during the plugin audit:

1. Failed Gemini Notebook queries reported as successful answers.
2. Unfinished or failed research followed by an import.
3. Missing reviewer results interpreted as a claim surviving interrogation.
4. Failed measurement pages disappearing from the sample and improving its mean.

Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s research-lab/tests -p 'test_*.py' -v
node --test research-lab/tests/test_interrogate_panel.cjs
```

The tests use temporary fixtures, fake CLI commands, and controlled reviewer
results. They do not need real `nlm` authentication, notebooks, model inference,
or live web requests. The panel shim executes the script's decision logic; it
does not establish compatibility with a particular host's Workflow API.

Tests must fail for the unsafe behavior, not treat the old failures as expected
success. Successful query/import/panel/measurement controls remain important:
merely refusing every operation is not a correct fix.

These are correctness regressions, **not** an Astra/Fable benchmark. They do not
establish real-service compatibility, prove skill effectiveness, or address
teaching-gate leakage, experiment rollback ownership, or all setup/dedup failures.
