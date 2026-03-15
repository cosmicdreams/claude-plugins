# Context Flow Protocol

All research engagement outputs live in a single engagement directory:

```
analysis-reports/research/<engagement>/
```

Where `<engagement>` is a kebab-case name chosen by the PI at setup (e.g., `pncb-cache-optimization`, `ahri-migration-strategy`).

## Engagement Directory Structure

```
analysis-reports/research/<engagement>/
├── 01-preflight.md           # Preflight audit results
├── 02-literary-review.md     # Synthesized research findings
├── .research.json            # Literary review session state (resume support)
├── 03-workshop.md            # PI's synthesized workshop findings
├── 03-workshop-1.md          # Individual researcher findings
├── 03-workshop-2.md          # Individual researcher findings
├── 03-workshop-N.md          # ...
├── 04-seminar.md             # Cross-examination output: named concepts, decisions, hypotheses
├── 05-methodology.md         # PI-authored experiment spec
├── results.jsonl             # Iteration log (append-only)
└── 07-report.md              # Final engagement report
```

## File Naming Convention

- Numbered prefix = phase order (01 through 07)
- Individual researcher outputs get a `-N` suffix
- `.research.json` is a dot-file (session state, not a deliverable)
- `results.jsonl` has no prefix (it's a log, not a phase output)

## Producer → Consumer Map

| File | Produced by | Consumed by |
|------|------------|-------------|
| `01-preflight.md` | `preflight.sh` + PI | PI (gate decision) |
| `02-literary-review.md` | researcher (literary-review mode) | PI, workshop agents, seminar |
| `.research.json` | literary-review skill | literary-review skill (resume) |
| `03-workshop.md` | PI (synthesized from individual outputs) | seminar, methodology |
| `03-workshop-N.md` | individual researchers | PI (synthesis input) |
| `04-seminar.md` | seminar skill | PI (methodology input) |
| `05-methodology.md` | PI | experimentalist |
| `results.jsonl` | experimentalist | PI, report |
| `07-report.md` | PI / office:report | vault archival |

## Resume Detection

Each phase checks for existing outputs before starting:
- If the file exists and is complete → skip the phase
- If `.research.json` exists with `status: gathering` → research is still running
- If `results.jsonl` exists → experiment can resume from the last ratchet value

## Cross-Phase Context Rules

- Agents read ONLY the files listed in the "Consumed by" column
- No raw context injection between agents — everything flows through files
- The PI is the only agent that reads ALL phase outputs
- Researchers in workshop mode read `02-literary-review.md` for baseline context
