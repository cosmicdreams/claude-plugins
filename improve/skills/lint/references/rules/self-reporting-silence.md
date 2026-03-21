---
id: lint-007
name: self-reporting-silence
tier: watch
applies-to: agent
pattern: Agent completes 3+ tasks with zero friction reports
created: 2026-03-21
source: Peek plugin evaluation analysis — agents in degraded states often adapt to the degradation and stop reporting friction, making failures invisible at the task-completion level
---

## Problem

An agent completes multiple tasks in a row without reporting any friction to the process engineer. This is not inherently wrong — some agents work cleanly — but sustained silence from a complex agent is a signal worth probing. Agents that have drifted from their definition, are silently working around missing capabilities, or have subtly wrong reasoning will not self-report because they don't perceive themselves as failing.

This is distinct from the `excessive-retries` pattern. The agent here is *succeeding* by external measures — tasks are completing, outputs look correct. The failure is in the *reasoning path*, not the result.

## Detection

In live observation (Attached mode), track friction report counts per agent across the sprint. Flag any agent that has completed 3 or more tasks with zero friction reports for a proactive transcript check (Path 2 of the Observation Model).

In Background mode, scan recent task output files. If an agent's outputs show completed tasks but no `SendMessage` calls to the process engineer, trigger a spot-check.

## Fix

Do not auto-fix. This rule is a trigger for Path 2 (proactive transcript sampling), not a problem in itself.

1. Read the agent's session transcript
2. Compare reasoning pattern against the agent's definition
3. If divergence found: surface to human (warn tier) with specific examples
4. If no divergence found: note the agent is healthy; reset the counter

If the same agent triggers this rule across multiple sprints with no issues found each time, consider promoting to an exemption rather than continuing to check.
