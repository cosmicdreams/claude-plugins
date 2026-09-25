---
name: ingest
description: >
  Run the full campaign: pull a manual test corpus out of a test management tool,
  triage what is automatable, and drive test-lab:automate across it. Use when standing
  up or refreshing coverage. Not for a single story (test-lab:automate).
---

# Ingest a test corpus

The campaign around `test-lab:automate`. Pulls the corpus, sizes it honestly,
and works through it — rather than converting cases one at a time and never
learning how much there is.

## Step 1: pull, once, completely

Pick the adapter in `${CLAUDE_PLUGIN_ROOT}/references/sources/` for the tool in
play. `testrail.md` is
written; other tools need an adapter, not changes to this skill.

Two rules that survive any source:

**Read the credential once.** Every secret-manager invocation is a separate
prompt to a human. One read at the top of one script, passed by environment
variable, never written to disk.

**Pull the full payload the first time.** Titles and identifiers tell you a case
exists but not what it asserts. A metadata-only pull has to be redone, which
costs another authorization and another interruption.

Commit the raw payload to the repository beside the tests. That is what lets
someone author without a seat in the tool, and what lets a future source be
diffed against this one.

## Step 2: verify access before believing the result

An empty or short result usually means missing project membership, not a bad
credential. Check whether the account can see the project at all before
troubleshooting the key. Say which account was used — if it is a shared one, that
is a finding to report, not an implementation detail to bury.

## Step 3: triage before promising anything

Classify every case. Do not skip to authoring; the ratio is the thing that makes
the estimate honest.

| Bucket | Signal in the case text |
|---|---|
| anonymous front end | public paths, display and responsiveness assertions |
| needs authentication | administrative paths, "log in", authoring language |
| form submission | submits, sends email, captcha |
| human judgement | "looks correct", visual comparison, design match |
| out of scope | belongs to a subsystem not under test |

**Let Jev take the clear cases first.** When `TYPESAFE_API_KEY` is set (and
`JEV_DISABLED` is not `1`), TypeSafe's Jev model answers one Choice per case
over the table above. Write the cases as JSON — `id`, `title`, `steps`,
`expected`, `preconditions`, `section` — plus a one-sentence `scope`
describing the system under test, and run:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/triage_cases.py" < cases.json > triage.json
```

Every verdict names its source. `"source": "jev"` carries the bucket, the
model version, the confidence, and the threshold it cleared (0.8 to start;
tune in the script). `"source": "fallback"` carries a reason — no key,
low confidence, a timeout — and you classify that case yourself from the
table, exactly as before. When Jev is unavailable every case is fallback
and nothing changes. Report the counts (`counts.jev` / `counts.fallback`)
with the distribution so the reader knows how much was machine-sorted.

Report the distribution and the priority spread. Expect roughly half to be
automatable anonymously; expect a large authenticated block.

**Check any automation flag before trusting it.** A field that looks like it
marks cases for automation is frequently unset on every case, and reading it as
signal will send the whole campaign in the wrong direction.

**Authentication is rarely the blocker it looks like.** On a Drupal site a
one-time login link gives a session for any role locally, with no module and no
stored password. Confirm that before writing off an authenticated block.

## Step 4: render for authoring

Produce something a person can read without the tool open: steps, expected
results and preconditions, grouped by area. Split a large suite by top-level
section; keep small suites whole. Include the suite identifier in filenames and
assert filename uniqueness and total count — silent overwrites from colliding
names are the common failure here.

## Step 5: sequence the campaign

Order by value, not by case number:

1. anything guarding a fix that just shipped and has no coverage
2. the densest automatable section — usually global chrome
3. the smoke-priority band
4. the authenticated block, once a session harness exists

Then run `test-lab:automate` per case. Keep the unit of work at one case: a batch
that writes twenty specs without a red check on any of them produces twenty tests
nobody trusts.

Track the campaign in `COVERAGE-PROGRESS.md` (or one `bd` issue per section), with one row per case id and status `todo | spec-written | red-checked | blocked:<reason>`. Update the row right after each `test-lab:automate` run. On resume, read it first.

## Step 6: run the suite before you call it delivered

A campaign is not finished when the specs are written. It is finished when
someone else can see what they do.

Run the whole suite and keep the report:

```bash
npx playwright test --reporter=html   # writes playwright-report/
node tests/e2e/support/check-tags.mjs
```

Deliver `playwright-report/` alongside the code. The pass and fail snapshot,
the execution times and — most of all — the skips are what let a reviewer judge
the suite without running it, and the first thing a reviewer asks for when it is
missing. A suite handed over without evidence it was ever run green is a suite
the reviewer has to reproduce from scratch before they can even start.

If specs fail or skip, say which and why in the same breath as the number. An
unexplained skip reads as a broken test.

## Step 7: report the boundary

State how many cases exist, how many are automatable, how many are covered, and
what the remainder is blocked on. A corpus of several hundred will not become
several hundred specs, and saying so early is worth more than discovering it at
review.

Record gaps in `COVERAGE-GAPS.md` with unlock signals so a later reader can tell
a decision from an oversight. Include the raw corpus payload committed in Step 1,
so the cases that were automated can be cross-referenced against the cases that
exist — traceability is what makes the coverage number checkable rather than
asserted.
