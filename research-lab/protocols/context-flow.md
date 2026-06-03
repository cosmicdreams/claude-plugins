# Context Flow Protocol

All research engagement outputs live in a single engagement directory:

```
analysis-reports/research/<engagement>/
```

Where `<engagement>` is a kebab-case name chosen by the PI at setup (e.g., `mysite-cache-optimization`, `mysite-migration-strategy`).

## Engagement Directory Structure

```
analysis-reports/research/<engagement>/
├── 01-preflight.md           # Preflight audit results
├── 02-gather.md              # Curated source summary (gather verb)
├── .research.json            # Gather session state (resume support)
├── 04-synthesize.md          # Formed position: named concepts, decision table, ranked hypotheses
├── 05-interrogate.md         # (optional) adversarial peer-review verdict
├── 05-methodology.md         # PI-authored experiment spec
├── results.jsonl             # Iteration log (append-only)
└── 07-report.md              # Final engagement report
```

## File Naming Convention

- Numbered prefix = phase order
- `.research.json` is a dot-file (session state, not a deliverable)
- `results.jsonl` has no prefix (it's a log, not a phase output)

## Producer → Consumer Map

| File | Produced by | Consumed by |
|------|------------|-------------|
| `01-preflight.md` | `preflight.sh` + PI | PI (gate decision) |
| `02-gather.md` | `gather` verb | `understand`, `synthesize`, PI |
| `.research.json` | `gather` skill | `gather` skill (resume) |
| `04-synthesize.md` | `synthesize` verb | PI (methodology input), `interrogate`, `teach` |
| `05-interrogate.md` | `interrogate` verb | PI (verdict — revise or proceed) |
| `05-methodology.md` | PI | experimentalist |
| `results.jsonl` | experimentalist | PI, report |
| `07-report.md` | PI / lib:vault-store | vault archival |

## Resume Detection

Each phase checks for existing outputs before starting:
- If the file exists and is complete → skip the phase
- If `.research.json` exists with `status: gathering` → research is still running
- If `results.jsonl` exists → experiment can resume from the last ratchet value

## Cross-Phase Context Rules

- Agents read ONLY the files listed in the "Consumed by" column
- No raw context injection between agents — everything flows through files
- The PI is the only agent that reads ALL phase outputs
- Researchers in facet-query mode read `02-gather.md` for baseline context
