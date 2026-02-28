---
name: new-skill
description: Use when asked to build a new skill, improve an existing skill, or create a SKILL.md file. Trigger phrases: 'create a skill', 'add a skill', 'write a skill that does X', 'improve this skill', 'make a skill for'. Do not use for editing skill body content directly — use Edit tool for targeted changes.
---

# Skill Creator

Build effective skills following Anthropic's progressive disclosure model and best practices.

## Core Concepts

A skill is a folder with a required `SKILL.md` and optional `scripts/`, `references/`, and `assets/` directories. Skills use three-level progressive disclosure:

1. **YAML frontmatter** (always loaded, ~100 words) - determines WHEN skill triggers
2. **SKILL.md body** (loaded on trigger, <5000 words) - the full instructions
3. **Bundled resources** (loaded on demand) - scripts, references, assets

## Skill Creation Workflow

### Step 1: Define Use Cases

Identify 2-3 concrete examples of how the skill will be used. Determine which category fits:

| Category | Best For | Key Technique |
|---|---|---|
| Document/Asset Creation | Consistent output (docs, code, designs) | Templates, style guides, quality checklists |
| Workflow Automation | Multi-step processes | Step ordering, validation gates, iteration loops |
| MCP Enhancement | Tool workflow guidance | Multi-MCP coordination, domain expertise |

Ask the user for examples if unclear. Conclude when functionality scope is understood.

### Step 2: Plan Reusable Contents

For each use case, identify what to bundle:

- **scripts/** - Code rewritten repeatedly or needing deterministic reliability
- **references/** - Documentation too detailed for SKILL.md (>500 words on a subtopic)
- **assets/** - Files used in output (templates, images, boilerplate)

Rule: if SKILL.md exceeds ~5000 words, move detailed content to `references/`.

### Step 3: Initialize

For new skills, run the init script:

```bash
python scripts/init_skill.py <skill-name> --path <output-directory>
```

Skip if iterating on an existing skill.

### Step 4: Write the Skill

#### 4a: Write the Description (Critical)

The description determines whether Claude loads the skill. It MUST include:

1. **What** the skill does (1-2 sentences)
2. **When** to use it (trigger conditions with specific phrases users would say)

Rules:
- Under 1024 characters
- No XML angle brackets (`<` or `>`)
- Include specific trigger phrases: "Use when user asks to...", "Use when..."
- Add negative triggers if scope is narrow: "Do NOT use for..."
- Use third person: "This skill should be used when..."

Consult `references/description-guide.md` for examples and patterns.

#### 4b: Write Instructions

Writing style: **imperative/infinitive form** throughout. Use "To accomplish X, do Y" not "You should do X."

Recommended structure:

```markdown
# Skill Name
## Instructions
### Step 1: [First Major Step]
Clear explanation of what happens.
```bash
command --with arguments
```
### Step 2: [Next Step]
...
## Examples
Example 1: [scenario]
User says: "..."
Actions: 1. ... 2. ...
Result: ...
## Troubleshooting
Error: [message]
Cause: [why]
Solution: [fix]
```

Key principles:
- Be specific and actionable (bad: "validate the data"; good: "Run `python scripts/validate.py --input {file}`")
- Reference bundled resources explicitly: "Consult references/your-guide.md for..."
- Put critical instructions at the top
- Include error handling for common failures

#### 4c: Build Resources

Create scripts, references, and assets identified in Step 2. Delete unused example directories.

### Step 5: Validate

Run validation to check structure and quality:

```bash
python scripts/validate_skill.py <path/to/skill-folder>
```

Fix any errors before proceeding.

### Step 6: Package (Optional)

For distribution as a zip file:

```bash
python scripts/package_skill.py <path/to/skill-folder> [output-dir]
```

### Step 7: Test and Iterate

After deploying, monitor for:

| Signal | Symptom | Fix |
|---|---|---|
| Under-triggering | Skill doesn't load when it should | Add trigger phrases and keywords to description |
| Over-triggering | Skill loads for unrelated queries | Add negative triggers, narrow scope |
| Instructions ignored | Skill loads but Claude skips steps | Move critical steps to top, use numbered lists |
| Slow/degraded | Responses feel slow | Move content to references/, stay under 5k words |

Debugging: Ask Claude "When would you use the [skill-name] skill?" - it will quote the description back, revealing gaps.

Consult `references/testing-guide.md` for structured testing approach.

## Naming Rules

- Folder and `name:` field must match
- kebab-case only: lowercase letters, digits, hyphens
- No spaces, underscores, or capitals
- Cannot start/end with hyphen or have consecutive hyphens
- Cannot use "claude" or "anthropic" in name (reserved)
- File must be exactly `SKILL.md` (case-sensitive)
- No `README.md` inside the skill folder

## Quick Reference

Consult `references/checklist.md` for pre-upload validation checklist.
Consult `references/patterns.md` for the 5 common skill architecture patterns.
