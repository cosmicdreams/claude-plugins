# Phase Gates

Go/no-go criteria for each phase transition. The PI reads this before advancing past any gate.

## Phase 2 Gate: Preflight → Literary Review

**Go conditions:**
- `01-preflight.md` exists and has structured output
- No critical blockers identified (or critical blockers have been resolved)
- User has confirmed the engagement scope

**No-go triggers:**
- Critical infrastructure issues (site down, no access, missing credentials)
- Preflight script failed to run or produced no output
- User has not confirmed scope

**Action on no-go:** Fix the blocker. Re-run preflight. Do not create the team until this gate passes.

---

## Phase 3 Gate: Literary Review → Workshop

**Go conditions:**
- `02-literary-review.md` exists with structured content
- NotebookLM notebook created and notebook ID recorded
- At least 5 curated sources in the notebook
- User/PI has reviewed and approved the source list

**No-go triggers:**
- Research still gathering (`.research.json` status = `gathering`)
- Fewer than 5 sources — insufficient knowledge base
- Sources are off-topic or low quality

**Action on no-go:** Wait for research to complete, add more seed sources, or curate existing sources.

---

## Phase 4 Gate: Workshop → Seminar

**Go conditions:**
- All `03-workshop-N.md` files exist (one per spawned researcher)
- `03-workshop.md` synthesis written by PI
- At least 3 distinct research facets explored
- No researcher reported being unable to find relevant information

**No-go triggers:**
- Missing individual researcher outputs
- Synthesis not yet written
- A facet came back empty (may need different questions or more sources)

**Action on no-go:** Re-query empty facets with different questions, or add more sources and re-run.

---

## Phase 5 Gate: Seminar → Methodology

**Go conditions:**
- `04-seminar.md` exists with:
  - At least 2 named concepts
  - A decision table with ranked options
  - Ranked hypotheses (at least 3)
- PI has reviewed and can articulate the research position

**No-go triggers:**
- Seminar produced only surface-level summaries (no named concepts)
- No clear hypotheses emerged
- Contradictions unresolved

**Action on no-go:** Re-run seminar with sharper questions, or add more context from the user.

---

## Phase 6 Gate: Methodology → Experiment

**Go conditions:**
- `05-methodology.md` exists with all required sections (see methodology-spec.md)
- User has reviewed and approved the methodology
- Measurement harness is prepared and tested (can run once and produce a number)
- Working directory identified and accessible

**No-go triggers:**
- Missing required methodology sections
- No measurement harness or harness produces errors
- User has not approved the approach

**Action on no-go:** Complete the methodology, fix the measurement harness, get user approval.

---

## Phase 7 Gate: Experiment → Report

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
