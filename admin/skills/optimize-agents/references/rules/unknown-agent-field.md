---
id: lint-011
name: unknown-agent-field
tier: auto-fix
applies-to: agent
pattern: Agent frontmatter uses a field agents do not support, such as allowed-tools
created: 2026-09-29
source: drover's report-writer declared allowed-tools, a skill field; agents ignore unknown fields, so it was not actually limited to Read.
---

## Problem

Unknown frontmatter fields are ignored without error. The most harmful case is `allowed-tools` (a skill field) on an agent: the author believes the agent is restricted, and it is not.

## Detection

Compare each agent's frontmatter keys against the fields in the current Claude Code subagent documentation (`name`, `description`, `tools`, `model`, `color`, and the other documented keys). Flag the rest.

## Fix

Rename `allowed-tools` to `tools`. Remove other unknown fields, or move their intent into the body.
