---
name: leave-pr-comment
description: >
  Write a pull request comment, review reply, or description in Chris's voice — narrative
  cause, change, consequence; no headings, no emoji, no agent attribution. Use for every
  comment posted on his behalf. Not for attaching images (lib:upload-to-pr).
---

# lib:leave-pr-comment

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Compose anything posted to a GitHub pull request under Chris's name: a description, a comment, a reply to a review bot, a dismissal. Trigger phrases: "reply to that review comment", "write the PR description", "tell the bot why we're not changing it", "comment on the pull request", "dismiss that finding". Invoked by lib:babysit-pr for every comment it posts. Do NOT trigger for attaching images (lib:upload-to-pr), Drupal.org issue comments (drupal-lab:issue-summary), or Jira comments (lib:jira).

## Voice

Derived from Chris's own commit bodies and pull request text, not invented.

Cause, then change, then consequence — as prose. State what was failing,
missing, or impossible and what it actually cost; then what changes now and why
this design is the right one; then the evidence.

Concrete over general. Counts, file paths, flags, commands, versions,
counterexamples. `ledger.py:118`, not "the relevant helper". "13 of 43 font-size
tokens scale", not "some tokens scale".

Candid about limits. Say what is unproven, what was not covered, what breaks.
Claims must be checkable by the reader; a vague claim erodes trust even when it
is true.

No acronyms. Spell out continuous integration, pull request, merge request, and
the rest, every time. Terms that only exist in short form are the exception:
JSON, URL, HTTP, API, CLI, DDEV.

**No headings in ordinary pull request text.** Not `## Summary`, not
`## Changes`. Use a prose transition line when a list needs introducing —
"Notable behaviour changes:", "Three defects it exists to prevent, all hit while
building the Schusterman library for real:".

No emoji. No sign-off. No "Great catch", no "Thanks for the review", no
restating the bot's comment before answering it.

## Attribution

Everything posted reads as Chris's own work. Never write "generated with
Claude", a `Co-Authored-By: Claude` trailer, "as an AI", or a robot emoji — in
comments, descriptions, or commit messages. `twg-attribution-guard.sh` enforces
this on Atlassian writes; on GitHub nothing enforces it but you.

## Replying to a review bot

The bot on the Velir repositories is Arnica, and it takes commands in the reply
body:

```
[arnica] ack <detail>
[arnica] dismiss fp <reason>         # false positive — the finding is wrong
[arnica] dismiss accept <reason>     # finding is right, risk accepted
[arnica] dismiss capacity <reason>   # real, but deferred
```

Chris's own dismissal, verbatim, as the model for tone — decision first, then
the fact that settles it, then the scope of the decision:

> `[arnica] dismiss accept GPL-2.0-or-later is the required license for all Drupal core and contributed code; drupal/miniorange_saml cannot be obtained under any other license. Accepting the risk for this dependency, consistent with the rest of the Drupal dependency tree in this repository.`

Three shapes, and the finding decides which:

**Accepting** — name the change and the commit, nothing else.

> Fixed in 4a91c2e. The early return skipped the cursor advance, so a partial pass could resume mid-file.

**Dismissing** — state why the finding does not hold and the evidence that
settles it. A dismissal without evidence is a refusal, and a bot's finding is
wrong only when you can say how you checked.

> `ledger.py` is standard library only by design, so the suggested dependency would be the first one in the file. The bounds check this asks for already runs in the caller at `ledger.py:118`.

**Deferring** — only when the work is real but outside this pull request's
goal. Name where it went, so it is not silently dropped.

> Real, but outside this pull request, which only moves the cursor logic. Filed as gap-4kp.

Reply before resolving a thread, never instead of resolving it. A bot comment
that needs no reply gets no reply — silence beats filler.

## Pull request descriptions

Conventional Commits title (`feat(lib): …`, `fix(drover): …`, `feat(scope)!: …`
when breaking), then prose. Shape, not a template to fill:

```
<What was failing, missing, misleading, or impossible, and what that cost.>

<What changes now, why this design, and any non-obvious constraint or tradeoff.>

<Bullets only when several discrete changes need separating. Each names the
file or component and the resulting behaviour — not a generic changelog line.>

<Evidence: "Verified …", a before/after measurement, a version bump, or a
BREAKING CHANGE line.>
```

A one-line change gets a one-line description. Drop a section rather than pad
it.

## Posting

```bash
# A comment on the pull request
gh pr comment <number> --body-file /tmp/comment.md

# A reply to a specific review thread
gh api repos/{owner}/{repo}/pulls/<number>/comments \
  -f body="$(cat /tmp/reply.md)" -F in_reply_to=<comment-id>

# The description
gh pr edit <number> --body-file /tmp/description.md
```

Write the body to a file rather than passing it inline — backticks, newlines,
and quotes survive the shell intact. Read it back before posting; an unnoticed
shell expansion is published the moment the command runs.
