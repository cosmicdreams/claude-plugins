# Methodology Template

The PI fills in this template to produce `05-methodology.md` for the experimentalist.

---

```markdown
# Methodology: <engagement-name>

## Objective

<What metric are we optimizing? What is the target value?>

**Metric:** <Exactly ONE number. Not two metrics. Not a qualitative assessment.>
**Direction:** <"higher is better" or "lower is better">
**Target:** <Numeric target value>

## Baseline

- **Current value:** <measured baseline>
- **Measurement method:** <how the metric is captured>
- **Measurement harness:** <path to measure script or command>

## Hypotheses (ranked by expected impact)

1. <Hypothesis from synthesize output — highest priority>
2. <Next hypothesis>
3. <...>

## Iteration Rules

- **Budget:** <max iterations, e.g., 20>
- **Futility threshold:** <consecutive discards before stopping, default 5>
- **Noise handling:** <median of N runs, e.g., median of 3>
- **Ratchet seed:** <initial ratchet value = baseline>

## Sampling Method

<How were the test pages chosen? The experimentalist must reproduce this exactly.>

- **Method:** <e.g., "One published page per content type, discovered via drush SQL query">
- **Sample size:** <N pages>
- **Pages:**
  - <page 1 path> (<content type>)
  - <page 2 path> (<content type>)
  - <...>

## Measurement Protocol

<Exact steps to measure the metric across ALL sample pages. The experimentalist follows this literally.>

1. <Step 1>
2. <Step 2>
3. <...>

## Correctness Checks

<What must remain true after each change? These are regression guards.>

- [ ] <Check 1, e.g., "Site returns 200 on all test pages">
- [ ] <Check 2, e.g., "No PHP errors in watchdog">
- [ ] <Check 3>

## Scope Constraints

<What is the experimentalist allowed to change? What is off-limits?>

- **In scope:** <e.g., "Drupal cache configuration, Views display settings, cache tag hooks">
- **Out of scope:** <e.g., "Server configuration, CDN settings, PHP version">

## Working Directory

<Path where the experimentalist makes changes>

## Notes

<Any additional context from preflight, gather, or synthesize that the experimentalist should know>
```
