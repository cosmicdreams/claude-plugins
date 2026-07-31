# Changelog

## 4.0.1
- Shrink all 5 skill descriptions to a routing-sufficient summary; the full trigger-phrase detail moves into each SKILL.md body under `## When to use`, where it loads on invocation instead of sitting in context every session.
- Saves roughly 1,666 characters (~416 est. tokens) of always-resident context.
- Descriptions keep the distinctive tool vocabulary and the "not for X, use Y" disambiguation, so routing between sibling skills is unchanged.

## 4.0.0 — 2026-06-10 — Fable-era rewrite (breaking)

Removed orchestration machinery compensating for prior harness limitations. Domain knowledge preserved verbatim.

**DELETED** `skills/research/` — the redirect shim is gone. `research-lab:gather` owns all source-gathering trigger phrases. Install the `research-lab` plugin if not already present.

**DELETED** `skills/reality-check/scripts/update-gate.py` — the Python state machine is retired. The model tracks gate progression in conversation and emits a structured JSON verdict at session end. No `.reality-check.json` file is written during a session; the archive write happens once at Phase 4.

**REWRITTEN** `brainstorm` — removed `.brainstorm.json` session-state ceremony beyond the canvas round-trip. Defensive prose trimmed.

**REWRITTEN** `reality-check` — five-gate KILL funnel and rebuttal rubric preserved verbatim. Added verdict JSON schema. Session archive is a single final write.

**TRIMMED** `compare` — asymmetric scoring (UNKNOWN ≠ NO) and three strategies kept intact. Process narration removed.

**TRIMMED** `diagram` — isomorphism test and Excalidraw JSON reference kept. Phase narration removed.

**TRIMMED** `adr` — content unchanged; prose tightened.

**Breaking:** `ideate:research` trigger phrases no longer route anywhere. Use `research-lab:gather` directly.

## 3.0.0 — Domain boundary with research-lab (breaking)

Clarified the ideate vs research-lab boundary: **ideate works on an idea you are forming;
research-lab works on information that already exists.** Two skills left ideate as a result.

- **REMOVED** `understand` — moved to `research-lab:understand` (it digests existing material).
- **RETIRED** `research` — replaced by `research-lab:gather`. A thin redirect shim remains: it
  routes to `research-lab:gather` when research-lab is installed, otherwise gives an install hint.
- ideate retains: `brainstorm`, `diagram`, `adr`, `reality-check`, `compare`.
- `reality-check` stays — it attacks the *assumptions* of an *unformed* idea (pre-evidence);
  contrast `research-lab:interrogate`, which attacks the *evidence* of a *formed* claim.

**Migration:** `ideate:understand` → `research-lab:understand`; `ideate:research` →
`research-lab:gather`. Both require the research-lab plugin installed.

## 2.2.2
- Fix stale obsidian-rules.md paths in 5 skills (adr, brainstorm, compare, research, understand): office → workflow

## 2.2.1
- All 5 skills: vault writes are now filesystem-direct — no Obsidian CLI dependency
- Remove `shared/` prefix from all vault paths (`shared/Research/` → `Research/`, etc.)
- All skills now reference `obsidian-rules.md` for placement decisions

## 2.2.0
- Removed `ideate:changelog` — use `admin:changelog ideate` instead
- Vault writes across all ideate skills now assume Obsidian is running; `obsidian help` is only run as a diagnostic if the write fails

## 2.1.2
- `ideate:diagram`: sharpen trigger description with specific diagram types (architecture, flowchart, sequence, dependency graph); remove over-broad "visualize this" trigger; add NOT-for exclusions (data charts, written explanations); add ambiguity check step before committing to diagram type; add Obsidian vault path guidance

## 2.1.1
- `ideate:diagram`: fix broken playwright-cli render commands (replaced 4-call session pattern with single one-shot `screenshot` command); add install fallback note; use `OBSIDIAN_VAULT_NAME` env var in Obsidian storage section with filesystem fallback

## 2.1.0
- All four skills (brainstorm, diagram, compare, research) now archive output to the Neurons Obsidian vault after completing
- Vault paths: `shared/Decisions/`, `shared/Architecture/`, `shared/Analysis/`, `shared/Research/` respectively
- Storage is non-blocking — if Obsidian is not running, vault step is skipped cleanly

## 2.0.0
- Add `ideate:changelog` skill — displays ideate CHANGELOG with `--latest` and `--since X.Y.Z` filtering
- Add trigger evals and improved description for `ideate:compare`

## 1.1.0
- Add `ideate:diagram` skill — generate Excalidraw diagrams from natural language; produces `.excalidraw` JSON files
- Add `ideate:reality-check` skill — adversarial scrutiny of brainstormed ideas via a hard-gate KILL funnel
- Add `ideate:research` skill — research a topic using NotebookLM before brainstorming; chains into `ideate:brainstorm`

## 1.0.0
- Initial release — renamed from `brainstorm` plugin; ideate is now the pre-work ideation bounded context
- Skills: brainstorm (visual decision canvas: generate → annotate → synthesize)
- Updated cache path references from brainstorm/ to ideate/
