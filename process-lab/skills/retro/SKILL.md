---
name: retro
description: >
  Facilitate a retrospective for a real project over a date range: follow up the last retro's
  actions, gather what happened from people, Jira, pull requests, and the process ledger, then
  agree action items and proposed process changes. Not for a status check (process-lab:lint).
---

# Run a project retrospective

A retro is a conversation with the people who did the work, backed by evidence. The evidence is there to settle arguments and surface things nobody remembered, not to replace the conversation. Agent work is part of the evidence: what agents did at each gate is reviewed here alongside what people did.

## 1. Frame it

Agree with the user on the project, the date range (usually the last sprint or release), and who is taking part. Find the previous retro's report, if any, under `analysis-reports/retro/`.

## 2. Follow up the last retro

For each action item from the previous report: done, in progress, or dropped, and did it help? Unfinished items that still matter carry forward. Do this first, so the retro is not just a list that gets written and forgotten.

## 3. Gather evidence

Collect in parallel where you can:

- **Process ledger.** `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/process_lab.py" report --since <from> --until <to> --project <jira project> --json` — per gate: open at start, opened, discharged, waived, reopened, open at end, discharge rate; waiver reasons; failed checks. Run it from the project's repository so the project defaults correctly.
- **Jira.** Tickets resolved, reopened, or bounced back (rejected by testing or by the client) in the range, and how long each sat in each status.
- **Pull requests.** Merged, review rounds, time from opened to merged.
- **Agent work.** For a handful of tickets where the ledger shows skips or rejections, dispatch `process-lab:process-auditor` to check the work against the process. Note where agents followed the process and where they did not.

Summarize the evidence in a few lines per source. Look for patterns, not individual lapses.

## 4. Hear from people

Ask each participant, or the user on their behalf: what went well, what got in the way, what they would change. Offer to collect input anonymously if the user wants it (they can paste notes or messages). Put each answer next to the evidence that supports or contradicts it. Where evidence and experience disagree, say so and ask; that is usually where the useful finding is.

## 5. Decide

Converge on a small number of action items (three is plenty). Each has an owner, a date, and the observable change that will show it worked. Separate them from lessons, which are worth recording but not tracking.

When a finding is about the process itself (a gate nobody can meet, an obligation that is always waived for the same reason, a step the team does but the page does not mention), write it as a proposed change to the process page and hand it to `process-lab:codify`.

## 6. Record

Write `analysis-reports/retro/<YYYY-MM-DD>-<project>.md`: range and participants, follow-up of the last retro, evidence summary, what people said, action items, lessons, proposed process changes. Offer to create the action items where the team tracks work, usually Jira, with the user approving each one before it is created.
