# seminar

`research-lab:seminar` runs a multi-agent study of one corpus against a study brief. The instructions agents follow are in [SKILL.md](SKILL.md); this file is for maintainers.

## Files

| Path | Role |
| --- | --- |
| `SKILL.md` | The moderator's procedure, input contract and report rules. |
| `scripts/seminar.py` | Deterministic ledger, brief writer, reply validator and report writer. Makes no model calls. |
| `references/examination-techniques.md` | The four beats and the rules for writing a good question. Also used by `synthesize`. |
| `../interrogate/scripts/interrogate.py` | Scores each settled claim; seminar checks its scores and `submission_sha256`. |

## How it is found

Claude Code discovers the skill from `skills/seminar/SKILL.md` once the research-lab plugin is installed; there is no manifest entry to add. Its name and description load into every session; the body loads only when the skill runs. The description ends with a "Not for" clause pointing to `research-lab:synthesize`, and `synthesize` no longer claims the `research-lab:seminar` trigger.

## Outputs

`report RUN --out DIR` writes:

- `seminar.json` — the machine contract: fit per goal, claims by bucket (held, failed, contested, unsettled, incomplete or unscored), source gaps, execution failures, new questions, plan changes, vocabulary, cost, child links and `next_action`.
- `seminar.md` — readable findings, limits and next questions.
- `gather-input.json` — new questions in `gather`'s input shape.

## Local validation

From the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s research-lab/tests -p 'test_*.py' -v
```

These tests drive the scripts with fixture replies. They prove the ledger rules (budget, citation checks, round cap, merge, rerun limits, fingerprint check, report buckets). They do **not** prove that a live run works: real notebook queries, real child agents, cross-provider routing and report readability are only shown by an actual end-to-end run, which is a separate check.

## Operating defaults

- Arm B (four themed students plus one free student) is the maintainers' default after a mixed pilot. Arm F (five free students) and arm O (one questioner) remain available. The choice is not a claim of experimental superiority.
- The 120-call budget and the three-round cap are operating limits, not tuned values.
