---
id: lint-001
name: excessive-retries
tier: warn
applies-to: agent
pattern: Same tool call repeated 3+ times consecutively with same or similar arguments
created: 2026-03-20
source: Observed across multiple sprint agents — agents stuck in retry loops waste tokens and time
---

## Problem

An agent calls the same tool with the same arguments 3 or more times in a row, getting the same error each time. This indicates the agent is stuck and the approach won't work — further retries waste tokens and time without progress.

## Detection

In JSONL session logs, look for consecutive tool calls where:
- Tool name is identical
- Arguments are identical or near-identical
- Result is an error each time

In live observation, watch for agents that appear stalled on a single operation.

## Fix

Add retry-limit guidance to the agent's definition. Example addition:

```
If a tool call fails twice with the same error, stop and try a different approach.
Do not retry the same operation more than twice.
```

Alternatively, if the retry is caused by a missing tool or wrong tool usage, fix the root cause (update the agent's instructions to use the correct tool or approach).
