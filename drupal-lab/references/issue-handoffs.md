# Issue Handoff Artifacts (JSON)

Stages of issue work hand off through JSON artifacts, not markdown narrative. The JSON file is
the machine-readable record the next stage consumes; `analysis-reports/` holds human-readable
renders of the same content. The render is for people — never parse it.

Locations (relative to the project root):

```
analysis-reports/drupal-issue/<issue>/analysis.json   # produced by the analyze stage
analysis-reports/drupal-issue/<issue>/plan.json       # produced by the plan stage
analysis-reports/drupal-issue/<issue>/results.json    # produced by the reviewer
analysis-reports/drupal-issue/<issue>.md              # human-readable render
```

## analysis.json

```json
{
  "issue": 3456789,
  "url": "https://www.drupal.org/project/drupal/issues/3456789",
  "title": "string",
  "project": "drupal",
  "status": "string", "priority": "string", "component": "string",
  "problem_summary": "one or two sentences",
  "root_cause": "string or null if not yet identified",
  "affected_files": ["path/one.php"],
  "existing_work": {
    "patches": [{"url": "...", "comment": 12}],
    "merge_requests": [{"url": "...", "status": "open"}]
  },
  "complexity": "simple | medium | complex",
  "test_requirements": "what kinds of tests the fix needs",
  "notes": ["edge cases, dependencies, blockers"]
}
```

## plan.json

The `spec` block is the reviewer's primary reference: outcome statements verifiable from code
and test output alone, no subjective judgment required.

```json
{
  "issue": 3456789,
  "spec": {
    "problem_statement": "observable broken behavior, one sentence",
    "root_cause": "why it happens, with code location",
    "solution_contract": "what a correct implementation must do — outcome, not approach",
    "acceptance_criteria": ["observable outcome a reviewer can verify"]
  },
  "approach": "chosen approach and why, including alternatives rejected",
  "tasks": [
    {
      "title": "string",
      "test_file": "core/modules/x/tests/src/Kernel/ExampleTest.php",
      "test_method": "testMethodName",
      "expected_failure": "why the test fails before implementation",
      "implementation_files": ["path/one.php"]
    }
  ],
  "risks": ["technical or compatibility risks with mitigations"]
}
```

## results.json

```json
{
  "issue": 3456789,
  "verdict": "pass | fail-spec | fail-quality",
  "spec_compliance": {
    "problem_addressed": "yes | no | partial",
    "root_cause_fixed": "yes | no | partial — cite code evidence",
    "solution_contract_met": "yes | no | partial",
    "summary": "one or two sentences"
  },
  "gates": {
    "phpcs": "pass | fail: <detail>",
    "phpstan": "pass | fail: <detail>",
    "phpunit": "pass | fail: <test name + output excerpt>",
    "bug_test": "ClassName::testMethod that proves the original bug is fixed"
  },
  "coverage_gaps": [{"target": "method or path", "risk": "high | medium | low", "suggested_test": "type + sketch"}],
  "findings": [{"name": "short handle", "detail": "what must change", "location": "file:line"}]
}
```

A failed review returns to the issue-worker with `findings` populated; the worker's fix must
name each finding it addressed so the reviewer can match response to report.
