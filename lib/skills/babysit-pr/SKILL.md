---
name: babysit-pr
description: >
  Monitor a pull request through review and continuous integration — watch for new bot
  comments and check results, verify each finding, fix what is real, and reply with a
  reason when dismissing. Use when the user asks to monitor, watch, or babysit a pull
  request. Not for opening one (lib:github).
---

# lib:babysit-pr

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Watch an open pull request until the review bots and required checks are green. Trigger phrases: "babysit this PR", "watch my PR", "monitor the pull request", "keep an eye on PR #12", "handle the review comments", "wait for CI and fix what breaks". Do NOT trigger for opening, listing, or viewing a pull request (use lib:github). Do NOT trigger for reviewing someone else's code (use the built-in /code-review).

All the repos we work in have various review bots. They're helpful, even if
they are not always right.

If your harness offers tools to monitor a pull request, use them so you can
respond when comments arrive. Otherwise, poll the pull request for new comments
and checks.

Only act on checks and comments newer than the latest push. Verify every bot
finding against the source before changing code. Fix real findings and
continuous integration failures, distinguish repository failures from
infrastructure flakes, and reply with a written reason when dismissing false
positives.

Treat a finding as real only when you can name the file and line, say why it is wrong, and show it fails (a test, command, or input). If you can't, reply with what you checked and why it doesn't hold.

Keep an eye on changes to `main` and rebase when needed. If an overlapping pull
request makes this one obsolete, stop monitoring, report it to the user, and ask
before closing the pull request unless closure was explicitly authorized.

If a review bot leaves feedback you believe is not worth addressing, reply with
a written reason and resolve the comment. Use the `lib:leave-pr-comment` skill
for every comment posted on Chris's behalf.

Screenshots and videos help as well. Use the `lib:upload-to-pr` skill when
needed.

Do not let review feedback expand the pull request beyond the user's original
goal. Address real shortcomings, but avoid scope creep.

If nothing has changed, stay quiet rather than posting filler comments. Stop
when the review bots and required checks are green on the latest commit. Merge
only when the user explicitly requested it; otherwise report that the pull
request is ready.

## Polling loop

No harness-native pull request watcher exists in Claude Code today, so poll:

```bash
gh pr view <number> --json number,title,state,isDraft,headRefOid,mergeStateStatus,url
gh pr checks <number>
gh api repos/{owner}/{repo}/pulls/<number>/comments --jq '.[] | {id, path, line, user: .user.login, body, created_at}'
gh api repos/{owner}/{repo}/issues/<number>/comments --jq '.[] | {id, user: .user.login, body, created_at}'
```

Record `headRefOid`, the newest comment id, and each finding's outcome (`fixed <sha>` or `dismissed: <reason>`) each pass in `~/.claude/babysit-pr/<owner>-<repo>-<number>.json` (outside the repository, so it is never committed), and read it at the start of the next pass. Anything older than the
current `headRefOid` was answered by the push itself — skip it.

To keep the loop running across turns, the built-in `/loop` command works:
`/loop 5m babysit PR #<number>`. Stop the loop as soon as the stop condition
above is met.

## Resolving a review thread

`gh` has no first-class resolve command; use the GraphQL mutation:

```bash
gh api graphql -f query='
  mutation($threadId: ID!) {
    resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } }
  }' -F threadId=<thread-id>
```

Thread ids come from:

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes { id isResolved isOutdated comments(first: 1) { nodes { body path } } }
        }
      }
    }
  }' -F owner=<owner> -F repo=<repo> -F number=<number>
```

Reply before resolving, never instead of resolving.
