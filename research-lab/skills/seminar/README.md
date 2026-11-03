# seminar — prototype (not a skill yet)

Deterministic helpers for the seminar pilot in `plans/research-lab/seminar-and-interrogate.md` §4–§6. There is deliberately no `SKILL.md`: completed human ratings leave a split pilot result with no defined tie-break, and the `interrogate` rebuild it calls failed its regression gate (see below). Nothing here is installed as a skill.

## How a run works

The thread that runs the seminar is the moderator. It runs `scripts/seminar.py`, hands each brief the script writes to a separate child agent (T3 `delegate_task`), saves the child's JSON reply, and runs the script again to ingest it. No model calls happen inside the script.

```
init → (moderator writes map.md) → student-briefs → [students] → ingest
     → answer each item from the notebook (record-answer)
     → debate-briefs --round k → [skeptic] → ingest-skeptic → [students] → ingest-replies   (k ≤ 3)
     → claims → [interrogate] → record-interrogate → report
```

`count-call` enforces the per-arm child budget; `planted-judge-brief` / `score-planted` and `rating-sheet` support the pilot's measures.

## Known limits found by the pilot (2026-11-02)

- Dedupe is lexical (token Jaccard ≥ 0.8); paraphrased duplicates pass through.
- A student concession settles an item without the skeptic re-checking the narrowed claim.
- The report's "held" bucket depends on `interrogate`; without it, settled claims are listed as `settled_unscored`.

## interrogate rebuild

`../interrogate/scripts/interrogate.py` implements plan §3 (five scored dimensions, script-stamped dimensions, citation check, rebuttal pass, fixed verdict rule) and `tests/eval/interrogate/` holds the regression eval (8 S03 fixtures + 4 relevance fixtures). It **failed** its gate on 2026-11-02 (balanced accuracy 0.50 vs 0.75): the rival-explanations rubric scores every claim that does not argue against rivals at 1, so no sound claim survives. `interrogate/SKILL.md` is unchanged and still describes the 5.0 panel.
