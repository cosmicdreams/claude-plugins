---
name: testrail
description: >
  Read TestRail projects, suites, plans, sections, and test cases via the REST API — the
  data layer for turning TestRail cases into Playwright tests.
triggers:
  - "lib:testrail"
  - "testrail plans"
  - "read testrail"
  - "list test cases"
  - "get test plan"
allowed-tools: Bash, Read
---

# lib:testrail — TestRail REST API Wrapper

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> TestRail CLI wrapper — read projects, suites, test plans, sections, and test cases via the TestRail REST API. Thin data layer for converting TestRail cases into Playwright tests. Trigger phrases: "lib:testrail", "testrail plans", "read testrail", "list test cases", "get test plan".

Thin wrapper around the TestRail REST API using `curl`. No test conversion logic here — returns raw JSON for the calling skill or user to process into Playwright tests.

## Authentication and helper

Use `scripts/testrail.py` from this skill's directory for every request. It requires Python 3.9+ and curl; 1Password and Keychain are optional credential sources. Resolve `TR` to the script beside this SKILL.md, including when the plugin is installed in a versioned cache:

```bash
TR="<absolute-path-to-this-skill>/scripts/testrail.py"
python3 "$TR" whoami
python3 "$TR" whoami --account shared --project 93
```

Read `~/.claude/office-testrail.local.md` for non-secret settings; see `references/config-template.md`. The helper resolves credentials in this order:

1. `op_item_default` (or `op_item`) for the default account; `op_item_shared` for `--account shared`. References must name a vault and item ID, never a title. Read both `/username` and `/password` from the same item. Each `op` call has a 15-second timeout (adjust with `--op-timeout`, maximum 60 seconds).
2. A complete `TESTRAIL_URL`, `TESTRAIL_USERNAME`, `TESTRAIL_API_KEY` environment tuple, matching QA-AI's convention. This works without a config file.
3. Config `host` and email `username`, with the key from macOS Keychain service `testrail`, looked up by that email.

A configured 1Password item that fails stops resolution with its own error. Partial environment credentials also stop with an error. Never silently switch accounts after a failure. Named accounts require their own `op_item_<account>`; they never fall back to the default account's credentials.

Every call reports account name, credential source, authenticated email and total visible project count to stderr. `whoami` returns user details, project count and visible project IDs as JSON. Authentication uses `get_user_by_email&email=<login-email>` followed by all pages of `get_projects`. A 401 means credentials were rejected; do not describe that as authenticated. If authentication succeeds but a requested project is absent, report “authenticated as X, which can't see project Y.”

Choose the account explicitly when projects are missing; do not assume TestRail is unavailable. For project-scoped endpoints the helper checks visibility automatically. For a plan, case or run whose project is known, pass `--project ID`. If no project was given and config has `default_project_id`, pass that ID for project-scoped operations.

Secrets stay in memory. The helper supplies credentials through `curl -K -` on stdin, disables curl's user config and bounds network calls. Never run `op read` directly in a transcript, put credentials in shell variables or argv, enable tracing, or print curl's config. Config and helper errors never include raw credential-provider diagnostics or HTTP response bodies.

---

## Operations

### List projects

```bash
python3 "$TR" "get_projects"
```

Returns all visible projects as an array (the helper collects every page). Present as a table: `ID | Name | Suite Mode`.

### List suites for a project

```bash
python3 "$TR" "get_suites/$PROJECT_ID"
```

Returns array of suites. Each suite has `id`, `name`, `description`.

### List test plans for a project

```bash
python3 "$TR" "get_plans/$PROJECT_ID"
```

Supports optional filters appended as query params:
- `&is_completed=0` — active plans only
- `&milestone_id=N` — filter by milestone

Returns array of plans with `id`, `name`, `description`, `milestone_id`, `is_completed`.

### Get a test plan (with runs)

```bash
python3 "$TR" "get_plan/$PLAN_ID"
```

Returns the plan object with an `entries` array. Each entry contains:
- `suite_id`, `name` — the suite being tested
- `runs` array — each run has `id`, `config`, `case_ids` (if filtered)

### List sections (for describe-block hierarchy)

```bash
python3 "$TR" "get_sections/$PROJECT_ID&suite_id=$SUITE_ID"
```

Returns sections with `id`, `name`, `parent_id`, `depth`. Use this to reconstruct the `describe` block nesting when generating Playwright tests.

### List test cases

```bash
python3 "$TR" "get_cases/$PROJECT_ID&suite_id=$SUITE_ID"
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
python3 "$TR" "get_case/$CASE_ID"
```

Use this when `get_cases` returns truncated step data.

### List cases in a specific test run

```bash
python3 "$TR" "get_tests/$RUN_ID"
```

Returns the cases actually included in a run (respects any case filters on the run). Useful when a plan entry limits to a subset of suite cases.

---

## Pagination

`get_projects` is collected automatically for identity checks and project listings. Other operations return one raw response at a time.

TestRail paginates large result sets. Check for `_links.next` in the response:

```bash
RESPONSE=$(python3 "$TR" "get_cases/$PROJECT_ID&suite_id=$SUITE_ID&limit=250&offset=0")
# Check: echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('_links',{}).get('next',''))"
```

If `next` is non-empty, fetch subsequent pages with the same `--account` by incrementing `offset` until exhausted. For large suites, collect all pages before returning.

---

## Output

Use `--account shared` (or another configured account suffix) on every call that needs that account. Stdout is JSON; stderr identifies the selected account and errors.

Return raw JSON to the caller. Do not summarize, filter, or convert — the caller (user prompt or a higher-level skill) owns all Playwright generation logic.

When invoked interactively (user runs `lib:testrail` directly), present results as clean Markdown tables. Never dump raw JSON at the user unless they ask for it.

---

## Error handling

| Condition | Action |
|---|---|
| Empty/missing config and no environment tuple | Show config-template or the three environment variable names |
| Invalid 1Password item/field | Check vault and item ID, and username/password fields |
| 1Password lookup timeout | Report “1Password locked or not signed in”; unlock/sign in outside the read call |
| Missing named account | Set its `op_item_<account>`; do not use a different account silently |
| Partial environment tuple | Supply all three QA-AI variables together |
| Non-email username | Use the TestRail login email; never `Chris.Weber` |
| HTTP 401 | Credentials rejected for the selected login; check that item's password/API key |
| Missing project after successful authentication | Report the authenticated email and inaccessible project ID; select another configured account explicitly |
| HTTP 403 / 404 | Permission denied / ID missing or inaccessible; include the selected login |
| HTTP 429 | Helper waits 60 seconds and retries once |
| Network error, timeout, invalid JSON or API error | Report the helper's safe error and stop |
