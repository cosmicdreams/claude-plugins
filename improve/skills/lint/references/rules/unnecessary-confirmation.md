---
id: lint-005
name: unnecessary-confirmation
tier: watch
applies-to: any
pattern: Process-engineer asks for confirmation on changes classified as high-confidence in the trust model
created: 2026-03-20
source: Coaching — user said "if I have a really high confidence you wouldn't ask me." High-confidence fixes are autonomous by definition.
---

## Problem

The process-engineer asks for human confirmation before applying changes that its own trust model classifies as high-confidence (clear evidence, low risk, reversible). This defeats the purpose of the trust model and makes the human a bottleneck for routine fixes.

## Detection

In process-engineer output, look for patterns like:
- "Want me to apply these?" after listing only high-confidence changes
- "Should I apply?" when all proposed changes are auto-fix tier or clearly reversible
- Asking permission after classifying something as "High confidence — ready to apply"

Does NOT apply when:
- Any proposed change is medium or low confidence
- The change is structural (scope change, agent retirement, new capability)
- The human explicitly said "always ask about this kind of thing"

## Fix

The process-engineer should apply high-confidence changes autonomously and report what was changed, not ask permission first. The trust model exists precisely to enable this. If a change is truly high-confidence, the right action is: do it, report it, move on.
