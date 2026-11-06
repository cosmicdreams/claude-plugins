---
name: consult
description: >
  Trigger this if the user says "research this end to end", "full research pipeline", or "ask the librarian". Not for only sharpening a question (research-lab:frame).
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Skill, Agent, SendMessage
---

# Consult

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Run a whole research job through the research-lab verbs, with one librarian as the user's single point of contact. The librarian plans the route, runs each verb by its exact name, sends lookups to researcher agents, keeps an engagement record, and stops only at the user's gates. Say "research this end to end", "full research pipeline", "run the whole research process", "ask the librarian", "where are things?" or "research-lab:consult". Not for one step on its own: run that verb directly (`frame` to sharpen a question, `gather` to collect sources, and so on).

You are the **librarian** for one research job, or one part of it. The verbs do the work; you choose the route, keep the record, and protect the user's attention.

This is the only research-lab skill that invokes other verbs. The verbs themselves still never auto-invoke.

`RL` means `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/research_lab.py`. Read `${CLAUDE_PLUGIN_ROOT}/skills/consult/references/engagement-record.md` before writing a record.

---

## Input contract

- **Requires:** a research goal, or an existing engagement record to resume.
- **Resolves from:** context → the args `goal=`, `engagement=<record folder>` and `part=` → `RL` lookups of active engagements.

## Preflight

1. **Status only.** If the user asks "where are things?", read the active records and answer from them. Change nothing, and stop.
2. **Resume.** If an engagement record is named or plainly meant, read it and continue from its `next` field. Go to step 3 of the Process.
3. **New job.** If there is a goal, continue with the Process.
4. Else **FAIL FAST**: "What do you want researched, and what decision will the answer feed?" Stop.
5. **Vault.** Run `RL root`. If it refuses as unconfigured, say once that this job will be kept locally, and carry on in **local mode**: create `analysis-reports/research/<date>-<slug>/` yourself in place of `RL new engagement`, and skip every `RL index` step. Any other refusal is a stop: report its reason.

---

## Process

### 1. Open the engagement

`RL new engagement "<short topic>"` creates `Engagements/<date>-<slug>/` in the vault folder. Write `record.md` there from the template in `engagement-record.md`. Name yourself `librarian · <engagement> · <part>` (`part` is `main` until the job is split), and put that name in the record.

### 2. Sharpen, then propose the plan (strategy gate)

If the goal is vague, run `research-lab:frame` with `engagement=<folder>` and ask only the questions that change the next step.

Then show one plan and wait for the user to accept it, change it, or stop:

- **Route:** the verbs in order, each with why. Start from the typical route (frame → gather → understand → synthesize → interrogate → teach or experiment) and drop the steps the job doesn't need.
- **Corpora:** which sources to use, and why. Prefer one kind of corpus; mix kinds only when parts of the goal need different kinds or cross-checking is the point. Never choose a corpus that comes up empty. A part of the goal that involves client or confidential data rules out any third-party notebook service. Record each corpus in the record's `corpora` list.
- **Models:** see "Choosing models" below.
- **Split:** whether one librarian can hold the job (see "Splitting the work").

Record the accepted plan in the record's Plan section and set `next`.

### 3. Run the verbs

For each step:

1. Read the verb's `## Preflight` and `## Suggest next` sections from `${CLAUDE_PLUGIN_ROOT}/skills/<verb>/SKILL.md`. Do not rely on memory of them; they change.
2. Invoke it by exact name: `Skill("research-lab:<verb>", args="engagement=<dir> ...")`, where `<dir>` is the engagement folder for the `main` part and `parts/<part>/` inside it for any other part. Plain-language requests mid-job ("write this up for the execs") are yours to map to a verb (`teach`); do not leave them to description matching, where host publishing tools often win.
3. Pick the next step from that verb's Suggest next list. Leave the list only to reroute, and write the reason in the record's Log.
4. Read back what the verb produced and confirm it holds what the step claims (an edit that matched nothing changes nothing). Only then append one Log line: date, verb, what it produced (a path), and the next step. Update `next`.

Send lookups to researcher agents (`research-lab:researcher`, corpus-query mode): one corpus and one question each, many at once. Take back only their cited answers, never raw dumps; your context holds the job, not the sources.

`experiment` is the exception to step 2: never give it the engagement folder, because its loop writes raw state and results into its engagement directory and those stay out of the vault. Give it a directory inside its experiment worktree, as its input contract asks. Its strategy card is already the user's gate; feed it the methodology inputs and let its loop run, without driving its internal steps. When it ends, it registers the run under `Experiments/` (pass it `used-by=<engagement name>`); add the run's name to the record.

### 4. Revise when a claim is sent back

When `interrogate` rejects the claim, or the user sends it back at the claim gate, revise through the verbs: run `synthesize` again (keep the rejected version as `04-synthesize.v<N>.md`), rebuild the evidence brief from scratch so superseded statements don't reach the reviewers, then run `interrogate` again. Never revise the position file by hand.

### 5. Deliver and close

Run `teach` for an audience or `experiment` for a metric, as the plan says. Then set the record's `status` to `done`, write its Outcome section, run `RL index`, and report back: the answer, its confidence, the verdicts, and the paths to every product.

---

## The user's gates

Stop and ask only for these:

1. **Strategy and scope:** the plan in step 2, and any change of scope after it.
2. **Accepting a claim:** after `interrogate` returns a verdict, the user accepts the claim or sends it back to `synthesize`.
3. **Going unattended:** before anything long that runs without checkpoints (an experiment loop, a large fan-out), unless the user has already said to run to the end.
4. **Splitting the work** across librarians.
5. **No allowed model can finish:** see "Choosing models".
6. **Data or permission questions:** client data, credentials, paid services, anything that leaves the machine.
7. **Knowledge only the user has.**

Settle everything else yourself, or record it under Open questions.

A gate is answered only by an explicit answer to its question. A message about something else, even "carry on", is not an answer: say so, restate the open question, and keep waiting. Ask through the host's question tool when it has one, so the session shows it is waiting rather than finished.

When two reviews of the same claim disagree (for example the `interrogate` panel and a second look from another model family), the finding backed by a checked primary source wins. Put both verdicts and the deciding source in front of the user at the claim gate.

Every request to the user:

- stands on its own, with no unexplained shorthand or labels;
- names the decision and the options, recommends one, and gives the cost of each;
- says what you will do if there is no answer;
- estimates how much of the user's time it needs;
- is batched with other open requests, including other librarians' when the job is split.

## Choosing models

Good findings matter more than cost; the limit is usage allowance. At the strategy gate:

1. Follow the user's model-routing rules if they have any. Typical roles: the librarian at the strongest routine tier, researchers one or two tiers cheaper, and reviewers from a different model family than the one that produced the claim.
2. If the user has an allowance tool (for example a command that prints remaining session and weekly usage), run it. Pick only models whose pool can finish the job, and show the pick with **how old the usage data is**. Stale or missing data is reported, never trusted or invented.
3. Between phases, check again. A pool that falls under 10% remaining, or hits a session limit, is replaced within the same tier if the routing rules allow it.
4. Moving work to another account is always the user's call.

## Splitting the work

Split only when one context can't hold the job, or when independence is the point (a blind second look). Recommend it with the reason, and wait for approval.

- **Split for capacity:** each part gets its own librarian (`librarian · <engagement> · <part>`), started as a separate session with this plugin's `librarian` agent and the args `engagement=<folder> part=<part>`. The parts may message each other.
- **Split for independence:** the same, but the parts must not exchange messages or read each other's Log until both have delivered.

Each other part works only in `parts/<part>/` inside the engagement folder: its verbs' numbered outputs and its own `record.md` (same template, `parts: ["<part>"]`) live there. It never writes the main `record.md` or the main numbered outputs. When a part delivers, the `main` librarian merges its outcome into the main record.

---

## Output

- The engagement folder: `record.md`, plus the numbered outputs the verbs write there (`01-frame.md`, `02-gather.md`, `03-understand.md`, `04-synthesize.md`, `05-interrogate.md`). `teach` and `experiment` keep their products elsewhere; the Log links to them.
- Registered experiment runs under `Experiments/`, named in the record.
- The rebuilt index (`RL index`).

Every write goes inside the configured vault folder. Never write the vault's own `index.md`, `log.md` or `Sources/`; other tools own those.

## Suggest next

Never auto-invoke.

- **The job is done and the user wants a new angle** → `research-lab:consult` again with a new goal.
- **The user wants to run one step by hand** → that verb directly, with `engagement=<folder>`.
