---
name: new-skill
description: >
  Guide creating or improving a skill in CLAUDE-PLUGINS, including reworking an existing
  skill's description or structure. Not for a body edit that is already clearly specified
  — just use Edit.
---

# New Skill

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Guides the full workflow for creating or improving a skill in the CLAUDE-PLUGINS system. Use this skill whenever the user asks to build, write, add, or improve a skill — even if they just say "make a skill for X" or "can you turn this into a skill". Also use when improving an existing skill's description, structure, or instructions. Do not use for direct edits to skill body content where the change is already clear — use the Edit tool for that.

A skill lives in a plugin folder and teaches Claude a specialized workflow. The goal is to create one that's genuinely useful — clear enough that Claude (reading it cold) knows exactly what to do and why.

The skill-creator eval infrastructure is available for testing: see `references/testing.md`.

## Resources in this skill

- `references/conventions.md` — naming rules, plugin structure, install commands; read when setting up the skill folder
- `references/testing.md` — eval infrastructure and description optimization loop; read before testing
- `references/deliverable-storage.md` — vault detection pattern and subfolder conventions; read when the skill produces a file output

---

## Understand the goal first

Before writing anything, get concrete about what this skill will do. Two or three real examples of how a user would invoke it are worth more than a paragraph of abstract description.

Ask:
- What does the user say that should trigger this skill?
- What does a good output look like?
- What would Claude get wrong without guidance?

---

## Where the skill lives

```
<plugin>/skills/<skill-name>/
├── SKILL.md          ← required: core instructions + file manifest
├── references/       ← detail loaded on demand
├── scripts/          ← executable code Claude runs directly
└── assets/           ← output templates, boilerplate, examples
```

After writing or changing a skill, reinstall:

```bash
claude plugin install <plugin-name>@local --scope user
```

For plugin-internal paths in scripts, use `${CLAUDE_SKILL_DIR}` or `${CLAUDE_PLUGIN_ROOT}` — never hardcode cache paths.

---

## Design for progressive disclosure

`SKILL.md` carries only what Claude needs on every run; everything else lives in `references/`, `scripts/`, or `assets/` and gets read on demand.

**The key mechanic:** Tell Claude what files exist and when to read them. Claude reads them at the right moment — but only if you declare them.

```markdown
## Resources in this skill

- `references/api.md` — full function signatures; read before writing any API calls
- `assets/output-template.md` — copy as the base for all output; read before generating output
- `scripts/validate.sh` — runs validation; execute after each implementation step
```

**Where things belong:**

- **`SKILL.md`** — workflow steps, the "when to read X" manifest, gotchas that apply on every run
- **`references/`** — detailed docs, large API surfaces, edge case catalogs; move content here when `SKILL.md` grows past ~300 lines
- **`scripts/`** — deterministic, reusable code Claude would otherwise rewrite every invocation
- **`assets/`** — output templates, boilerplate files, example outputs Claude copies rather than generates

---

## Write the description

The description (YAML frontmatter) is what Claude reads to decide whether to load this skill. The skill body is invisible until after that decision.

A good description:
1. States what the skill does in one sentence
2. Lists the specific conditions or phrases that should trigger it
3. Adds a negative trigger if the scope is easily confused with something adjacent

Keep it under 1024 characters. No XML angle brackets.

---

## Write the skill body

- Imperative form throughout. "Run the validation script" not "You should run it."
- Explain the *why* behind non-obvious steps.
- Lead with the most critical information.
- Keep SKILL.md under ~120 lines; approaching that limit is a signal that detail belongs in `references/`.
- Include a `## Resources in this skill` manifest for any bundled files — list each file and its "read when" condition.

---

## Test before shipping

Run at least two real prompts through the skill. This catches instructions that are clear to you but ambiguous to Claude reading cold.

After testing, reinstall and ask: "When would you use the [skill-name] skill?" — it quotes the description back, which reveals gaps.

---

## Archive the eval record

Save a short eval record to the vault after testing:

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
DEST_PATH="Skill-Evals/<plugin>/<skill-name>/$(date +%Y-%m-%d)-eval.md"
mkdir -p "$VAULT_ROOT/$(dirname "$DEST_PATH")"
cat > "$VAULT_ROOT/$DEST_PATH" <<'EOF'
# Eval record content
EOF
```

---

## Quick validation checklist

- [ ] Folder name matches `name:` field in frontmatter
- [ ] `name:` is kebab-case
- [ ] Description is under 1024 characters, no `<` or `>` characters
- [ ] Referenced files in `references/` actually exist
- [ ] `## Resources in this skill` manifest present if any bundled files exist
- [ ] `${CLAUDE_SKILL_DIR}` or `${CLAUDE_PLUGIN_ROOT}` used in scripts (not hardcoded paths)
- [ ] Eval record saved to the vault
