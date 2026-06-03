---
name: research
description: >
  RETIRED — superseded by research-lab:gather. This is a thin redirect shim kept so legacy
  trigger phrases still land somewhere useful. NotebookLM-powered source gathering moved to the
  research-lab plugin's `gather` verb, which has a broader input contract and modern NotebookLM /
  Workflow integration. Say "gather research on", "research this topic", or "build a notebook on".
triggers:
  - "research before brainstorming"
  - "ideate:research"
allowed-tools: Read
---

# research (retired → research-lab:gather)

This skill has been **retired**. Its job — create a NotebookLM notebook, seed sources, fire deep
web research, curate, and summarize — now lives in the **research-lab** plugin as the `gather`
verb (part of the research-arc reorganization in research-lab 2.0).

## What to do

1. **If the `research-lab` plugin is installed**, redirect: invoke `research-lab:gather` with the
   user's topic. It is a strict superset of this skill — same NotebookLM gathering plus a uniform
   input contract, async deep-research via a harness-tracked background task, and chaining into
   `research-lab:understand` / `synthesize`.

   > "`ideate:research` was retired in favor of `research-lab:gather`. Running that instead."

2. **If `research-lab` is NOT installed**, do not fail silently. Tell the user:

   > "Source-gathering moved to the `research-lab` plugin (`gather`). Install it with
   > `claude plugin install research-lab@local --scope user`, or paste the sources you already
   > have and I'll work from those."

This shim performs no gathering itself — it only routes. The `ideate` plugin no longer owns a
research/gathering verb; ideation works on ideas you are forming, not on an external corpus
(see the research-lab vs ideate domain boundary).
