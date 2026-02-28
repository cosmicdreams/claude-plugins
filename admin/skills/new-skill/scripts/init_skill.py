#!/usr/bin/env python3
"""
Skill Initializer - Creates a new skill from a lean template.

Usage:
    python init_skill.py <skill-name> --path <output-directory>

Examples:
    python init_skill.py my-new-skill --path .claude/skills
    python init_skill.py data-analyzer --path /path/to/skills
"""

import sys
import re
from pathlib import Path


SKILL_TEMPLATE = """---
name: {skill_name}
description: [TODO: WHAT it does + WHEN to use it. Include trigger phrases users would say. Under 1024 chars. No angle brackets.]
---

# {skill_title}

[TODO: 1-2 sentences explaining what this skill enables.]

## Instructions

### Step 1: [First Major Step]

[TODO: Clear, actionable instruction. Use imperative form.]

### Step 2: [Next Step]

[TODO: Continue workflow. Reference scripts/references as needed:
  "Run `scripts/example.py`" or "Consult `references/guide.md`"]

## Examples

**Example 1**: [Common scenario]
- User says: "[typical request]"
- Actions: 1. ... 2. ...
- Result: [expected outcome]

## Troubleshooting

**Error**: [Common error message]
- Cause: [Why it happens]
- Solution: [How to fix]
"""


def title_case(name):
    """Convert kebab-case to Title Case."""
    return ' '.join(w.capitalize() for w in name.split('-'))


def validate_name(name):
    """Validate skill name follows kebab-case rules."""
    if not re.match(r'^[a-z0-9][a-z0-9-]*[a-z0-9]$', name) and len(name) > 1:
        return False, f"Name '{name}' must be kebab-case (lowercase, digits, hyphens only)"
    if '--' in name:
        return False, f"Name '{name}' cannot contain consecutive hyphens"
    if 'claude' in name.lower() or 'anthropic' in name.lower():
        return False, f"Name '{name}' cannot contain 'claude' or 'anthropic' (reserved)"
    return True, ""


def init_skill(skill_name, path):
    """Initialize a new skill directory with template SKILL.md."""
    valid, msg = validate_name(skill_name)
    if not valid:
        print(f"Error: {msg}")
        return None

    skill_dir = Path(path).resolve() / skill_name

    if skill_dir.exists():
        print(f"Error: Directory already exists: {skill_dir}")
        return None

    try:
        skill_dir.mkdir(parents=True, exist_ok=False)
    except Exception as e:
        print(f"Error creating directory: {e}")
        return None

    # Create SKILL.md
    content = SKILL_TEMPLATE.format(
        skill_name=skill_name,
        skill_title=title_case(skill_name)
    )
    (skill_dir / 'SKILL.md').write_text(content)
    print(f"Created: {skill_dir}/SKILL.md")

    # Create optional directories (empty - user adds what's needed)
    for subdir in ['scripts', 'references', 'assets']:
        (skill_dir / subdir).mkdir(exist_ok=True)
        (skill_dir / subdir / '.gitkeep').write_text('')

    print(f"\nSkill '{skill_name}' initialized at {skill_dir}")
    print("\nNext steps:")
    print("  1. Edit SKILL.md - complete TODO items, write description with trigger phrases")
    print("  2. Add scripts/, references/, assets/ as needed (delete unused dirs)")
    print("  3. Run validate_skill.py to check before publishing")
    return skill_dir


def main():
    if len(sys.argv) < 4 or sys.argv[2] != '--path':
        print("Usage: python init_skill.py <skill-name> --path <output-directory>")
        print("\nExamples:")
        print("  python init_skill.py data-analyzer --path .claude/skills")
        print("  python init_skill.py my-skill --path /path/to/skills")
        sys.exit(1)

    result = init_skill(sys.argv[1], sys.argv[3])
    sys.exit(0 if result else 1)


if __name__ == "__main__":
    main()
