---
name: optimize-agents
description: >
  Audit agent definitions, and the skill files they depend on, against the definition lint rules:
  registration names, frontmatter fields, tool declarations, pinned or denied models, stale
  references, and prompt bloat. Not for writing new agents (admin:new-agent).
---

# Optimize agent definitions

Checks that an agent will register, load the tools it needs, run on a model the account covers, and read as instructions a current model needs rather than coaching an older one did. The rules live one per file in `${CLAUDE_PLUGIN_ROOT}/skills/optimize-agents/references/rules/`; read them rather than recalling them.

## Input

A plugin, a directory of agents (default: every `*/agents/*.md` in the repository, plus `~/.claude/agents/`), or one file.

## 1. Run the rules

For each rule whose `applies-to` matches, run its detection. Rule tiers:

| Tier | Behavior |
| --- | --- |
| auto-fix | Apply the fix, list what changed. |
| warn | Report with evidence and the proposed fix; wait for the user. |
| watch | Note it; take no action. |

A rule moves up a tier only when its findings have been right repeatedly; if an auto-fix misfires, drop it to warn at once.

## 2. Judge whether the agent should exist

An agent earns its own context when it needs a tool or permission boundary, isolation from the caller's reasoning (independent review), a single-writer role, or it is dispatched by a script. If none applies and a skill run in the main session would do the job, recommend converting or deleting it. Check that something actually dispatches it: search for `<plugin>:<name>` in skills, scripts, and workflows.

## 3. Trim the prompt

Keep what only this agent knows: its boundary, inputs, outputs, decision criteria, and exact commands. Cut, in order of payoff:

1. Persona openers ("You are a world-class …") — replace with the responsibility.
2. Walls of "never" and capitals — one statement per rule.
3. Steps a current model does unprompted (read before editing, think step by step, check your work).
4. Repeated warnings and cross-agent boilerplate — extract shared text to a reference.
5. Full output templates — describe the shape in a line unless a caller parses it.

Target 40 to 80 body lines. Longer is fine when it is contract, not coaching.

## 4. Report

One line per agent: name, findings by rule id, what was fixed, what needs the user.
