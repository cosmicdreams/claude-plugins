# Refinery rules

Scoring thresholds and page shapes the refinery applies to shared wiki layers. Change them here, not in the agent definition.

## Contradictions

`tension_score = avg(source_confidences) * source_type_weight_delta * (1 + recency_gap_days/365)`

| tension | action |
| --- | --- |
| below 0.3 | add a `^conflict` marker on the weaker claim |
| 0.3 up to 0.8 | reduce the weaker source's confidence by 0.20; record `tension_score` in the concept frontmatter |
| 0.8 and above | create `Conflicts/<date>-<concept-slug>.md` and append it to `_meta/conflicts.md` |

## Bridges

Applies when a concept has at least two backlinks from at least two distinct domains. `bridge_score = min(domain_counts) / max(domain_counts)`.

| bridge score | action |
| --- | --- |
| below 0.3 | set `bridge_candidate: true` in the concept frontmatter |
| 0.3 and above | create `Bridges/<Concept>.md` |
| 0.7 and above | also set `moc_elevated: true` and link it from each domain's `_landing.md` |

## Concepts/ page frontmatter

```yaml
type: concept
domain: [<list of affected domain slugs>]
title: "..."
summary: "..."
provenance:
  origin: synthesized
  source_ids: [<paths of all source pages>]
  created_at: YYYY-MM-DD
  created_by: refinery
timeline:
  - event_at: YYYY-MM-DD
    learned_at: YYYY-MM-DD
    claim: "consolidated from N sources"
    agent: refinery
timeline_truncated: false
confidence: 0.75
confirmation_count: 3
decay_class: <slowest class across constituent domains>
last_confirmed: YYYY-MM-DD
last_touched: YYYY-MM-DD
state: fresh
hardened: false
backlink_density: <count>
bridge_score: null
tension_score: 0.0
```
