# Changelog

## 1.5.3
- Add pattern analysis phase to fixer pre-patch investigation — find working case, read completely, list every difference, form one hypothesis before stating root cause (closes final Superpowers systematic-debugging gap)

## 1.5.2
- Add receiving-code-review section to implementer — name each finding before fixing, explicit disagreement over silent compliance, resubmit message must reference findings by name

## 1.5.1
- Add verification-before-completion to fixer (step 5.5 "Close the Loop" — re-run the original failing test before reporting done) and implementer (checklist step + `bug-test` field in handoff message format)

## 1.5.0
- Add drupal-lab:finish-issue skill — 4-path worktree lifecycle closer (submit as MR, submit as patch, keep as WIP, discard); integrates with issue-summary for contribution comments and process-lifecycle for DDEV cleanup

## 1.4.0
- Add drupal-lab:reviewer agent with two-phase review: Phase 1 spec compliance (reads analysis report, fetches drupal.org issue and MRs, states explicit verdict before any tooling) and Phase 2 code quality (PHPCS, PHPStan, PHPUnit)
- Remove qa-validator agent — replaced by reviewer with broader mandate
- Rename kanban lanes: 4_needs-qa → 4_needs-review, 5_validating → 5_reviewing, 6_qa-failed → 6_review-failed
- Add root cause gate to fixer agent — explicit "The bug is X because Y" required before any patch attempt
- Add TDD requirement to implementer agent — red-green-refactor cycle with ddev phpunit commands
- Add worktree baseline prerequisite to implementer — ddev phpunit must pass before writing code
- Add spec output section to issue-planner — problem statement, root cause, solution contract, acceptance criteria
- Add 3-fix escalation rule to fixer and deep-debugger agents
- Rewrite drupal-lab skill descriptions as triggering conditions (CSO audit)

## 1.3.0
- Add git guard hook (PreToolUse) — blocks agents from running `git add`, `git commit`, or `git push`; bootstraps hooks infrastructure for drupal-lab
- Add Error Recovery sections to all 8 drupal-lab agents with role-specific transient/permanent error classification and escalation paths
- Add opt-in Context Retrieval section to implementer and qa-validator referencing ITERATIVE-RETRIEVAL.md protocol

## 1.2.4
- Add release-notes skill — displays CHANGELOG with `--latest` and `--since X.Y.Z` filtering for humans and agents

## 1.2.3
- Pre-sprint cleanup pass
- Add config keys post_update hook requirement to implementer pre-QA checklist

## 1.2.2
- Introduce needs-qa/qa-failed status vocabulary in agent definitions

## 1.2.1
- Git policy guard-rails
- phpcs.xml sync improvements

## 1.2.0
- New skills: retro-interviews integration, issue-summary, validate-patch
- Align with agent-squad process-improvement independence
