# Seminar pilot: provisional results

Pilot date: 2026-11-02. The prototype compared four beats plus a free student (B), five free students (F), and one generalist (O). Each arm had a cap of 30 child calls and the same pilot corpus. No arm had an execution error.

B found one valid held-out gap; F and O found none. B and F used 11 child calls each, O used three. These are child calls, excluding notebook queries. The notebook received 30, 30, and 20 queries respectively. The generalist produced 20 questions despite an allowance of 30.

The experiment does not establish a winning production design:

- One of three held-out sources leaked through a mirror, leaving two valid planted gaps. No real contradiction pair was planted.
- There was one run per arm and only one detected planted gap overall.
- Every challenged student conceded in round one. Narrowed claims received no independent recheck, so the experiment did not exercise sustained debate.
- Skeptic acceptance varied substantially between arms, a potential confound.
- Lexical deduplication let near-paraphrases consume notebook queries.
- The independent `interrogate` gate failed, so surviving false claims were not measured and settled claims cannot be labeled verified.

All twenty blind ratings were completed on 2026-11-03. B scored 24/35 across seven questions (mean 3.43), F scored 25/35 across seven (3.57), and O scored 18/30 across six (3.00); all medians were 3. These are descriptive aggregates, not a preregistered rating metric. F rates slightly higher, while B found the only valid planted gap. The rules do not specify how to combine those conflicting measures, so no automatic winner is declared. Rating instructions were also challenged as ambiguous before completion; the scores do not separately measure clarity, novelty or decision impact. B was the provisional full-corpus choice before ratings. Further production build work remains stopped.

The deterministic helpers and regression fixtures are provided for review. There is no `seminar/SKILL.md`, plugin registration, or production wiring.

The corrected interrogate rubric later passed a fresh regression gate; see [the follow-up results](../../tests/eval/interrogate/RUBRIC_V2_RESULTS.md). This does not retroactively score the pilot claims or resolve the split design result.
