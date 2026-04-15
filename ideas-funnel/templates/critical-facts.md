# CRITICAL_FACTS

<!--
Always-loaded identity file (~120 tokens max). Agents read this on every wake so they
know who you are, what timezone you're in, and which domains are active.

Keep this short. Non-essential details go in the vault's wiki-schema.md or specific notes.

Edit this file after running /ideas-funnel:init.
-->

**Operator:** {{OPERATOR_NAME}}
**Timezone:** {{TIMEZONE}}
**Vault:** {{VAULT_NAME}} at `{{VAULT_PATH}}`
**Active domains:** AI-Workflows
**Primary board:** Beads at the vault root

## Operating notes for agents

- Default to terse. No trailing summaries. No restating what was just done.
- When writing wiki pages, use the canonical frontmatter schema from `templates/frontmatter.yaml`.
- Never invent tags — use only those in `_meta/taxonomy.md`.
- Never write to shared layers (`Concepts/`, `Entities/`, `Bridges/`, `Conflicts/`) unless you are the refinery agent.
