# Changelog

## 2.1.0
- `admin:new-skill` now saves an eval record to the Neurons vault after every skill create/improve pass (`shared/Skill-Evals/<plugin>/<skill-name>/`)
- Eval storage uses `OBSIDIAN_VAULT_NAME` env var with full absolute path; falls back to same path locally if Obsidian not running
- Removed cross-plugin dependency on `office:vault-store` — eval storage logic is self-contained

## 2.0.0
- Rename `release-notes` skill to `changelog` — invoke as `/admin:changelog`; `/admin:release-notes` no longer works
- Remove `git-ops` plugin from source tree — fully superseded by `admin:create-worktree`
- Remove stale `.claude/settings.json` from `admin/skills/` (leftover dev artifact)
- Add trigger evals and improved description for `admin:new-agent`

## 1.2.2
- Speed up `admin:scaffold` by offloading all filesystem work to `scaffold.sh` — replaces ~17 LLM tool calls with a single bash invocation; CLAUDE.md and MEMORY.md now written from static template files
- Remove `Write` from scaffold skill's allowed-tools (no longer needed)

## 1.2.1
- Fix reinstall-plugin.sh: lower non-empty install assertion threshold from >5 to >2 files so small plugins like ideate pass correctly

## 1.2.0
- Absorb create-worktree skill from retired git-ops plugin — git worktree creation now lives in admin
- Update bump-version PLUGINS array: replace git-ops with retro and ideate to reflect current plugin roster
- Fix reinstall-plugin.sh: lower non-empty install threshold from >5 to >2 files to correctly pass small plugins like ideate; update PLUGINS array and comment to match current roster; remove git-ops@local from settings.json enabledPlugins

## 1.1.1
- Rewrite admin skill descriptions as triggering conditions (CSO audit) — new-agent, new-skill, optimize-agents, and scaffold now open with "Use when..." and include concrete trigger phrases and negative boundaries

## 1.1.0
- Update scaffold-detect.sh with Drupal project detection (composer.json + core/lib/Drupal.php check) and three-state prompting; adds independent `drupalScaffoldComplete` flag
- Update new-agent SKILL.md template to include Error Recovery and Quality Gates sections with guided questions

## 1.0.0
- Initial release — split from agent-squad plugin
- Skills: bump-version, new-agent (was agent-creator), new-skill (was skill-creator), optimize-agents, scaffold, scaffold-silence, update-plugins, release-notes
- Hooks: SessionStart (scaffold-detect.sh)
