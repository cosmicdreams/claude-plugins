# Worth-it gate and anti-slop writing

Maintainer attention is the scarce resource. Every commit made after a pull request (PR) or merge request (MR) exists, and every post that goes to people outside the team, must be worth that reader's time. Run this gate where you act. A skill that links here calls the gate at that step; it is not optional background reading.

## The gate

Answer all five in writing before the commit or post. One "no" means the change becomes a one-line follow-up for the user instead.

1. **One problem.** It serves the problem this PR exists for. Adjacent cleanup, a second bug, or a failure that already exists on the base branch belongs in its own issue, even when it is useful.
2. **Proven.** Proof exists against the base branch: a failing test, a stack trace, or a reproduction. With no proof, add no guard and no defensive code; ask the reporter for the trace instead.
3. **Smallest.** It is the smallest change that fixes the cause. The fix that deletes or narrows code wins. Keep the original author's or maintainer's approach unless the reproduction proves it wrong. A change of direction needs the maintainer's agreement first.
4. **Asked for.** After the PR is ready, act only on events: a failed check this PR caused, a reviewer or maintainer comment, a conflict, or a branch that has fallen behind. Your own new ideas are not events. With nothing new, stay silent.
5. **Worth the reviewer's time.** A maintainer reading only the diff or the post would clearly want it. If they would be neutral, leave it out.

## Record

Write the answers next to the work so they can be audited:

- Commits: in the handoff or ledger file, keyed by the commit SHA.
- Posts: as `<body>.gate.json` beside the body file. The lib plugin's `upstream-post-guard` hook requires it for git.drupalcode.org posts:

```json
{
  "body_sha256": "<sha256 of the body file>",
  "problem": "<the PR's one problem this serves>",
  "proof": "<command -> literal result on the base branch>",
  "smallest": "<why this is the smallest change, or why it keeps the author's approach>",
  "trigger": "<the event that asked for it, or 'initial evidence'>",
  "reviewer_value": "<why the maintainer wants to read this>",
  "not_verified": "<what you could not check>",
  "chris_approved": false
}
```

Set `chris_approved` to true only after the user approved the exact text in the conversation. Never set it yourself on judgment.

## Writing that reaches people outside the team

- Lead with the conclusion. Five sentences or 150 words at most.
- Evidence is how the problem was established, how the fix was checked, what was observed, and what could not be checked. "Tests pass" is not evidence.
- Leave out process narration ("I rebased, then I checked..."), a retelling of the diff, design essays, side findings, headings, and requests to change other people's titles or code. Side findings go to the user as follow-ups.
- Never relay someone else's AI output.

## Maintainers who asked for human-written posts

For these projects an agent prepares the text but posts only after the user approves its exact wording (`chris_approved: true`). The list is local, not in this repository: `~/.claude/upstream-maintainers.json` (override with `UPSTREAM_MAINTAINERS`), an array of `{"project": "project/<name>", "maintainer": "<username>", "asked": "<when and where>"}`. Add an entry when a maintainer asks.
