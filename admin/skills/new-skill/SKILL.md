---
name: new-skill
description: Guides the full workflow for creating or improving a skill in the CLAUDE-PLUGINS system. Use this skill whenever the user asks to build, write, add, or improve a skill — even if they just say "make a skill for X" or "can you turn this into a skill". Also use when improving an existing skill's description, structure, or instructions. Do not use for direct edits to skill body content where the change is already clear — use the Edit tool for that.
---

# New Skill

A skill lives in a plugin folder and teaches Claude a specialized workflow. Your job here is to create one that's genuinely useful — not just syntactically correct, but clear enough that Claude (reading it cold) knows exactly what to do and why.

The skill-creator eval infrastructure is available for testing: see `references/testing.md`.

---

## Understand the goal first

Before writing anything, get concrete about what this skill will do. Two or three real examples of how a user would invoke it are worth more than a paragraph of abstract description.

Ask yourself (or the user):
- What does the user say that should trigger this skill?
- What does a good output look like?
- What would Claude get wrong without guidance?

If the use case is fuzzy, ask one focused question rather than a list. Once you can picture two distinct usage scenarios clearly, you have enough to write.

---

## Where the skill lives

Skills in this system live inside a plugin:

```
<plugin>/skills/<skill-name>/
├── SKILL.md          ← required
├── references/       ← docs loaded on demand
├── scripts/          ← executable code
└── assets/           ← templates, images, boilerplate
```

The plugin installs from `worktrees/main/`. After writing or changing a skill, reinstall:

```bash
claude plugin install <plugin-name>@local --scope user
```

For plugin-internal paths in scripts, use `${CLAUDE_PLUGIN_ROOT}` — never hardcode cache paths.

See `references/conventions.md` for naming rules and full plugin structure.

---

## Plan what to bundle

For each usage scenario, ask: what would Claude have to figure out or rewrite every time without guidance?

- **scripts/** — code that's deterministic and reused (e.g. a validation script, a packager). Bundle it if Claude would write the same thing every invocation.
- **references/** — documentation too detailed to live in SKILL.md. Move content here when SKILL.md exceeds ~400 lines or a subtopic exceeds ~300 words.
- **assets/** — files used in output (templates, boilerplate, icons).

Lean toward less. An unused reference/ directory adds noise. Start with SKILL.md only and add resources when you feel the absence.

---

## Write the description — this is the triggering mechanism

The description (YAML frontmatter) is what Claude reads to decide whether to load this skill. The skill body is invisible until after that decision. This makes the description the highest-leverage thing you write.

A good description:
1. States what the skill does in one sentence
2. Lists the specific conditions or phrases that should trigger it
3. Adds a negative trigger if the scope is easily confused with something adjacent

Make it slightly "pushy" — err toward triggering rather than not. Claude tends to undertrigger skills.

Keep it under 1024 characters. No XML angle brackets.

See `references/description-guide.md` for patterns and examples.

---

## Write the skill body

**Style:** Imperative form throughout. "Run the validation script" not "You should run the validation script." Explain the *why* behind non-obvious steps — Claude is smart and will follow the spirit of an instruction if it understands the reason, which is more robust than a rigid rule.

**Structure:** Lead with the most critical information. A reader (or Claude) who stops halfway through should still have the most important guidance.

**Length:** Keep SKILL.md under ~400 lines. When you approach that limit, move detailed content to `references/` and add a pointer. Claude loads references on demand — they don't cost context unless needed.

**Resources:** Reference bundled files explicitly with a note on when to read them:
> "For validation patterns, see `references/patterns.md`."

---

## Test before shipping

Run at least two real prompts through the skill using the eval infrastructure. This catches instructions that are clear to you but ambiguous to Claude-reading-cold.

See `references/testing.md` for how to run evals and the description optimization loop.

After testing, reinstall and verify:

```bash
claude plugin install <plugin>@local --scope user
```

Ask Claude: *"When would you use the [skill-name] skill?"* — it quotes the description back, which reveals gaps in triggering logic.

---

## Archive the eval record

After testing, save an eval record to the Neurons vault. Eval records are shared knowledge — they capture quality patterns and triggering logic decisions useful across all projects.

Compose a short eval record (Markdown) containing:
- **Skill**: `<plugin>:<skill-name>`
- **Date**: today
- **What changed**: one paragraph summary (or "new skill" if creating)
- **Eval prompts used**: the 2+ test phrases you ran
- **Trigger verdict**: did the description fire correctly? Any under/over-triggering observed?
- **Quality notes**: imperative voice pass, description length, angle bracket check
- **Before/after diff summary**: key structural changes (for improvement passes)

Save the eval record directly to the vault filesystem:

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
DEST_PATH="Skill-Evals/<plugin>/<skill-name>/<YYYY-MM-DD>-eval.md"
mkdir -p "$VAULT_ROOT/$(dirname "$DEST_PATH")"
cat > "$VAULT_ROOT/$DEST_PATH" <<'EOF'
<eval record content>
EOF
echo "Eval record saved: $VAULT_ROOT/$DEST_PATH"
```

---

## Quick validation

Before installing, check:

- [ ] Folder name matches `name:` field in frontmatter
- [ ] `name:` is kebab-case (lowercase, hyphens only, no underscores)
- [ ] Description is under 1024 characters, no `<` or `>` characters
- [ ] Any referenced files in `references/` actually exist
- [ ] Unused example directories deleted
- [ ] `${CLAUDE_PLUGIN_ROOT}` used in scripts (not hardcoded paths)
- [ ] Eval record saved to `$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}/Skill-Evals/<plugin>/<skill-name>/`

See `references/conventions.md` for full naming rules.
