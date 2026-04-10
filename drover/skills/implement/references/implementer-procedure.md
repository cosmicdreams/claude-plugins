## Input

For general DDEV commands and troubleshooting, see `lib:ddev`.

You will be called with:
- `TICKET_ID` — the Beads ticket ID (e.g. `drover-a1b2c3`)
- `TICKET_BODY` — the full ticket body content
- `CONFIG` — the full `.claude/drover-config.json` content

## Step 1: Claim the ticket

Move ticket to `lane-implementing` immediately:
```bash
export BD_DB=.beads/drover.db
export BD_ACTOR=implementer-agent
bd update {TICKET_ID} \
  --remove-label lane-ready \
  --add-label lane-implementing \
  --append-notes "{ISO_NOW}: Claimed by implementer-agent. Starting implementation."
```

## Step 2: Parse ticket context

Extract from the ticket body:
- `fp` — fingerprint hash (from the JSON fence in ## Latest Context)
- `type` — error type (php, form, js, etc.)
- `message` — error message
- `location` — file:line where error occurs
- `environment` — which environment reported this
- `severity_label` — from ticket title

The `location` field is your primary starting point for finding the code to fix.

## Step 3: Create git worktree

From the project root (the directory containing `worktrees/`):

```bash
# Verify we're at the project root
ls worktrees/main/ > /dev/null 2>&1 || { echo "ERROR: Not at project root"; exit 1; }

FP_HASH="{fp}"
BRANCH="drover/${FP_HASH}"
WORKTREE_PATH="worktrees/drover-${FP_HASH}"

# Check for existing worktree first (idempotent)
if git -C worktrees/main worktree list | grep -q "${WORKTREE_PATH}"; then
  echo "Worktree already exists at ${WORKTREE_PATH}"
else
  # Branch from main explicitly — never from current HEAD or a dirty branch
  git -C worktrees/main worktree add \
    "../../${WORKTREE_PATH}" \
    -b "${BRANCH}" \
    main 2>&1
fi
```

If the worktree add fails with "branch already exists":
```bash
git -C worktrees/main worktree add "../../${WORKTREE_PATH}" "${BRANCH}" 2>&1
```

All subsequent file reads and edits must be inside `{WORKTREE_PATH}/`.

## Step 4: Locate the error source

Use the `location` field from the ticket. The file path is relative to the Drupal root (inside the worktree):

```bash
# Find the file
find {WORKTREE_PATH} -path "*{module_relative_path}*" -name "*.php" 2>/dev/null | head -5
```

Read the file at the reported line number (±20 lines for context):
```bash
# Read the specific file
```

If `location` is empty or the file is not found, search by error message keywords:
```bash
grep -r "{key_term_from_message}" {WORKTREE_PATH}/modules/custom/ --include="*.php" -l 2>/dev/null | head -5
```

## Step 5: Understand the error

Before writing any fix, read:
1. The file at the error location
2. The method/function where the error occurs
3. The callers of that method (use Grep to find call sites)
4. The surrounding watchdog log entries (from ticket body § Surrounding Log Entries)

Categorize the error:
- **PDOException / database error** — missing database field, bad query, connection error
- **TypeError / undefined method** — wrong type assumption, interface mismatch, null check missing
- **Access/permission error** — missing access check, broken service dependency
- **Missing entity/config** — entity that should exist doesn't, config key missing
- **PHP deprecation** — deprecated API usage that became fatal in newer PHP/Drupal version

## Step 6: Implement the fix

Apply a minimal, targeted fix. Do not refactor surrounding code. Do not add unrelated improvements.

Principles:
- Prefer null-safe operators (`??`, `?->`) over verbose null checks for simple cases
- Add defensive guards at the error site, not deeper in the call stack
- For database errors: check if column/table exists before migrating, not in the query itself
- For missing entities: check existence before loading, provide a sensible fallback
- Do not change function signatures unless the signature itself is wrong
- Add a brief inline comment only if the fix is non-obvious (e.g., "Guard against NULL from outdated cache entry")

Write your changes using the Edit tool to modify files inside `{WORKTREE_PATH}/`.

## Step 7: Run quality checks

Load quality_checks config:
```bash
python3 -c "
import json
cfg = json.load(open('.claude/drover-config.json'))
qc = cfg.get('quality_checks', {})
print('phpcs:', qc.get('phpcs', True))
print('phpstan:', qc.get('phpstan', False))
print('use_ddev:', qc.get('use_ddev', True))
"
```

### PHPCS (if enabled)

If `use_ddev: true`:
```bash
cd {WORKTREE_PATH}
ddev exec composer phpcs -- {relative_path_to_changed_file}
```

If `use_ddev: false`:
```bash
cd {WORKTREE_PATH}
./vendor/bin/phpcs {relative_path_to_changed_file}
```

Parse output. If there are PHPCS errors:
1. Read each error carefully
2. Fix the issues (whitespace, docblock style, line length, etc.)
3. Re-run PHPCS
4. Repeat until zero errors

### PHPStan (if enabled)

If `use_ddev: true`:
```bash
cd {WORKTREE_PATH}
ddev exec vendor/bin/phpstan analyze \
  --configuration=./core/phpstan.neon.dist \
  {relative_path_to_changed_file}
```

Parse output. Fix any type errors or undefined symbol references before proceeding.

## Step 8: Write merge case

Update the ticket body to populate the ## Merge Case section:

```bash
export BD_DB=.beads/drover.db
export BD_ACTOR=implementer-agent
bd update {TICKET_ID} --append-notes "
## Merge Case (populated {ISO_NOW})
**Risk:** {Low|Medium|High}
**What was changed:** {one sentence description of the fix}
**Why this fixes it:** {one sentence explanation}
**Worktree:** worktrees/drover-{fp}/
**Files changed:** {list of changed files}
**PHPCS:** {pass|fail — N errors}
**PHPStan:** {pass|fail — N errors|skipped}
**Urgency:** {High|Medium|Low} (based on severity: {severity_label})
"
```

Risk assessment guide:
- **Low** — null guard, missing check, type coercion fix in custom module only, no schema changes
- **Medium** — logic change, hook implementation change, config schema update
- **High** — database schema change, security-related, changes to shared services or core hooks

## Step 9: Move to awaiting-review

```bash
export BD_DB=.beads/drover.db
export BD_ACTOR=implementer-agent
bd update {TICKET_ID} \
  --remove-label lane-implementing \
  --add-label lane-awaiting-review \
  --append-notes "{ISO_NOW}: Implementation complete. Worktree: worktrees/drover-{fp}/. PHPCS: {pass|fail}. Ready for human review."
```

## Step 10: Send notification

Load Slack User ID from global config (v1.1.0 — no email notifications):

```bash
SLACK_USER_ID=$(python3 -c "
import json, os
p = os.path.expanduser('~/.claude/drover-global-config.json')
cfg = json.load(open(p)) if os.path.exists(p) else {}
print(cfg.get('notify', {}).get('slack_user_id', ''))
" 2>/dev/null || echo "")

PROJECT=$(python3 -c "import json; print(json.load(open('.claude/drover-config.json'))['project'])")

if [ -n "$SLACK_USER_ID" ]; then
  gws slack send-dm "$SLACK_USER_ID" \
    "[drover] Fix ready for review: {message[:80]}
Project: $PROJECT | Ticket: {TICKET_ID} | fp:{fp}
Risk: {risk} | PHPCS: {pass|fail} | PHPStan: {pass|skipped|fail}
Worktree: worktrees/drover-{fp}/
Run /drover:board to review"
fi
```

If `slack_user_id` is empty: skip notification silently.

## Step 11: Output summary

```
drover:implementer — {TICKET_ID}
  Error:     {message[:60]}
  Worktree:  worktrees/drover-{fp}/
  Files:     {changed_files}
  PHPCS:     {pass|fail}
  PHPStan:   {pass|skipped|fail}
  Status:    → lane-awaiting-review
  Notified:  {slack_user_id or "none"}
```

## Error Recovery

- **File not found at reported location** — search by error message keywords across `modules/custom/`; if still not found, move ticket back to `lane-triage` with note "location not found in worktree"
- **PHPCS fails repeatedly after 3 fix attempts** — move to `lane-awaiting-review` anyway with note "PHPCS: partial (N remaining errors)" — human reviewer will see it
- **DDEV not running** — move ticket back to `lane-ready` with note "DDEV required but not running"
- **git worktree fails** — check for stale worktree entries: `git -C worktrees/main worktree prune && git -C worktrees/main worktree list`, then retry once
- **Any unrecoverable error** — move ticket to `lane-triage` with detailed error note, do not leave in `lane-implementing`

## Git Policy — ABSOLUTE RULE

NEVER run `git commit`, `git add`, `git merge`, or `git push`.

Your job ends at: implement → quality check → move to lane-awaiting-review → notify.
The user reviews all changes and commits manually.

This rule has NO exceptions.
