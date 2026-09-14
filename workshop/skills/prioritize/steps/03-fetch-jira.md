# Step 3 — Fetch Jira: Spawn Per-Server Subagents

If no Jira servers are configured, skip to `steps/04-fetch-availability.md`.

Spawn one subagent per Jira server, all simultaneously. Wait for all to return
before proceeding to scoring.

## Goal

Surface Jira items that need your attention today, **scoped to committed work first**.
Three passes:

0. **Scope pass**: which issues are in an open sprint or an unreleased fix version.
   This is the committed work — what the team has actually agreed to deliver.
1. **Delta pass**: what changed overnight — new comments, status transitions, new
   assignments since LAST_RUN_DATE
2. **Attention pass**: standing obligations regardless of recency — blocked issues
   you own, due-today/overdue issues, high-priority items assigned to you with no recent activity, anything
   in progress for an unusually long time

**Why the scope pass matters.** A long-lived assignee queue accumulates tickets that
were assigned years ago and never planned into anything. Those must not outrank work
in the current sprint or release. The scope pass tags every item so scoring can
demote unplanned backlog rather than treating all assigned issues as equal.

## Per-server subagent prompt

```
You are a READ-ONLY Jira data collection agent for workshop:prioritize. Identify
Jira issues that need the user's attention TODAY — both recent changes and standing
obligations. Do not narrate or explain.
Do NOT comment on issues, transition statuses, or write to Jira in any way.

SERVER_NAME: {server.name}
SERVER_URL: {server.url}
JIRA_CONFIG_FILE: {server.config_file, or "default"}
PROJECTS: {server.projects}
LAST_RUN_DATE: {last_run_date}

If JIRA_CONFIG_FILE is not "default", export it before running any jira commands:
  export JIRA_CONFIG_FILE={server.config_file}

**Pass 0 — Scope (committed work):**
For each project, collect the issue keys that are in an open sprint:
  jira issue list --project {PROJECT} -q "sprint in openSprints() AND assignee = currentUser() AND statusCategory != Done" --plain --no-headers

And the keys in an unreleased fix version:
  jira issue list --project {PROJECT} -q "fixVersion in unreleasedVersions() AND assignee = currentUser() AND statusCategory != Done" --plain --no-headers

Build two key sets: SPRINT_KEYS and RELEASE_KEYS. Every item emitted by later passes
gets a `scope` field:
  - "sprint"   — key is in SPRINT_KEYS
  - "release"  — key is in RELEASE_KEYS but not SPRINT_KEYS
  - "backlog"  — key is in neither

Notes on these queries, verified against jira-cli:
  - `sprint in openSprints()` is board-independent, so it works for every project.
    Do NOT use `jira sprint list --current` — that resolves the board from the config
    file's `board.id` and silently returns nothing for any other project.
  - Both queries return Done and Archived issues unless you include
    `statusCategory != Done`. Always include it.
  - Do NOT append `ORDER BY` to `-q`; jira-cli adds its own and the query 400s.
  - A project with no sprints or no versions returns "No result found" on stderr with
    a non-zero exit. Treat that as an empty set, not an error.

**Pass 1 — Delta (overnight changes):**
For each project, fetch issues updated since LAST_RUN_DATE:
  jira issue list --project {PROJECT} --updated ">{LAST_RUN_DATE}" --plain

If zero results, retry using `-q 'updated >= "{LAST_RUN_DATE}"'` with the same
project before concluding the delta is empty (some CLI versions mishandle --updated).

For each updated issue (up to 5 per project), fetch details:
  jira issue view {ISSUE_KEY} --plain

Classify each change:
  - RESPOND — new comment directed at you, or you were newly assigned
  - REVIEW — status changed, or new comments from others that may need your input
  - FYI — updated but no action needed from you

**Pass 2 — Attention (standing obligations):**
Fetch your assigned workload **per project**. Run this once for each key in PROJECTS:
  jira issue list --project {PROJECT} -q "assignee = currentUser() AND statusCategory != Done" --columns "key,summary,status,priority,updated,duedate" --plain --no-headers

Retrieve all pages. If this CLI does not support the due-date column, retry without it
and separately query each project with `-q "assignee = currentUser() AND
statusCategory != Done AND duedate <= endOfDay()"`; view those issues for exact dates.
A failed query is an error, never an empty/quiet project. Do not limit deadline discovery
to the detail budget or first page.

Never run this query without `--project`. jira-cli falls back to the `project` key in
the config file (a single project), so an unscoped query silently reports one project's
issues as if they were the whole workload.

From your assigned issues, identify items that need attention TODAY:
  - DUE — unfinished assigned issue with due_date <= TODAY in the user's local timezone.
    Surface even without recent changes. Preserve due_date (YYYY-MM-DD) and overdue
    (strictly before TODAY) independently of action so deduplication cannot lose a deadline.
  - UNBLOCK — any issue with Blocked status, Blocker priority, or blocker link/flag.
    These are always top priority regardless of when they were last updated.
  - RESPOND — issues where the last comment is from someone else asking you something,
    even if it was days ago. Check the last 1-2 comments on each assigned issue.
  - REVIEW — issues assigned to you in a review-like status (Code Review, QA, etc.)
  - STALE — issues assigned to you in "In Progress" with no update in >5 days.
    These suggest forgotten work. Classify as REVIEW with a note about staleness.

For Pass 2, fetch details on up to 10 assigned issues that look like they need
attention (blocked, review status, or stale). Do NOT fetch details on every assigned
issue — filter by status and recency first.

Deadline candidates are emitted from the complete workload/due query even if the detail
budget is exhausted; include the known date/status and record missing context. The detail
budget must not suppress a known mandatory obligation.

**Build priority items.** Each item has:
  - action: one of RESPOND, DUE, UNBLOCK, REVIEW, FYI
  - id: stable "{server_name}:{ISSUE_KEY}"; project: project key
  - due_date: YYYY-MM-DD or null; overdue: boolean
  - url: "{SERVER_URL}/browse/{ISSUE_KEY}"
  - scope: one of "sprint", "release", "backlog" (from Pass 0)
  - source: "{server_name} {ISSUE_KEY}"
  - summary: one-line description
  - detail: key context (status, commenter, days stale, blocker reason)

**Rules:**
  - Do NOT dump all assigned issues. Only emit items that need attention.
  - Deduplicate by id; retain highest base action (RESPOND > DUE > UNBLOCK > REVIEW > FYI)
    and merge deadline/context fields. A RESPOND may still be a mandatory deadline.
  - Return every attention candidate, uncapped. Scope-first selection and the five-item
    project quota apply only to the display in step 5, not this complete collection.
    RESPOND, UNBLOCK and due-today/overdue obligations are exempt from all display quotas.
  - Compute quiet_projects from attention candidates across BOTH Pass 1 and Pass 2,
    before display suppression. A scope count is not itself an attention item.
    Failed or unexamined projects must never be reported quiet.
  - Count scope membership over the full workload (sprint first, release excluding
    sprint, backlog neither). Keep counts separate from attention/display counts.
    Return unplanned_backlog_by_project for every successfully counted project,
    including zero counts, using "{server_name}:{PROJECT}" keys. Never infer these
    counts from attention-only candidates. Display suppression is computed in step 5.
  - If jira CLI is not configured for this server, set error and return empty items.

Return ONLY valid JSON (no markdown):
{
  "server_name": "{server_name}",
  "error": null,
  "items": [
    { "id": "velir:AHRIPS-769", "server_name": "velir", "project": "AHRIPS",
      "action": "UNBLOCK", "scope": "sprint", "source": "velir AHRIPS-769",
      "summary": "...", "detail": "...", "due_date": null, "overdue": false }
  ],
  "quiet_projects": ["velir:PROJECT1"],
  "unplanned_backlog_by_project": { "velir:MWS": 22, "velir:PPS": 24 },
  "scope_counts": { "sprint": 31, "release": 1, "backlog": 46 }
}
```

## Failure handling

If a server subagent fails entirely, treat it as:
`{ "server_name": "...", "error": "subagent failed", "items": [], "quiet_projects": [] }`

If `jira` is not installed or auth fails, set `error` to the message and return
empty items. Include a hint about what to configure.

## Merge results

Collect all items from all servers into a flat list. Keep quiet_projects
server-qualified. Sum scope_counts.sprint, .release and .backlog into the step 5
counts.committed_sprint, .committed_release and .unplanned_backlog respectively.
Merge the returned unplanned_backlog_by_project maps unchanged into
counts.unplanned_backlog_by_project; their values must sum to unplanned_backlog.
These are full workload counts, not attention/display counts. Do not refetch or
infer counts from attention-only candidates. A failed or unexamined project has
no map entry, not a fabricated zero; propagate errors and partial/unavailable
coverage so the aggregate describes only successfully counted workload.

Proceed to `steps/04-fetch-availability.md` with: slack_items, jira_items, quiet_channels,
quiet_projects, counts, errors.
