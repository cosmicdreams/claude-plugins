---
id: lint-008
name: missing-preflight-contract
tier: warn
applies-to: research-lab
pattern: A research-lab verb SKILL.md is missing the uniform "Input contract" + "Preflight" block
created: 2026-06-03
source: research-lab 2.0 design — standalone compositional primitives require a uniform, lintable preflight-first structure (plan §2).
---

## Problem

research-lab 2.0 is built on **standalone compositional primitives**: every verb must stand alone
given the right input, never assume a previous step ran this session, and never auto-invoke another
skill to fill a gap. The mechanism that enforces this is a **uniform preflight-first block** at the
top of every verb's `SKILL.md`:

```
## Input contract
- Requires: <precondition(s)>
- Resolves from: context → arg/file → notebook id

## Preflight
1. Check context for the required input. If present, use it.
2. Else check for an arg / file path / notebook id and load it.
3. Else FAIL FAST: state what is missing and which upstream verb produces it. Stop.
```

A verb missing this block (or missing the fail-fast step) silently re-introduces the pipeline
coupling 2.0 deletes — it may run on stale context, or quietly do another verb's job.

## Detection

For each `SKILL.md` under `research-lab/skills/*/`, flag when **any** of these is true:

- No `## Input contract` heading.
- No `## Preflight` heading.
- The contract block is present but has no **fail-fast** branch (no "FAIL FAST" / "Stop." that
  names the missing input and the upstream verb that produces it).
- The preflight **auto-invokes another skill** to satisfy its own contract (e.g. calls
  `Skill(...)` to manufacture missing input) instead of *suggesting* the upstream verb. Auto-chaining
  rebuilds the pipeline; only suggestion is allowed.

Does NOT apply when:

- The file is a reference, agent, protocol, or template — only verb `SKILL.md` files.
- The skill is an orchestrator that legitimately drives sub-skills with explicit, user-invoked
  input (e.g. `drupal-lab:optimize`), where the contract lives in the orchestrated verbs.

## Fix

Add the uniform `## Input contract` + `## Preflight` block near the top of the SKILL.md (after the
title/stance, before the work instructions). Ensure the third preflight step **fails fast and
suggests** the upstream verb — it must not auto-invoke another skill. The contract line is the only
part that differs per verb; the structure is identical across all of them so it is mechanically
checkable.
