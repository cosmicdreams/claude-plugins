# Rival-explanations correction: frozen evaluation protocol

Registered before fresh examiner calls on 2026-11-03. The optimization target is to stop rejecting supported claims solely because they do not explicitly discuss rivals, without excusing a stronger rival supported by the corpus.

Only the four rival-explanations anchors change. Score 2 requires checking the corpus and finding no supported rival that materially weakens the claim; it does not require inventing a rival or writing a rebuttal to one. Evidence strength, reproducibility, consistency, relevance, citations, rebuttals and verdict rules remain unchanged. This does not make lack of a rival into evidence for an unsupported claim.

The primary gate uses the existing twelve fixtures unchanged, three fresh runs per fixture and all five dimensions. Rebuttal occurs once for scores 0–1. Balanced accuracy must be at least 0.75, flip rate at most one third, and all 180 first-round dimension results must be present and valid. No historical scores are reused. New targeted rival-only controls run three times each and are reported separately, never added to inflate primary-gate accuracy.

| Hypothesis | Workload and method | Threshold / decision |
| --- | --- | --- |
| Supported claims recover | Six original sound cases, three runs each; apply unchanged verdict rule | At least 15/18 survive; otherwise reject or narrow the correction |
| No-rival claims can pass | Direct-configuration control; independent rival scores in three runs | All scores at least 2; otherwise reject |
| Ruled-out rivals still pass | Controlled-routing control; independent rival scores in three runs | All scores at least 2; otherwise reject |
| Stronger supported rivals still fail | Ignored-authentication control; independent rival scores in three runs | All scores below 2; otherwise reject |
| Flawed cases stay flawed | Six original flawed cases, three runs each | At least 15/18 rejected or contested; otherwise reject |
| Relevance is not weakened | Both original off-goal cases, three runs each | No off-goal case survives; otherwise reject |
| Stability and execution do not regress | Frozen-fixture flip rate, schema and quotation validation | Flip rate at most one third; no missing/invalid results; errors cannot count as passes |
| Cost stays bounded | Record actual examiner tasks and individual dimension results separately | At most 80 examiner calls; no repeated tuning against the observed results |

Controls and baseline: preserve the original 0.50 balanced-accuracy failure and its raw results. Use the same provider, model, effort and batching as that baseline: Codex `gpt-6.1-terra` high, one dimension across six blinded submissions per examiner, with paired sound/flawed cases in different packets. Three repeats yield thirty first-round tasks. The nine targeted control runs each get their own task and never expose expected scores. Reviewer approval is independent and separate from the model evaluation.

Confounders: batching is not production's one-submission-per-examiner isolation; the original fixtures informed this correction, so fresh calls are a regression rerun rather than unseen-data validation; synthetic targeted controls cover only the intended distinction. Model variance, run order, and the fixed evidence-as-corpus fixture design remain limitations. No seminar winner, production installation, or rescore of prior study claims is implied by passing this gate.

Raw packets, replies, mappings, provenance and result summaries belong in the pilot engagement's `rubric-v2/` directory. A failed run stays failed; later changes require an explicitly new protocol and result directory.
