# process-lab

Holds agent-assisted work to each project's own process. No two projects are assumed to run the same way: the process is always the project's, read from a Confluence page the team owns.

## How it works

1. `process-lab:initialize` writes `.velir/project.json` in the repository, fetches the project's process page, and caches its gate table.
2. While you work, hooks notice when a command crosses a gate (branch created, commit, tests passed, push, pull request opened), record it in a ledger, and tell the agent what the process now requires.
3. `process-lab:advance` does what is owed (Jira transition, ticket comment, testing steps) or records a waiver with its reason. `process-lab:lint` says what is still outstanding.
4. `process-lab:retro` reviews a stretch of work with the people who did it, using the ledger, Jira, and pull requests as evidence. `process-lab:codify` turns what it finds into proposed changes to the process page.
5. `process-lab:recommend-tickets` turns evidence, such as a drover report's recurring errors, into Jira ticket recommendations under the project's Jira strategy.

Every project starts in observe mode: nothing is blocked. See `references/rule-tiers.md` for moving toward enforcement, `references/gate-table.md` for the page format, and `references/jira-strategy.md` for how agents work with Jira.

## Limits

Hooks only see commands run inside Claude Code. Work done in a plain terminal or the Jira web interface is invisible, so this reinforces a process rather than guaranteeing it. Server-side enforcement, such as a continuous integration job or a Jira automation, is out of scope.

## Files

- Ledger: `${CLAUDE_CONFIG_DIR:-~/.claude}/process-lab/ledger.jsonl`, append-only.
- Per repository: `.velir/project.json` (committed) and `.velir/process-cache.json` (derived from the page).
- Tests: `python3 -m unittest discover -s process-lab/tests`.
