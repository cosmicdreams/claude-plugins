#!/usr/bin/env python3
"""
Skill Packager - Creates a distributable zip file after validation.

Usage:
    python package_skill.py <path/to/skill-folder> [output-directory]

Examples:
    python package_skill.py .claude/skills/my-skill
    python package_skill.py .claude/skills/my-skill ./dist
"""

import sys
import zipfile
from pathlib import Path
from validate_skill import validate_skill


def package_skill(skill_path, output_dir=None):
    """Package a validated skill folder into a zip file."""
    skill_path = Path(skill_path).resolve()

    if not skill_path.is_dir():
        print(f"Error: Not a directory: {skill_path}")
        return None

    if not (skill_path / 'SKILL.md').exists():
        print(f"Error: SKILL.md not found in {skill_path}")
        return None

    # Validate first
    print("Validating skill...")
    passed, warnings, errors = validate_skill(skill_path)

    if errors:
        for e in errors:
            print(f"  [FAIL] {e}")
        print("Fix errors before packaging.")
        return None

    if warnings:
        for w in warnings:
            print(f"  [WARN] {w}")
        print()

    # Determine output path
    skill_name = skill_path.name
    out = Path(output_dir).resolve() if output_dir else Path.cwd()
    out.mkdir(parents=True, exist_ok=True)
    zip_path = out / f"{skill_name}.zip"

    # Create zip
    try:
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for file_path in skill_path.rglob('*'):
                if file_path.is_file():
                    # Skip .gitkeep, __pycache__, .pyc
                    if file_path.name == '.gitkeep' or '__pycache__' in str(file_path) or file_path.suffix == '.pyc':
                        continue
                    arcname = file_path.relative_to(skill_path.parent)
                    zf.write(file_path, arcname)
                    print(f"  Added: {arcname}")

        print(f"\nPackaged to: {zip_path}")
        return zip_path

    except Exception as e:
        print(f"Error creating zip: {e}")
        return None


def main():
    if len(sys.argv) < 2:
        print("Usage: python package_skill.py <path/to/skill-folder> [output-directory]")
        sys.exit(1)

    skill_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else None

    result = package_skill(skill_path, output_dir)
    sys.exit(0 if result else 1)


if __name__ == "__main__":
    main()
