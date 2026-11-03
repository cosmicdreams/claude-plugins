# Skill execution demonstration

This disposable fixture supports one Codex demonstration of review-loop, full-stop, then separately authorized full-send. It does not implement a production safeguard or establish long-running agent reliability.

Acceptance: `complete` receives a list of task-status strings. It returns true exactly when the list is nonempty and every status equals `accepted`. Runnable, human-dependent, and failed tasks must prevent completion.

Run the deterministic check from the repository root:

```sh
python3 -m unittest discover -s experiments/skill-invocation -v
```

The seeded implementation used `any` instead of `all`. The check produced three failures before the fix and passed afterward. The seed was corrected before independent review; it is not a reviewer-discovered finding.

Scope: only this directory. The demonstration pull request targets `test/skill-invocation-base-20261103`, never the default branch. Full-stop must leave it open, unmerged, and without auto-merge or merge-queue entry. Full-send requires a separate user instruction before merging that request. No other trials, repository settings, installations, or cleanup are included.

Review budget: three rounds maximum, one reviewer per round, no children. This is a single capability demonstration, with no baseline or repetitions. Trace events and repository state are evidence; this document is not an independent verdict about orchestration behavior.

Evidence note: trailing whitespace was trimmed from `before.txt` after review. Passing subtests are not printed by unittest; the seven cases are defined in `test_completion.py`. The base-scoped whitespace check, rather than an empty working-tree diff, is the verification used for this staged change.
