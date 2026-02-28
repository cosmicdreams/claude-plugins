#!/usr/bin/env python3
"""
Skill Validator - Comprehensive validation for Claude skills.

Checks: structure, naming, frontmatter, description quality,
word count, TODO placeholders, and resource references.

Usage:
    python validate_skill.py <skill-directory>
"""

import sys
import re
from pathlib import Path


def count_words(text):
    """Count words in text, excluding YAML frontmatter."""
    # Remove frontmatter
    body = re.sub(r'^---\n.*?\n---\n', '', text, flags=re.DOTALL)
    return len(body.split())


def extract_frontmatter(content):
    """Extract YAML frontmatter as raw text."""
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if match:
        return match.group(1)
    return None


def extract_field(frontmatter, field):
    """Extract a field value from frontmatter text."""
    # Handle multi-line values (description can span lines)
    word_char = r'\w'
    pattern = r'^' + field + r':\s*(.*?)(?=\n' + word_char + r'+:|$)'
    match = re.search(pattern, frontmatter, re.MULTILINE | re.DOTALL)
    if match:
        value = match.group(1).strip()
        # Remove quotes if wrapped
        if (value.startswith('"') and value.endswith('"')) or \
           (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        return value
    return None


def validate_skill(skill_path):
    """
    Validate a skill directory. Returns (passed, warnings, errors).
    """
    skill_path = Path(skill_path).resolve()
    errors = []
    warnings = []

    # === Structure Checks ===

    if not skill_path.is_dir():
        return False, [], [f"Not a directory: {skill_path}"]

    skill_md = skill_path / 'SKILL.md'
    if not skill_md.exists():
        # Check for common mistakes
        for variant in ['skill.md', 'SKILL.MD', 'Skill.md']:
            if (skill_path / variant).exists():
                errors.append(f"Found '{variant}' but must be exactly 'SKILL.md' (case-sensitive)")
                break
        else:
            errors.append("SKILL.md not found")
        return False, warnings, errors

    # Check for README.md (not allowed inside skill folder)
    if (skill_path / 'README.md').exists():
        warnings.append("README.md found inside skill folder - should be removed (use SKILL.md or references/ instead)")

    content = skill_md.read_text()

    # === Frontmatter Checks ===

    if not content.startswith('---'):
        errors.append("No YAML frontmatter found (must start with ---)")
        return False, warnings, errors

    frontmatter = extract_frontmatter(content)
    if frontmatter is None:
        errors.append("Invalid frontmatter format (missing closing ---)")
        return False, warnings, errors

    # Name field
    name = extract_field(frontmatter, 'name')
    if not name:
        errors.append("Missing 'name' field in frontmatter")
    else:
        if not re.match(r'^[a-z0-9][a-z0-9-]*[a-z0-9]$', name) and len(name) > 1:
            if re.search(r'[A-Z]', name):
                errors.append(f"Name '{name}' contains uppercase letters (must be kebab-case)")
            elif ' ' in name:
                errors.append(f"Name '{name}' contains spaces (use hyphens)")
            elif '_' in name:
                errors.append(f"Name '{name}' contains underscores (use hyphens)")
            elif name.startswith('-') or name.endswith('-'):
                errors.append(f"Name '{name}' cannot start or end with a hyphen")
            elif '--' in name:
                errors.append(f"Name '{name}' cannot contain consecutive hyphens")
            else:
                errors.append(f"Name '{name}' is not valid kebab-case")

        if name != skill_path.name:
            warnings.append(f"Name '{name}' does not match folder name '{skill_path.name}'")

        if 'claude' in name.lower() or 'anthropic' in name.lower():
            errors.append(f"Name '{name}' cannot contain 'claude' or 'anthropic' (reserved)")

    # Description field
    description = extract_field(frontmatter, 'description')
    if not description:
        errors.append("Missing 'description' field in frontmatter")
    else:
        if len(description) > 1024:
            errors.append(f"Description is {len(description)} chars (max 1024)")

        if '<' in description or '>' in description:
            errors.append("Description contains angle brackets (< or >) - forbidden for security")

        # Check for trigger phrases
        trigger_phrases = ['use when', 'use for', 'use this', 'trigger', 'should be used']
        has_trigger = any(phrase in description.lower() for phrase in trigger_phrases)
        if not has_trigger:
            warnings.append("Description may be missing trigger conditions (include 'Use when...' phrases)")

        if len(description) < 20:
            warnings.append("Description seems too short - include WHAT and WHEN")

    # === Content Quality Checks ===

    # Word count
    word_count = count_words(content)
    if word_count > 5000:
        warnings.append(f"SKILL.md body is {word_count} words (recommended <5000). Move detail to references/")

    # TODO placeholders
    todo_count = content.count('[TODO')
    if todo_count > 0:
        warnings.append(f"Found {todo_count} [TODO] placeholder(s) - complete before publishing")

    # Check referenced resources exist
    # Look for references to scripts/, references/, assets/
    for ref_match in re.finditer(r'`((?:scripts|references|assets)/[^`]+)`', content):
        ref_path = skill_path / ref_match.group(1)
        if not ref_path.exists():
            warnings.append(f"Referenced resource not found: {ref_match.group(1)}")

    # === Results ===

    passed = len(errors) == 0
    return passed, warnings, errors


def main():
    if len(sys.argv) != 2:
        print("Usage: python validate_skill.py <skill-directory>")
        print("\nValidates skill structure, naming, frontmatter, and content quality.")
        sys.exit(1)

    skill_path = sys.argv[1]
    passed, warnings, errors = validate_skill(skill_path)

    if errors:
        print("ERRORS:")
        for e in errors:
            print(f"  [FAIL] {e}")

    if warnings:
        print("WARNINGS:")
        for w in warnings:
            print(f"  [WARN] {w}")

    if passed and not warnings:
        print("PASSED: Skill is valid with no warnings.")
    elif passed:
        print(f"\nPASSED with {len(warnings)} warning(s).")
    else:
        print(f"\nFAILED: {len(errors)} error(s), {len(warnings)} warning(s).")

    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
