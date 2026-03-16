---
name: workshop
description: >
  Multi-agent parallel interrogation of a NotebookLM notebook. Spawns N researcher
  agents, each investigating a specific facet, with cross-pollination of findings.
  Use standalone when you have a notebook and want to swarm it with questions.
  Say "swarm this notebook", "workshop these questions", or "parallel research on".
triggers:
  - "swarm this notebook"
  - "workshop these questions"
  - "parallel research"
  - "research-lab:workshop"
allowed-tools: Bash, Read, Write
---

# Workshop: Agent Swarm Protocol

Swarm a NotebookLM notebook with parallel researcher agents, each investigating a focused facet.

---

## Input

Required:
- **Notebook ID** — from a completed literary review or user-provided
- **Research questions or facets** — 3-5 specific angles to investigate

Optional:
- **Engagement directory** — for writing output files (defaults to current directory)
- **Cross-pollination** — enabled by default

---

## Step 1 — Facet Definition

Define 3-5 research facets. Each facet should be:
- **Specific** — not "tell me everything" but "what do sources say about X specifically"
- **Non-overlapping** — each researcher covers distinct territory
- **Answerable** — the notebook sources should have relevant information

Example facets for a Drupal cache optimization:
1. Cache tag granularity and invalidation patterns
2. Render array caching vs page caching trade-offs
3. External cache layer (Varnish/CDN) interaction with Drupal's internal cache
4. Known anti-patterns and common misconfigurations
5. Measurement and profiling techniques

---

## Step 2 — Spawn Researchers

For each facet, spawn a researcher agent:

```
Agent(
  subagent_type="research-lab:researcher",
  name="researcher-<N>",
  prompt="You are in workshop mode.

  Notebook ID: <notebook-id>
  Your facet: <facet-description>

  Other researchers and their facets:
  - researcher-1: <facet-1>
  - researcher-2: <facet-2>
  - ...

  Use ${CLAUDE_PLUGIN_ROOT}/scripts/notebook-ask.sh for all notebook queries (correct CLI syntax).
  Reference: ${CLAUDE_PLUGIN_ROOT}/skills/literary-review/references/notebooklm-cli.md
  Read ${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/cross-pollination.md for sharing protocol.

  Query the notebook with 5-8 focused questions about your facet.
  Example: ${CLAUDE_PLUGIN_ROOT}/scripts/notebook-ask.sh <notebook-id> "your question here"
  For each question, record: the question, the answer, key sources cited.

  When you discover something significant, share it with other researchers via SendMessage.

  Write your findings to: <engagement-dir>/03-workshop-<N>.md

  Format:
  # Workshop Findings: <facet>
  ## Questions Asked
  ## Key Findings
  ## Connections to Other Facets
  ## Surprising or Contradictory Results"
)
```

**Spawn all researchers in parallel** — multiple Agent calls in one message.

---

## Step 3 — Monitor and Synthesize

Wait for all researchers to complete.

Read each `03-workshop-N.md` and synthesize into `03-workshop.md`:

```markdown
# Workshop Synthesis

## Facets Investigated
<list of facets and researchers>

## Cross-Cutting Themes
<patterns that appeared across multiple facets>

## Key Findings by Facet
### <Facet 1>
<synthesized from researcher-1>

### <Facet 2>
<synthesized from researcher-2>

## Contradictions and Open Questions
<where researchers found conflicting information>

## Connections Discovered
<cross-pollination results — what researchers found that connected to other facets>
```

---

## Solo Mode

When the PI is working alone (no team sprint, single session), skip agent spawning and query the notebook directly:

1. Define facets as in Step 1
2. For each facet, run 5-8 focused queries via `${CLAUDE_PLUGIN_ROOT}/scripts/notebook-ask.sh <notebook-id> "question"`
3. Record findings per facet in the same `03-workshop-N.md` format
4. Synthesize into `03-workshop.md`

Solo mode is appropriate when:
- Testing the research process (no need for parallel agents)
- The notebook has few sources (parallel queries add overhead, not speed)
- The PI is already in the context and switching to agents would lose context

## Standalone Mode

When used outside of research-lab:run:
1. Ask the user for the notebook ID and research questions
2. Run Steps 1-3 (or Solo Mode)
3. Present the synthesis and offer next steps:
   - "Run a seminar to form decisions from these findings?"
   - "Add more sources and re-run the workshop?"
   - "Archive to vault?"
