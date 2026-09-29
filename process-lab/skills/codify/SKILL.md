---
name: codify
description: >
  Turn repeated waivers, retro findings, or a novel situation into a proposed change to the
  project's Confluence process page, apply it once a human approves, and refresh the cache. Not
  for carrying out today's obligations (process-lab:advance).
---

# Change the process

The process page belongs to the team. This skill proposes edits to it from evidence and applies them only with approval.

## 1. Find what should change

Sources, any of which may start this:

- Waivers: `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/process_lab.py" report --since <date> --project <jira project> --json`, grouped by obligation. The same reason three or more times is a candidate for an exception written into the page.
- A retro's proposed process changes.
- Something the user just ran into that the page does not cover.
- A candidate gate from `${CLAUDE_PLUGIN_ROOT}/references/candidate-gates.md` the team wants to try.

## 2. Propose

Fetch the current page in storage format, with its version. Write the change as a diff against the gate table and any prose around it: add, change, or remove a row, reword an obligation, add an exception. For each change, cite the evidence (waiver count and reasons, retro date) so a reviewer can judge it without the conversation.

New gates start with the project in its current mode. Moving a project or gate toward enforcement follows `${CLAUDE_PLUGIN_ROOT}/references/rule-tiers.md` and needs the team's agreement, not just the user's.

## 3. Apply

Show the exact new page content. Only after the user approves it, update the page (Atlassian connector or `twg` Confluence commands), checking that the version has not changed since you fetched it. If it has, refetch and re-propose.

Then refresh the cache:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/process_lab.py" sync --page-file <file> --page-id <id> --page-version <new>
```
