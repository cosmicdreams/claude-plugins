# skill-creator validator

`quick_validate.py` is copied unmodified from Anthropic's skill-creator skill (claude-plugins-official marketplace, `plugins/skill-creator/skills/skill-creator/scripts/quick_validate.py`) on 2026-11-05, under the Apache License 2.0 in `LICENSE.txt`. SHA-256: `67cf5703402013936c8fb75ad6a1afecd8841d45cc5e606b634eb05825fde365`.

It checks a skill's frontmatter: only `name`, `description`, `license`, `allowed-tools`, `metadata` and `compatibility` are allowed; `name` is kebab-case with no plugin prefix; `description` has no angle brackets and is at most 1024 characters.

The Skill frontmatter workflow runs it on every `SKILL.md` a pull request changes. Run it locally with `uv run --with pyyaml python scripts/skill-creator/quick_validate.py <skill-dir>`. To update it, copy the newer file over this one and refresh the checksum.
