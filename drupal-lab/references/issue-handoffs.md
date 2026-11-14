# Issue Handoff Artifacts (JSON)

Stages of issue work hand off through JSON artifacts, not markdown narrative. The JSON file is the machine-readable record the next stage consumes; `analysis-reports/` holds human-readable renders of the same content. The render is for people — never parse it.

Locations (relative to the project root):

```
analysis-reports/drupal-issue/<project>/<id>/analysis.json   # produced by the analyze stage
analysis-reports/drupal-issue/<project>/<id>/results.json    # produced by the reviewer
analysis-reports/drupal-issue/<project>/<id>/analysis.md              # human-readable render
```

## analysis.json

```json
{
  "schema_version": 2,
  "identity": {"project": "drupal", "id": 3456789, "backend": "drupal", "ref": "3456789"},
  "evidence": ["upstream-run/result.json"],
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

## results.json

```json
{
  "schema_version": 2,
  "identity": {"project": "drupal", "id": 3456789, "backend": "drupal", "ref": "3456789"},
  "evidence": ["upstream-run/result.json"],
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

When a review fails, the author answers each finding by number so the reviewer can match response to report.

## Upstream context and compatibility

Read `drupalorg-cli.md` and capture a fresh `issue-context` or `merge-request-context` run. Keep raw request evidence under its run directory and reference it from `evidence`. The source context preserves stable comment/note URLs, original bodies, attachments, prior proposals and explicit missing access; it is not an analysis or a passing review. Set root cause only from code evidence.

Write canonical project-qualified paths only. Existing numeric `analysis-reports/drupal-issue/<id>/analysis.json` or `results.json` can be read when their recorded project matches the resolved identity; never select them just because the number matches. The shared adapter's `analysis_path()` implements this rule for analysis artifacts. Keep old files as historical evidence rather than writing two current copies. Review artifacts without identity require checking their associated analysis project before reuse.

Schema version 2 preserves existing analysis/review fields and adds `identity` and `evidence`. Add remote pipeline details under `remote` in review artifacts, separately from existing local `gates`: source URL, pipeline/revision, all failed jobs, trace evidence and missing facts. Local pass with inaccessible or failing remote evidence is not submission readiness. Original-bug proof still requires fresh local checks through DDEV.

Each analysis patch entry may add `source_comment_id` and `source_url`; a legacy numeric `comment` is optional and must be a verified source number, never an upstream formatter's sequence. For GitLab work items retain `backend`, source project path and actual issue URL rather than fabricating a Drupal.org URL.
