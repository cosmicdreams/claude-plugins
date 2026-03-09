---
name: testrail
description: >
  TestRail CLI wrapper — read projects, suites, test plans, sections, and test cases
  via the TestRail REST API. Thin data layer for converting TestRail cases into
  Playwright tests. Trigger phrases: "office:testrail", "testrail plans",
  "read testrail", "list test cases", "get test plan".
triggers:
  - "office:testrail"
  - "testrail plans"
  - "read testrail"
  - "list test cases"
  - "get test plan"
allowed-tools: Bash, Read
---

# office:testrail — TestRail REST API Wrapper

Thin wrapper around the TestRail REST API using `curl`. No test conversion logic here —
returns raw JSON for the calling skill or user to process into Playwright tests.

## Authentication

### Step 1 — Load non-secret config

Read `~/.claude/office-testrail.local.md` for `host`, `username`, and optionally `default_project_id`:

```bash
CONFIG=~/.claude/office-testrail.local.md
HOST=$(awk '/^host:/{print $2}' "$CONFIG" 2>/dev/null | tr -d "'\"")
USERNAME=$(awk '/^username:/{print $2}' "$CONFIG" 2>/dev/null | tr -d "'\"")
```

If the file does not exist or `host`/`username` are empty, output:

> `office:testrail` is not configured.
> Create `~/.claude/office-testrail.local.md` — see `references/config-template.md`.

### Step 2 — Resolve API key (never stored in a file)

Try each source in order, stopping at the first hit:

**1. 1Password CLI** (recommended — `op` is installed):
```bash
API_KEY=$(op read "op://Private/TestRail/credential" 2>/dev/null)
```

**2. macOS Keychain** (fallback — encrypted, Touch ID protected):
```bash
if [ -z "$API_KEY" ]; then
  API_KEY=$(security find-generic-password -s "testrail" -a "$USERNAME" -w 2>/dev/null)
fi
```

**3. Environment variable** (fallback):
```bash
if [ -z "$API_KEY" ]; then
  API_KEY="${TESTRAIL_API_KEY:-}"
fi
```

If `API_KEY` is still empty after all three, tell the user:

> No TestRail API key found. Store it using one of these methods:
>
> **1Password CLI (recommended — already installed):**
> ```bash
> op signin   # first-time account setup
> op item create --category login --title "TestRail" \
>   --field "username=your@email.com" \
>   --field "credential=your-api-key"
> # skill reads it as: op://Private/TestRail/credential
> ```
> **macOS Keychain:**
> ```bash
> security add-generic-password -s "testrail" -a "your@email.com" -w "your-api-key"
> ```
> **Environment variable** (add to `~/.zshrc`):
> ```bash
> export TESTRAIL_API_KEY="your-api-key"
> ```

### Step 3 — Verify auth

```bash
curl -sf --path-as-is -u "$USERNAME:$API_KEY" \
  "https://$HOST/index.php?/api/v2/get_current_user" -o /dev/null
```

If non-zero or HTTP 401/403:

> Authentication failed. Verify your username and API key are correct.
> API keys are generated in TestRail under My Settings → API Keys.

## Helper

Set these variables once at the top of every session:

```bash
TR_BASE="https://$HOST/index.php?/api/v2"
TR_AUTH="$USERNAME:$API_KEY"
```

All API calls use: `curl -sf --path-as-is -u "$TR_AUTH" "$TR_BASE/<endpoint>"`

A non-zero curl exit or an HTTP error response containing `"error"` key means the call
failed — report the error message and stop.

---

## Operations

### List projects

```bash
curl -sf --path-as-is -u "$TR_AUTH" "$TR_BASE/get_projects"
```

Returns array of projects. Present as a table: `ID | Name | Suite Mode`.

### List suites for a project

```bash
curl -sf --path-as-is -u "$TR_AUTH" "$TR_BASE/get_suites/$PROJECT_ID"
```

Returns array of suites. Each suite has `id`, `name`, `description`.

### List test plans for a project

```bash
curl -sf --path-as-is -u "$TR_AUTH" "$TR_BASE/get_plans/$PROJECT_ID"
```

Supports optional filters appended as query params:
- `&is_completed=0` — active plans only
- `&milestone_id=N` — filter by milestone

Returns array of plans with `id`, `name`, `description`, `milestone_id`, `is_completed`.

### Get a test plan (with runs)

```bash
curl -sf --path-as-is -u "$TR_AUTH" "$TR_BASE/get_plan/$PLAN_ID"
```

Returns the plan object with an `entries` array. Each entry contains:
- `suite_id`, `name` — the suite being tested
- `runs` array — each run has `id`, `config`, `case_ids` (if filtered)

### List sections (for describe-block hierarchy)

```bash
curl -sf --path-as-is -u "$TR_AUTH" "$TR_BASE/get_sections/$PROJECT_ID&suite_id=$SUITE_ID"
```

Returns sections with `id`, `name`, `parent_id`, `depth`. Use this to reconstruct
the `describe` block nesting when generating Playwright tests.

### List test cases

```bash
curl -sf --path-as-is -u "$TR_AUTH" "$TR_BASE/get_cases/$PROJECT_ID&suite_id=$SUITE_ID"
```

Optional filters:
- `&section_id=$SECTION_ID` — cases in a specific section only
- `&type_id=$TYPE_ID` — filter by case type
- `&priority_id=$PRIORITY_ID` — filter by priority

Key fields per case:
| Field | Playwright use |
|---|---|
| `id` | test ID / annotation |
| `title` | `test('...')` name |
| `section_id` | maps to `describe` block |
| `custom_preconds` | `beforeEach` setup |
| `custom_steps` | test body (plain text steps) |
| `custom_steps_separated` | test body (step + expected pairs → actions + assertions) |
| `custom_expected` | final assertion |
| `priority_id` | `test.slow()` or skip annotation |
| `refs` | ticket/requirement annotation |

### Get a single test case (full detail)

```bash
curl -sf --path-as-is -u "$TR_AUTH" "$TR_BASE/get_case/$CASE_ID"
```

Use this when `get_cases` returns truncated step data.

### List cases in a specific test run

```bash
curl -sf --path-as-is -u "$TR_AUTH" "$TR_BASE/get_tests/$RUN_ID"
```

Returns the cases actually included in a run (respects any case filters on the run).
Useful when a plan entry limits to a subset of suite cases.

---

## Pagination

TestRail paginates large result sets. Check for `_links.next` in the response:

```bash
RESPONSE=$(curl -sf --path-as-is -u "$TR_AUTH" "$TR_BASE/get_cases/$PROJECT_ID&suite_id=$SUITE_ID&limit=250&offset=0")
# Check: echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('_links',{}).get('next',''))"
```

If `next` is non-empty, fetch subsequent pages by incrementing `offset` until exhausted.
For large suites, collect all pages before returning.

---

## Output

Return raw JSON to the caller. Do not summarize, filter, or convert — the caller
(user prompt or a higher-level skill) owns all Playwright generation logic.

When invoked interactively (user runs `office:testrail` directly), present results
as clean Markdown tables. Never dump raw JSON at the user unless they ask for it.

---

## Error handling

| Condition | Action |
|---|---|
| Config file missing or incomplete | Prompt to create with config-template |
| API key not found in any source | Show three setup options (Keychain, env var, 1Password) |
| HTTP 401 / 403 | Auth failure — check username and API key |
| HTTP 429 | Rate limited — wait 60s and retry once |
| HTTP 404 | Invalid ID — tell user which ID was not found |
| `curl: command not found` | Should never happen on macOS — report and stop |
| `"error"` key in JSON response | Extract and display the error message, stop |
