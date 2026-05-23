---
name: branch-audit
description: >
  Diff what JIRA claims is in a sprint or release against what is actually
  merged into the corresponding branch. Produces a delta report PMs can use
  as ground truth for status communication. Use when verifying whether a
  release branch contains the work it should, when a PM asks "is X in the
  release", before deploying a sprint or release branch, or when the user
  says "audit sprint X", "audit release Y", "what's actually in this branch",
  "prove what's in the release". Do NOT use for code review or merge conflict
  analysis.
allowed-tools: Bash, Read, Write
---

# drupal-lab:branch-audit — Prove what's actually in a sprint or release branch

Reads the JIRA-side expectation (from the live sprint or release ticket) and
the git-side reality (merged feature branches), then prints a three-column
delta: **JIRA says · branch has · status**.

PMs read the bottom-line delta to communicate sprint/release status without
guessing.

## Prerequisites

- `~/.claude/drupal-lab.json`, project has `team_flow.enabled = true`.
- `jira` CLI configured.
- Local repo has fetched recent state (`git fetch origin --prune`).

## Inputs

- **Branch name** (required) — `sprint/<slug>` or `release/<slug>`.
  Accepts the short slug too; the skill will prepend `sprint/` or `release/`
  based on which manifest exists.
- **Optional flags**:
  - `--re-query` — ignore the manifest's `expected_tickets` and re-query JIRA
    for current state (default behavior; pass `--frozen` to compare against
    the manifest as captured at cut time).
  - `--json` — emit JSON instead of the human table.

## Workflow

### 1. Resolve project context

Read `~/.claude/drupal-lab.json`. Fail if `team_flow.enabled` is not true.

### 2. Locate the manifest

Look for `.drupal-lab/sprints/<slug>.json` or `.drupal-lab/releases/<slug>.json`.

If neither exists, the branch was not created via the team-flow skills.
Continue without a manifest — derive the JIRA side by parsing the branch name:

- `sprint/<slug>` → query `jira sprint list` for a sprint whose slugified name matches `<slug>`
- `release/<slug>` → ask the user for the release ticket key (we can't infer it)

Tell the user we proceeded without a manifest and recommend rerunning
`drupal-lab:sprint-start` / `drupal-lab:release-cut` to fix the gap.

### 3. Compute the JIRA side (expected)

**Sprint:**
```bash
jira issue list --jql "sprint = <SPRINT_ID>" \
  --plain --no-headers --no-truncate \
  --columns TYPE,KEY,SUMMARY,STATUS
```

**Release:**
```bash
jira issue list --jql "issue in linkedIssues(<RELEASE_KEY>)" \
  --plain --no-headers --no-truncate \
  --columns TYPE,KEY,SUMMARY,STATUS
```

Filter to deliverable types (`Story`, `Task`, `Bug`).

If `--frozen`, skip this step and use `manifest.expected_tickets` instead.

### 4. Compute the git side (actual)

List feature branches merged into the audit branch since it diverged from main:

```bash
git fetch origin --prune
git log --merges --pretty=format:'%H%x09%s' main..origin/<branch>
```

Each merge commit message typically reads `Merge branch 'features/PROJ-123' …`.
Extract the feature branch name. From each branch name, recover the JIRA key
using the mapping in `references/feature-branch-mapping.md`:

1. `features/<KEY>` → `<KEY>`
2. `features/<KEY>-*` → `<KEY>` (capture leading uppercase token matching `[A-Z]+-[0-9]+`)
3. `features/<descriptive>` with no key → record as `(unkeyed)` and surface in the report

Also detect direct commits to the audit branch that are *not* merge commits:

```bash
git log --no-merges --first-parent --pretty=format:'%H%x09%an%x09%s' main..origin/<branch>
```

Any non-merge commit here is suspicious — work landed directly on
`sprint/*`/`release/*` instead of via a feature branch. Surface those
in a "direct commits" section.

### 5. Reconcile

For each expected ticket:
- If a matching feature branch is merged → **IN**
- If no matching branch is merged → **MISSING**

For each merged feature branch:
- If the recovered key is in the expected set → **IN** (already counted)
- If the recovered key is NOT in the expected set → **EXTRA**
- If the branch had no recoverable key → **UNKEYED**

### 6. Output

Human format (default):

```
Branch:   release/sprint-47-checkout-v2
JIRA src: release ticket PROJ-2200 (Fix Version: 4.1)
Cut from: main @ a1b2c3d (2026-05-12T14:03Z)
Audited:  2026-05-23T15:42Z (live JIRA re-query)

EXPECTED IN BRANCH    BRANCH STATE          STATUS
PROJ-101              features/PROJ-101     ✓ IN
PROJ-102              features/PROJ-102     ✓ IN
PROJ-103              —                     ✗ MISSING
                      features/PROJ-150     ⚠ EXTRA (not in release ticket)
                      features/hotfix-css   ⚠ UNKEYED (no JIRA reference)

Direct commits on branch (should be zero):
  9f8e7d6  Dan Rockwood   fix: tweak header padding

Summary:
  ✓ 2 expected features present
  ✗ 1 expected feature missing
  ⚠ 1 extra feature merged
  ⚠ 1 unkeyed merge
  ⚠ 1 direct commit
```

JSON format (`--json`): structured equivalent with stable field names
(`expected`, `merged`, `missing`, `extra`, `unkeyed`, `direct_commits`).

### 7. Suggest next steps

If MISSING tickets exist:
- For each, check the ticket's JIRA status. If status is "Done" or "Ready
  for Release" yet the branch lacks it, that's a communication gap to surface
  to the PM.
- If status is "In Progress", that's expected and the report can note it.

If EXTRA tickets exist: the merged work isn't in the approved scope. Surface
to the PM — they may need to update the ticket links or the team needs to
back out the merge.

If direct commits exist: name the author and ask the PM to file a follow-up
to ensure the work is captured as a proper feature ticket.

## Failure modes

- Branch doesn't exist locally or on origin → fetch and retry; if still
  missing, fail.
- Audit branch has no merge commits at all (linear history from main) → the
  team may not be using `--no-ff`; suggest `drupal-lab:release-cut` for
  future releases. Still attempt to identify feature branches from commit
  prefixes if possible.
- JIRA returns zero tickets → don't print an empty "all in" report; tell
  the user no expected scope was found.
