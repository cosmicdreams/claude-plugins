# Task linter — design note

**Status:** draft for review by Chris Weber and Dan Murphy. Nothing has been written to
Confluence or Jira. Pilot target is PNCB.

## The problem, stated as evidence

Velir does not lack process conventions. It lacks the discipline to execute them, and
nothing in the current tooling notices when a step is skipped. Three measurements from
Confluence on 2026-09-02:

- Five client spaces created a `Call Notes` page in the last three months (Rumpke, Horizon
  Experience Foundation, Prompt, Eagle Point Credit, Billee Technologies). All five are at
  version 1 with **zero bytes** of content. A template stamps the page into every new space
  and nobody has ever typed in one.
- PNCB's support space has seven `[WIP]` pages at version 1, untouched since June 2024. One
  of them, `[WIP] Developer - Deployment Steps & Protocols`, is 390 bytes. Its sibling,
  `[WIP] Tech Producer - Release Steps & Protocols`, has 10.5 KB of specific, usable process.
  The technical producer side got written. The developer side never did.
- Seven pages across all of Confluence carry a process-ish title. The newest relevant one is
  from 2022; most are 2015 to 2020.

The existing Production Support Claude Plugin charter (page `6238961665`, version 5,
2026-08-26) scopes 21 skills. Every one of them is an assistant a developer chooses to
invoke. None of them enforces anything. "Developers forget steps" is not solved by a skill
they have to remember to run.

## Architecture

Four parts, with a strict division of labor.

| part | role | why |
| --- | --- | --- |
| **Hook** | detects a gate crossing, injects the obligation into context | fires whether or not the model decides it is relevant |
| **Skill** | knows the procedure, carries it out, records the outcome | needs judgment and tool access |
| **Ledger** | remembers what is owed and what was discharged | survives sessions and compaction |
| **Confluence** | holds the gate-to-obligation table as the editable contract | owners change process without a plugin release |

### The hook is the trigger, not the description

A skill invoked "based on its description" is the model choosing to notice. That relocates
the forgetting rather than fixing it, and we already track the smell as bead `gap-g6t`
(trigger-phrase stuffing in skill descriptions). The description stays as a deliberate-invoke
path. The hook is the guarantee.

This works because Claude Code is now the company's development surface. Historical guidance
in Nicole DuRand's runbooks naming GitHub Copilot and Business ChatGPT no longer reflects
practice and should not be treated as a constraint.

### Detect, then ask — never infer a state

"Work is done but we are still writing tests" is not reliably detectable, and guessing wrong
is how a tool gets uninstalled. The hook detects an unambiguous *candidate* transition. The
skill confirms the state with the developer and records it. A declined obligation is recorded
with a reason rather than silently skipped, and those reasons are the raw material for
extending the rules.

## Gate table — PNCB (`PPS`)

`PPS` Feature and Bug issues carry 23 statuses. The developer-relevant path:

```
Ready for Development -> In Development -> Ready for QA -> QA
  -> Ready for Deployment -> Selected For Deployment -> Deploy for UAT
  -> Awaiting UAT Approval -> UAT Accepted -> Awaiting Certification -> Resolved
```

with `QA Rejected`, `UAT Rejected`, and `Certification Failed` as loops back.

| gate | detection | trust | Jira transition owed | other obligations |
| --- | --- | --- | --- | --- |
| work started | `PreToolUse` on `git checkout -b` / `git branch` | inferred | `Ready for Development` to `In Development` | branch name matches convention; ticket assigned to self |
| implementation committed | `PreToolUse` on `git commit` | inferred | none | commit message references the ticket key |
| tests green | `PostToolUse` on the project test command, exit 0 | inferred | none | reconcile estimate if actual is over |
| pushed to remote dev | `PostToolUse` on `git push` | inferred | `In Development` to `Ready for QA` | manual testing steps written on the ticket; comment summarising the change; estimate reconciled |
| pull request opened | `PostToolUse` on `gh pr create` | inferred | none | pull request linked on the ticket |
| deployed for user acceptance testing | declared by the developer | declared | `Ready for Deployment` to `Deploy for UAT` | client-facing communication drafted, human-approved before sending |

Two constraints on this table:

1. Transitions must be validated against the transitions Jira actually offers for that issue
   in its current state, not assumed from the status list. Several of the 23 statuses are not
   reachable directly.
2. The table above is a **starting proposal derived from the workflow, not from a documented
   standard** — no such standard exists yet. It is the thing to review with Dan and Nicole,
   and once agreed it lives on the Confluence page, not in this file.

## Where the rules live

Fill `[WIP] Developer - Deployment Steps & Protocols` (`4205052827`) rather than creating a
new page. Reasons: it is the exact designated slot, it is part of a skeleton replicated
across client spaces so the resolution rule generalises, its sibling proves the format, and a
new page would compete with seven already-empty ones.

The gate table goes on that page as a real Confluence table. Storage format is parseable, so
the document humans edit is the document the linter reads — no second source of truth to
drift. Prose around it for context; the table is the contract.

**Resolve by stored page id, never by inferred path.** PNCB proves why: the Confluence space
key is `PWRDI`, which is an *archived* Jira project, while live work runs in `PPS`. The
parent page is still literally titled "Support and Maintenance Main Parent Page Template"
because nobody renamed it after stamping. Any name-derived lookup breaks on this space.

## Manifest

`.velir/project.json`, one per repository, committed. Named roles to ids:

```json
{
  "client": "PNCB",
  "jira": { "project": "PPS" },
  "confluence": {
    "space": "PWRDI",
    "pages": {
      "dev_process": 4205052827,
      "call_log": 6005916207,
      "runbook": 139340118
    }
  }
}
```

`runbook` points into the `NOC` space, not the client space — the client-space runbook page is
a 165-byte stub containing only a link. Another reason roles map to ids.

## Ledger

Append-only JSON Lines at `~/.claude/support-ledger.jsonl`. Same shape as the work-event
ledger from the communication loop.

```jsonl
{"ts":"2026-09-03T14:22:10Z","ticket":"PPS-1234","branch":"feature/PPS-1234-slug","event":"gate_crossed","gate":"pushed_to_remote_dev","detected_by":"PostToolUse:git-push"}
{"ts":"2026-09-03T14:22:10Z","ticket":"PPS-1234","event":"obligation_opened","gate":"pushed_to_remote_dev","obligation":"jira_transition","detail":"In Development -> Ready for QA"}
{"ts":"2026-09-03T14:23:02Z","ticket":"PPS-1234","event":"obligation_discharged","obligation":"jira_transition","actor":"agent","evidence":"transition 41 applied"}
{"ts":"2026-09-03T14:23:40Z","ticket":"PPS-1234","event":"obligation_waived","obligation":"manual_test_steps","actor":"human","reason":"configuration-only change, no user-facing behaviour"}
```

This is what makes it a linter rather than a nag: at any moment it answers "what is
outstanding on this ticket," and the waiver reasons accumulate into proposed rule changes.

## Rollout

**Phase 1 — observe only.** Log gate crossings and whether obligations were discharged.
Block nothing. Two weeks of this produces the number that wins the argument: *developers
crossed this gate 40 times and updated the ticket 11 of them.* Same species of evidence as
the five zero-byte Call Notes pages.

**Phase 2 — enforce.** Turn on blocking once the skip log is boring.

Shipping enforcement first risks the whole effort. A blocking hook that is wrong even
occasionally gets uninstalled by the entire team and does not come back.

## Skills

| skill | trigger | reads | writes | gate |
| --- | --- | --- | --- | --- |
| `support:initialize` | manual, once per repository | Confluence space, Jira project, repo | `.velir/project.json`; the process page if it is still a placeholder | page write needs human approval |
| `support:lint` | manual anytime, plus `SessionStart` | ledger, gate table, current branch and ticket | nothing | read-only |
| `support:advance` | hook, on a detected gate crossing; also manual | gate table, ledger, Jira issue | ledger always; Jira transition and comment; Slack notice | anything client-visible is draft-then-approve |
| `support:debrief` | manual, during or after a call | user input, optionally a Zoom transcript | the project's call-log page | human approval before it lands |
| `support:codify` | manual, after a waiver or a novel situation | ledger waivers, gate table | the gate table on the Confluence page | human approval before it lands |

`lint` is what makes this a linter rather than a nag: it answers "what is outstanding on this
ticket" at any moment. `codify` closes the loop on situational exceptions — a waiver recorded
with a reason today becomes a proposed rule tomorrow, rather than rotting in the ledger.

Naming is provisional and to be opened up to the team. Plugin nouns, skills verbs.

### Hooks

Not skills, but the part that makes enforcement work rather than hope.

| hook | fires on | does |
| --- | --- | --- |
| `PostToolUse` | `git push`, project test command | records the gate crossing, injects the outstanding obligations |
| `PreToolUse` | `git commit`, `git checkout -b` | checks the ticket key and branch convention |
| `SessionStart` | session open | surfaces anything left outstanding on this branch |

### Build order

Observe-only phase needs `advance` plus the hooks, with `initialize` as a prerequisite.
`debrief` and `codify` follow once the gate table has settled.

### On `debrief` and the existing call-note format

The `Call Notes` title convention is worth inheriting; the body format is not. The 2019-era
meeting-notes shape was designed for human recall. A call log whose purpose is to feed an
agent's context on later tickets needs different structure — decisions and constraints
separated from narrative, participants attributed, and open questions marked as open. Design
this rather than adopt it.

## Fit with the existing charter

Charter Section 9 lists eight open questions for kickoff. One is ours:

> **AI Playbook embedding**: scope which of Nicole's 7 lifecycle steps get embedded first, in
> what format, and coordinate ownership with her team.

The task linter answers "in what format": the durable part of each runbook is the obligation
it ends with, not its tool mechanics. `PRs and Code Review` is wall-to-wall Copilot
instructions and cannot be embedded as-is, but it ends by saying the output becomes a Jira
comment and quality-assurance coverage input. That obligation is tool-independent and
enforceable.

The pitch: this is not a 22nd skill. It is the runtime the other 21 sit inside, and it
answers an open kickoff question that currently has no owner.

Charter guardrails already constrain `advance` and should be inherited rather than restated:
no AI-generated code merged without human review, and nothing client-facing sent without a
human editing it.

## Honest limits

**Hooks only fire inside Claude Code.** A `git push` from a plain terminal, or a status
change made in the Jira web interface, is invisible. This reinforces process; it does not
guarantee it. A real floor needs the same gate table enforced server-side — a continuous
integration job or a Jira automation — with the plugin as the friendly front end. Say this in
the pitch so nobody hears "guaranteed."

**Filling the process page drops the `[WIP]` prefix**, which turns a placeholder into
something that reads as authoritative to anyone in the PNCB space. First pass should be
reviewed by Chris and Dan before it lands there.

## Open questions

1. Is this a separate prototype for Dan, or a contribution into the existing charter? The
   second is the stronger position but means coordinating with Alessandro Faniuolo and Nicole
   DuRand rather than building alone.
2. Who owns the gate table as a document once it exists? Charter Section 6F assigns
   "Procedure/runbook drafting & maintenance assistant" to a technical producer.
3. Does the gate table start per-client or company-wide? Per-client is honest to how the
   workflows actually differ; company-wide is what makes it a shared standard.
4. Estimate reconciliation needs a source of truth for the original estimate. `PPS` has
   several candidate fields (`Development Estimate`, `Story Points`, `Testing Estimate`) and
   which one support actually uses is unconfirmed.
