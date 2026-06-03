# Phase Gates

Go/no-go criteria for each phase transition. The PI reads this before advancing past any gate.

## Phase 2 Gate: Preflight → Gather

**Go conditions:**
- `01-preflight.md` exists and has structured output
- No critical blockers identified (or critical blockers have been resolved)
- User has confirmed the engagement scope

**No-go triggers:**
- Critical infrastructure issues (site down, no access, missing credentials)
- Preflight script failed to run or produced no output
- User has not confirmed scope

**Action on no-go:** Fix the blocker. Re-run preflight.

---

## Phase 3 Gate: Gather → Synthesize

**Go conditions:**
- `02-gather.md` exists with structured content
- NotebookLM notebook created and notebook ID recorded
- At least 5 curated sources in the notebook
- User/PI has reviewed and approved the source list

**No-go triggers:**
- Research still gathering (`.research.json` status = `gathering`)
- Fewer than 5 sources — insufficient knowledge base
- Sources are off-topic or low quality

**Action on no-go:** Wait for research to complete, add more seed sources, or curate existing sources.

---

## Phase 4 Gate: Synthesize → Methodology

`synthesize` absorbed the old workshop (facet coverage) and seminar (decision-forming) work, so
there is now a single gate where there used to be two.

**Go conditions:**
- `04-synthesize.md` exists with:
  - A formed position answering the engagement's question
  - At least 2 named concepts
  - A decision table with ranked options
  - Ranked hypotheses (at least 3)
- PI has reviewed and can articulate the research position
- *(High-stakes engagements)* the position survived `research-lab:interrogate`, or the PI
  consciously accepted the verdict

**No-go triggers:**
- Synthesis produced only surface-level summaries (no formed position, no named concepts)
- No clear hypotheses emerged
- Contradictions unresolved

**Action on no-go:** Re-run synthesize with a sharper question, add more sources via gather, or
resolve the contradictions an interrogate pass surfaced.

---

## Phase 5 Gate: Methodology → Experiment

**Go conditions:**
- `05-methodology.md` exists with all required sections (see research-lab's methodology-spec.md)
- User has reviewed and approved the methodology
- Measurement harness is prepared and tested (can run once and produce a number)
- Working directory identified and accessible

**No-go triggers:**
- Missing required methodology sections
- No measurement harness or harness produces errors
- User has not approved the approach

**Action on no-go:** Complete the methodology, fix the measurement harness, get user approval.

---

## Phase 6 Gate: Experiment → Report

**Go conditions:**
- `results.jsonl` exists with at least one iteration
- At least one `keep` decision recorded, OR user explicitly accepts current state
- No pending reverts (all discards properly reverted)
- Experimentalist has reported completion or futility

**No-go triggers:**
- Experiment still running
- All iterations were discards and user hasn't accepted the state
- Git state is dirty (pending uncommitted changes or un-reverted discards)

**Action on no-go:** Wait for experiment completion, or accept current state explicitly.
