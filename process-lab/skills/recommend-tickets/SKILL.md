---
name: recommend-tickets
description: >
  Turn an evidence file (such as a drover report's .evidence.json of recurring production
  errors) into Jira ticket recommendations using the project's Jira strategy, and create the ones
  a human approves. Not for producing the evidence (drover:report).
---

# Recommend tickets from evidence

Evidence becomes recommendations; a human decides which become tickets. Strategy and defaults: `${CLAUDE_PLUGIN_ROOT}/references/jira-strategy.md`.

## 1. Recommend

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/ticket_recs.py" --evidence <file.evidence.json> [--format markdown|json]
```

Run it from the project's repository so its `.velir/project.json` `jira_strategy` overrides apply. The output lists each recommended ticket with suggested title, priority, description, and labels, after filtering out recurring errors below the strategy threshold.

## 2. Review with the user

Show the recommendations. Point out any the evidence explains poorly (low cause confidence, coverage gaps in the period). The user keeps, edits, merges, or drops each one; priority is theirs to set.

## 3. Create, if asked

For each ticket the user approves, search the project for an existing open ticket on the same error first and suggest commenting there instead of duplicating. Create the rest in `jira.project` from the manifest, keeping the source label, dropping `suggested` now that a human has approved it, and naming the evidence file in the description.
