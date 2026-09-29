# Working with Jira

How agents interact with Jira on a project. These defaults apply unless the project's process page or manifest says otherwise.

## Transitions

- Read the transitions Jira offers for the issue in its current state before applying one. Never assume a path from the status list; many statuses are not reachable directly.
- Apply only the transition the gate table names. If it is not offered, record that and ask; do not pick the nearest one.
- Record every applied transition in the ledger with the transition id as evidence.

## Comments and fields

- A comment on the ticket summarises what changed and how to verify it, in plain language. Link the pull request.
- Anything a client can see is drafted and shown to a human, who edits and approves it before it is posted or sent.
- Estimate reconciliation reads the field named in `jira.estimate_field` in the manifest. If that is unset, ask which field the team uses and suggest adding it to the manifest.

## Recommending tickets from evidence

Evidence such as drover's recurring-error file becomes ticket recommendations, never tickets, until a human decides. Defaults, in `jira-strategy.json`:

- A pattern needs a minimum number of occurrences (50) before it is worth a ticket; below that it is background noise.
- At most the top 5 by volume.
- Errors that share a diagnosed cause are one ticket, not several.
- Suggested priority comes from severity plus share of total volume, and is labeled a suggestion.
- Titles drop URLs and request ids and stay under 100 characters.
- Every recommendation carries a `suggested` label and its source, so anyone can see it was machine-proposed.

A project overrides any value with a `jira_strategy` object in `.velir/project.json`.
