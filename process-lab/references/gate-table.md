# The process page and its gate table

A project's process lives on one Confluence page the team owns. The manifest (`.velir/project.json`) points at it by page id under `confluence.pages.process`. Resolve by id, never by title or path: placeholder pages keep template titles, and space keys can point at archived Jira projects.

The page is prose for people plus exactly one table the plugin reads. Extra columns are ignored; column order does not matter.

| Column | Contents |
| --- | --- |
| Gate | The step's name, as the team says it. |
| Detected by | One of the keys below. Anything after the key is ignored, so a note like "pushed (to remote dev)" is fine. |
| Jira transition | `From -> To`, or `none`. When present it is an obligation of the gate. |
| Obligations | What is owed at this step, one per list item or line, or separated by `;`. |

## Detection keys

| Key | Fires when |
| --- | --- |
| `branch-created` | `git checkout -b`, `git switch -c`, `git branch <name>`, or `git worktree add -b` succeeds or is about to run |
| `commit` | `git commit` |
| `tests-passed` | a command from `conventions.test_commands` in the manifest succeeds |
| `pushed` | `git push` succeeds |
| `pull-request-opened` | `gh pr create` succeeds |
| `declared` | never automatically; someone says it happened, via `process-lab:advance` |

Hooks only see commands run inside Claude Code. A push from a plain terminal or a status change in the Jira web interface is invisible, so this reinforces a process rather than guaranteeing it.

## Branch and commit conventions

These are checked before the command runs rather than recorded as obligations:

- `conventions.branch_pattern` — a regular expression; `{ticket}` expands to the Jira key pattern.
- The commit message must contain the ticket key when a `-m` message is visible.

In `observe` mode a failed check is recorded and mentioned. In `enforce` mode the command is refused with the reason.

## Cache

Hooks never call the network. `process-lab:initialize` fetches the page and writes `.velir/process-cache.json` with the page version. Refresh it whenever the page changes; the session-start hook says when the cache is more than 14 days old.
