# Corrected rival rubric: fresh regression gate passed

Date: 2026-11-03. Protocol: [RUBRIC_V2.md](RUBRIC_V2.md). Machine-readable results: [rubric-v2-summary.json](rubric-v2-summary.json). The original failed evaluation is preserved in [PILOT.md](PILOT.md).

| Measure | Original | Fresh corrected rubric | Requirement |
| --- | --- | --- | --- |
| Balanced accuracy | 0.50 | 0.9167 | At least 0.75 |
| Sound runs surviving | 0/18 | 15/18 | At least 15/18 in this protocol |
| Flawed runs rejected/contested | 18/18 | 18/18 | At least 15/18 in this protocol |
| Verdict flip rate | 1/12 | 0 | At most one third |
| Execution errors | 0 | 0 | None in the fresh run |

The frozen twelve fixtures ran three times each across all five dimensions. All 180 initial and 60 rebuttal scores validated. All eighteen sound runs initially scored 2 on rival explanations; the old rubric scored them all 1. The verdict rule and other four rubrics were unchanged.

Nine additional rival-only control runs passed their predeclared ranges: direct configuration scored 3/2/3, the ignored stronger authentication rival scored 0/0/0, and the explicitly ruled-out rival scored 3/3/3. These controls are separate from primary-gate accuracy. Examiners used Codex `gpt-6.1-terra` high. There were 30 initial batch tasks, 28 rebuttal tasks and 9 standalone controls: 67 examiner calls within the cap of 80.

The remaining false rejection is `sound-alternative-explanation`, contested in all three runs. Evidence strength and reproducibility scored 1 because its one-line allowed-tools excerpt does not establish uniqueness or whole-file scope. Rival explanations scored 2. This is an unresolved evidence/fixture limitation; the other rubrics and expected verdict were not retuned to force a pass.

This is narrow regression evidence, not unseen-data or production validation. The frozen fixtures informed the correction. As in the baseline, a child scored one dimension across up to six submissions rather than production's single-submission isolation. Opaque copied corpus filenames improved blinding relative to the baseline, so this is not a perfectly isolated one-factor experiment. Source bytes, input hashes, raw packets, replies, mappings and task links are retained in the local pilot engagement under `rubric-v2/`.

All 42 local research-lab unit tests pass with the corrected scorer. No production skill registration, seminar design selection, or retroactive scoring of earlier study claims is included.

The runner's `gate_pass` excludes incomplete verdicts from accuracy and does not itself reject execution errors. For this protocol, coverage, errors and targeted controls were checked separately from the raw files before accepting the gate; the independent reviewer reproduced all 180 initial and 60 rebuttal results and the zero-error result. Do not use the runner flag alone as the protocol acceptance decision.

Reviewed with review-loop: one round with Claude Opus 5.5 medium. Verdict: approved. The review reproduced the gate from raw replies and verified mappings, hashes, control scores and rebuttal coverage. A wording-only unit-test suggestion was declined in favor of the live behavioral controls.
