# Research Report Template

Template for `lib:vault-store` (or inline PI authoring) when writing a research engagement report.

---

## Expected Sections

```markdown
# Research Report: <engagement-name>

## Executive Summary
<2-3 sentences: what was investigated, what was achieved, key number>

## Engagement Overview
- **Topic:** <research topic>
- **Duration:** <start date> to <end date>
- **Phases completed:** <list>

## Preflight Findings
<Summary of 01-preflight.md — what was found before research began>

## Research Findings
<Key insights from the gathered sources>
<Named concepts from synthesize with definitions>

## Methodology
<What was tested and how — summary of 05-methodology.md>

## Experiment Results
<Include ASCII chart from generate-chart.py>
<Iteration summary: total, keeps, discards>
<Key keeps and what they changed>

### Results Table

| Iteration | Change | Metric | Decision |
|-----------|--------|--------|----------|
<from results.jsonl>

## Final Metric
- **Baseline:** <starting value>
- **Final:** <best achieved value>
- **Improvement:** <percentage>

## Key Learnings
<What worked, what didn't, what was surprising>
<Named concepts that emerged (Atomic Cache Commit, Stale Success, etc.)>

## Recommendations
<What to do next based on findings>

## Artifacts
| Artifact | Location |
|----------|----------|
| Preflight | analysis-reports/research/<engagement>/01-preflight.md |
| Gather | analysis-reports/research/<engagement>/02-gather.md |
| Synthesize | analysis-reports/research/<engagement>/04-synthesize.md |
| Methodology | analysis-reports/research/<engagement>/05-methodology.md |
| Results | analysis-reports/research/<engagement>/results.jsonl |
| NotebookLM | <notebook ID> |
| Vault | ~/Vaults/Neurons/Research/<engagement>/ |
```

---

## Chart Generation

If `results.jsonl` exists, generate the chart:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/generate-chart.py analysis-reports/research/<engagement>/results.jsonl
```

Paste the ASCII output into the Experiment Results section.

---

## Report Quality Checklist

- [ ] Every claim is traceable to a phase artifact
- [ ] Metric improvement is measured, not estimated
- [ ] Named concepts are defined on first use
- [ ] Recommendations are actionable (not "investigate further")
- [ ] Artifacts table has correct paths
