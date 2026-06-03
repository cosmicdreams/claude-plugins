# Context Flow Convention

The research-lab verbs are standalone and compose freely — there is **no fixed pipeline and no
over-all orchestrator**. This document is an *optional convention*: when several verbs are composed
into one inquiry (by a user, by the `principal-investigator` role, or by a domain skill that calls
the verbs), they can share a single engagement directory so artifacts hand off cleanly and the work
is resumable. Run a verb on its own and it just presents inline instead — none of this is required.

```
analysis-reports/research/<engagement>/
```

Where `<engagement>` is a kebab-case name chosen at setup (e.g., `mysite-cache-optimization`,
`mysite-migration-strategy`).

## Engagement Directory Structure

```
analysis-reports/research/<engagement>/
├── 01-frame.md              # Framed question + falsification bar (frame verb)
├── 02-gather.md             # Curated source summary (gather verb)
├── .research.json           # Gather session state (resume support)
├── 03-understand.md         # Digested concepts (understand verb)
├── 04-synthesize.md         # Formed position: named concepts, decision table, ranked hypotheses
├── 05-interrogate.md        # (optional) adversarial peer-review verdict
├── 05-methodology.md        # (optional) experiment spec, when an experiment is run
├── results.jsonl            # Iteration log (append-only, experiment verb)
└── 07-report.md             # Final engagement write-up
```

## File Naming Convention

- The **filename stem is the identity** of the artifact (e.g. `synthesize`, `methodology`) — that is
  what verbs and resume checks key on.
- The **numeric prefix is a sort hint only**, not an ordering contract. Numbers may repeat or be
  skipped when an inquiry composes the verbs in a different order or omits some — composition is not
  a pipeline, so two artifacts sharing a prefix is fine, not a conflict.
- `.research.json` is a dot-file (session state, not a deliverable).
- `results.jsonl` has no prefix (it's a log, not a phase output).
- An orchestrating skill may add its own files around these (e.g. a domain-specific preflight audit).
  Those belong to that skill, not to research-lab.

## Producer → Consumer Map

When verbs are composed, each reads the upstream artifacts it needs:

| File | Produced by | Read by (when present) |
|------|------------|-------------|
| `01-frame.md` | `frame` verb | `gather`, `synthesize`, `interrogate` (the pre-registered bar) |
| `02-gather.md` | `gather` verb | `understand`, `synthesize` |
| `.research.json` | `gather` verb | `gather` verb (resume) |
| `03-understand.md` | `understand` verb | `synthesize` |
| `04-synthesize.md` | `synthesize` verb | `interrogate`, `teach`, methodology authoring |
| `05-interrogate.md` | `interrogate` verb | the author of the position (revise or proceed) |
| `05-methodology.md` | whoever designs the experiment (a user, or the PI role) | `experiment` verb |
| `results.jsonl` | `experiment` verb | the report write-up |
| `07-report.md` | the report author (PI role or you) | vault archival |

## Resume Detection

A composed run can check for existing outputs before redoing work:

- If an artifact exists and is complete → that step is already done.
- If `.research.json` exists with `status: gathering` → research is still running.
- If `results.jsonl` exists → an experiment can resume from the last ratchet value.

## Composition Notes

- A verb reads the upstream artifacts it needs and writes its own; nothing forces it to run after any
  particular predecessor.
- Vault archival is a plain filesystem copy to `$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}` — no
  plugin dependency. If the `lib` plugin is installed, `lib:vault-store` can route placement, but it
  is optional.
