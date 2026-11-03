# Interrogate regression gate: failed

Pilot date: 2026-11-02. This is experimental support code, not an installed replacement for the existing `interrogate` skill.

The preregistered gate required balanced accuracy of at least 0.75 and a flip rate of at most one third. Twelve fixtures ran three times each: eight existing fixtures and four relevance fixtures. There were no execution errors.

All 18 sound submissions failed to survive; all 18 flawed submissions were rejected or contested. Balanced accuracy was **0.50**. The flip rate was 1/12 (0.083). The gate therefore failed and the production build stopped.

The rival-explanations dimension scored every sound submission at 1, including after rebuttal. Its anchors require considering rivals even when the corpus contains no stronger rival. The fixed rule requiring every dimension to score at least 2 consequently prevented any sound submission from surviving.

Dropping that dimension after seeing the results gives 0.94 balanced accuracy. That is exploratory evidence, not a passing gate. A proposed follow-up is to anchor score 2 to the absence of a stronger supported rival and score 1 to an ignored supported rival, then run a fresh evaluation before adoption.

The experiment used 30 first-round and 27 rebuttal examiner children. Each examiner scored one dimension across six submissions; paired submissions never shared an examiner. This reduced calls but differs from production isolation. The evidence text served as the fixture corpus. Examiners used Codex `gpt-6.1-terra` at high effort. All 261 dimension results carried a quote found in the evidence; the script assigned the dimension rather than trusting the examiner to echo its role.

Existing production skills remain unchanged. These results do not close the existing production bugs or establish readiness to ship the rebuild.

## Follow-up

The corrected anchors passed a fresh gate on 2026-11-03; see [RUBRIC_V2_RESULTS.md](RUBRIC_V2_RESULTS.md). The failed original results above remain unchanged.
