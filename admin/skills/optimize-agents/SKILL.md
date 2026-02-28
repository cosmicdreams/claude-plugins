---
name: optimize-agents
description: Use when asked to review agent definitions, check if agents are using the right models, trim agent prompts for size, or audit agent frontmatter across the plugin. Trigger phrases: 'optimize agents', 'review agents', 'check agent models', 'are agents well-configured', 'trim agent prompts'.
---

# Optimize Agent Definitions

Audit agent definitions for cost and token efficiency. Assign the smallest model that can reliably do the work. Trim bloated prompt text.

## Input

- Agent directory (default: `.claude/agents/`)
- Optional: specific agent file to optimize

## Workflow

### Step 1: Inventory

Read all `*.md` files in the agents directory. For each, extract:
- name, description, color, tools, model (from YAML frontmatter)
- Body line count (proxy for token cost)
- Whether frontmatter exists and is complete

Flag agents missing frontmatter fields: `name`, `description`, `color`, `tools`, `model`.

### Step 2: Model Selection

Apply this decision tree to each agent:

```
Is the agent's work procedural/checklist-based?
  (run commands, compare against rules, report pass/fail)
  YES --> haiku
  NO  --> Does it require complex reasoning, judgment, or code writing?
           YES --> Does it require multi-step architectural planning,
                   deep debugging, or extreme-stakes decisions?
                   YES --> sonnet (opus ONLY if user explicitly requests)
                   NO  --> sonnet
           NO  --> haiku
```

#### Haiku Indicators (any 2+ = haiku)
- Executes tools and reports output (linting, testing, scanning)
- Follows a fixed checklist or template
- Compares input against documented rules
- Output is structured/formulaic (pass/fail, violation list)
- No code writing or editing
- Errors are low-stakes (can be re-run cheaply)

#### Sonnet Indicators (any 2+ = sonnet)
- Writes or edits code
- Makes judgment calls (complexity assessment, architectural decisions)
- Synthesizes information from multiple sources
- Produces user-facing natural language summaries
- Detects subtle patterns (incomplete implementations, over-engineering)
- Errors are high-stakes (wrong code, missed gaps, bad advice)

#### Opus Indicators (rare — needs explicit justification)
- Multi-file architectural reasoning across large codebases
- Problems requiring 10+ step chains of reasoning
- Debugging that requires holding many interacting systems in context
- Never default to opus — always try sonnet first

### Step 3: Token Efficiency Audit

Target: 25-40 lines body. Flag agents over 50 lines for review.

#### What to Cut (ordered by token savings)

1. **Embedded output templates** (~1,000+ tokens): Full markdown report templates with placeholders. Replace with a 1-2 line structural description.
2. **Cross-agent collaboration boilerplate** (~1,000 tokens): If 5+ agents share near-identical protocol blocks, extract to a shared file and replace with a single-line reference.
3. **Bloated frontmatter descriptions** (~1,500 tokens across files): Description fields over 100 chars with embedded examples. Keep to 1-2 sentences max.
4. **Code snippets for well-known patterns** (~400 tokens): Don't embed standard framework boilerplate the model already knows.
5. **Personality/role-playing text** (~500 tokens): "Senior Engineer with 15 years experience" — replace with direct responsibility lists.
6. **Redundant tool descriptions**: Tools are listed in frontmatter; don't re-describe what Read/Grep/Bash do in the body.
7. **Repeated sections**: Sections that restate each other in different words.
8. **Philosophy sections**: "Core Philosophy" paragraphs rarely change agent behavior.

#### What to Keep
- Specific commands and exact syntax
- Communication templates with examples
- Decision criteria unique to this agent
- Process steps (numbered workflow)
- Quality gates with concrete thresholds

#### Lean Agent Template (target: 25-40 lines body)

```markdown
---
name: agent-name
description: One sentence. What it does and when to use it.
color: color
tools: Tool1, Tool2, Tool3
model: haiku|sonnet
---

# Agent Name

## Capabilities
- Bullet list of what this agent does (not how tools work)

## Process
1. Step one with specific commands
2. Step two
3. Step three

## [Role-Specific Section]
- Criteria, thresholds, or decision rules unique to this agent

## Communication
**Internal -> team-lead**: Ultra-concise
- Template: `[emoji] #[iss] [action] [status] | [key]: [value]`
```

### Step 4: Apply Changes

For each agent:
1. Add/fix YAML frontmatter with all required fields
2. Set `model:` to recommended tier
3. Trim body if over 50 lines (preserve meaning, cut redundancy)
4. Verify no functional instructions were lost

### Step 5: Verify

```bash
for f in .claude/agents/*.md; do
  name=$(basename "$f" .md)
  model=$(grep -m1 '^model:' "$f" | awk '{print $2}')
  lines=$(wc -l < "$f")
  echo "$name: model=$model lines=$lines"
done
```

### Step 6: Agent Consolidation Review (Optional)

Look for clusters of agents with overlapping responsibilities. Fewer agents = less selection confusion + less total token load.

**When to consolidate**: 3+ agents share >50% of their stated capabilities.
**When NOT to consolidate**: Agents serve fundamentally different workflows (e.g., read-only analysis vs. code editing).

## Decision Examples

| Agent Type | Model | Reasoning |
|-----------|-------|-----------|
| Linter/formatter runner | haiku | Run tool, read output, report. Procedural. |
| Compliance checker | haiku | Compare changes against documented rules. Pattern matching. |
| Test runner/validator | haiku | Execute commands, check pass/fail. Checklist. |
| Code writer/fixer | sonnet | Writing code requires understanding context. |
| Issue analyzer | sonnet | Complexity assessment needs judgment. |
| Architecture reviewer | sonnet | Design review requires deep reasoning. |
| User-facing coordinator | sonnet | Synthesizing results into summaries for humans. |
| Multi-system debugger | opus | Only when sonnet demonstrably fails. |

## Key Principles

1. **Cheapest viable model**: Always try haiku first. Only upgrade if the task genuinely requires reasoning.
2. **Shorter is better**: Every token in the agent definition is loaded into context for every invocation.
3. **Specific beats generic**: "Run `composer phpcs`" is better than "Ensure coding standards compliance."
4. **Never default to opus**: Opus is 10x the cost. Use sonnet unless sonnet demonstrably fails.
5. **Re-audit after changes**: New agents, changed workflows, or model capability updates all warrant a re-run.
6. **Fewer agents is better**: Each agent adds selection overhead. If two agents do similar work, merge them.
