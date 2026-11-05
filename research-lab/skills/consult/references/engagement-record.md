# Engagement record

One `record.md` per research job, in its folder under `Engagements/`. It is how a librarian resumes a job and how the user audits one. The index is rebuilt from these files, so keep the frontmatter flat: one `key: value` per line, values written as JSON (strings quoted, lists in brackets).

## Template

```markdown
---
type: "research-engagement"
name: "<date>-<slug>"
question: "<the question, one line>"
status: "active"
librarian: "librarian · <date>-<slug> · main"
parts: ["main"]
corpora: ["notebook: <title or id>", "vault: <folder>", "files: <path>"]
experiment_runs: []
next: "<the next step, in plain words>"
---

# <question>

## Plan

Accepted <date>. Route, corpora and why, models and the usage data's age, split decision.

## Log

- <date> · frame · 01-frame.md · next: gather

## Gates

- <date> · strategy · accepted with changes: <what changed>

## Open questions

- <question> · who can answer it · what happens if no one does

## Outcome

Filled in at the end: the answer, its confidence, the interrogate verdict, and links to every product.
```

## Fields

| Field | Values | Notes |
|---|---|---|
| `status` | `active`, `waiting`, `paused`, `done`, `abandoned` | `waiting` means a gate question is open. |
| `parts` | list of part names | `main` until the job is split. |
| `corpora` | list of `"<kind>: <name>"` | Kinds: `notebook`, `vault`, `files`, `threads`, `web`. Add `(client data)` to any corpus that holds it. |
| `experiment_runs` | list of run names | The folder names `experiment` registered under `Experiments/`. |
| `next` | one line | The step to resume from. Update it after every step. |

## Rules

- Append to Log and Gates; never rewrite earlier lines.
- When the job is split, each part other than `main` keeps its own record and numbered outputs in `parts/<part>/`; the `main` librarian merges each part's outcome into this record when the part delivers. The index lists only the main record.
- Run `research_lab.py index` after any change to the frontmatter.
