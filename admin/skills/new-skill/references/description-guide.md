# Writing Effective Skill Descriptions

The `description` field in YAML frontmatter is the most important part of a skill. It determines whether Claude loads the skill for a given user request.

## Structure

```
[What it does] + [When to use it] + [Key capabilities]
```

All three parts are required. Under 1024 characters total.

## Good Examples

```yaml
# Specific, actionable, with trigger phrases
description: Analyzes Figma design files and generates developer handoff documentation. Use when user uploads .fig files, asks for "design specs", "component documentation", or "design-to-code handoff".

# Includes trigger phrases and scope
description: Manages Linear project workflows including sprint planning, task creation, and status tracking. Use when user mentions "sprint", "Linear tasks", "project planning", or asks to "create tickets".

# Clear value proposition with triggers
description: End-to-end customer onboarding workflow for PayFlow. Handles account creation, payment setup, and subscription management. Use when user says "onboard new customer", "set up subscription", or "create PayFlow account".
```

## Bad Examples

```yaml
# Too vague - no trigger conditions
description: Helps with projects.

# Missing triggers - only says WHAT, not WHEN
description: Creates sophisticated multi-page documentation systems.

# Too technical, no user-facing triggers
description: Implements the Project entity model with hierarchical relationships.

# Too broad - will over-trigger
description: Processes documents.
```

## Negative Triggers

When a skill has a narrow scope that could overlap with other skills, add negative triggers:

```yaml
description: Advanced data analysis for CSV files. Use for statistical modeling, regression, clustering. Do NOT use for simple data exploration (use data-viz skill instead).

description: PayFlow payment processing for e-commerce. Use specifically for online payment workflows, not for general financial queries.
```

## Trigger Phrase Selection

Include phrases users would actually say:
- Action phrases: "help me...", "create a...", "set up..."
- Domain keywords: file types (.pdf, .csv), tool names, process names
- Intent phrases: "I need to...", "How do I..."

## Debugging Triggers

Ask Claude: "When would you use the [skill-name] skill?"

Claude will quote the description back. If the answer doesn't match expected behavior, revise the description.

## Rules

- Under 1024 characters
- No XML angle brackets (`<` or `>`)
- Use third person: "This skill should be used when..."
- Include both WHAT and WHEN
- Include specific phrases users would say
- Do not use "claude" or "anthropic" in descriptions
