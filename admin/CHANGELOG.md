# Changelog

## 2.6.0
- `agent-team` skill reworked against the current Claude Code tool surface:
  - Fixed SendMessage examples to the current schema (`to`/`summary`/`message`) — the old `type=`/`recipient=`/`content=` parameters no longer exist; shutdown is now a structured message object
  - Added a Step 0 routing gate: plain parallel Agent calls vs the Workflow tool (deterministic fan-out/pipeline with schema-validated outputs) vs a full team — teams are reserved for emergent peer-to-peer coordination
  - Corrected the overstated "SendMessage will not work without TeamCreate" claim: named agents are addressable without a team; teams uniquely add peer messaging, the shared task list, and idle notifications
  - Documented newer Agent parameters: per-agent `model` override (haiku/sonnet/opus/fable) and `isolation="worktree"` for concurrent file mutation
  - Added idle-state guidance (idle is normal, do not poke) and the TeamDelete fails-while-members-active constraint
  - Worktree isolation guidance prefers the project's own worktree convention (pre-create via `create-worktree`) over Claude-managed `isolation="worktree"` placement
- `new-agent` skill: SendMessage examples updated to the current schema (`to`/`summary`/`message`); model guidance now includes omit-to-inherit and `fable`

## 2.5.1
- Add `admin/scripts/validate-plugin-list.sh`: scans repo root for plugin dirs (by presence of `.claude-plugin/plugin.json`), cross-checks against the hardcoded PLUGINS array, and exits 1 with a clear diff on mismatch
- `bump-version.sh` and `reinstall-plugin.sh`: call validator on entry; fix stale PLUGINS array (remove retired `office`, add `ideas-funnel`)
- `bump-version` and `changelog` SKILL.md: update valid plugin names list to match
- `bump-version.sh`: strip any stray `version` field from a plugin's `marketplace.json` entry on bump — a stale field there makes `claude plugin install` skip the re-pull

## 2.5.0
- Move `accessibility-scan` to `improve` plugin — measurement skills belong with improvement primitives
- Update `install` skill: add perf-measure deps for improve and drupal-lab; broaden description to cover all installed plugins

## 2.4.3
- `update-plugins` SKILL.md: document single-plugin reinstall syntax (`uninstall` + `install <name>@local`); no `reinstall` command exists, no `--local` flag, no path-based install

## 2.4.2
- `reinstall-plugin.sh`: add missing plugins (lib, workflow, drover, research-lab, improve) to PLUGINS array
- `bump-version.sh`: same fix
- `bump-version` SKILL.md: update valid plugin names list
- `changelog` SKILL.md: update valid plugin names list and tighten description
- `new-agent` SKILL.md: update color table (process-improvement → process-engineer)
- `scaffold` CLAUDE.md template: update retro interview agent list

## 2.4.1
- `scaffold`: creates `.claude/progress.jsonl` for session continuity tracking
- `scaffold`: CLAUDE.md template includes Session Progress Log section with JSONL schema and read/write instructions

## 2.4.0
- New `accessibility-scan` skill: multi-tool a11y audit (Pa11y + axe-core + Lighthouse) that outputs a JSON score tuple for experiment improvement loops

## 2.3.6
- `scaffold-detect` hook: updated references from retired `drupal-module-starter` to `drupal-lab:module-dev-starter`

## 2.3.5
- `admin:bump-version`: updated reinstall instructions to use `/reload-plugins` in the current session instead of starting a new one

## 2.3.4
- `admin:scaffold`: CLAUDE.md and MEMORY.md templates now include ADR section pointing to `~/Vaults/Neurons/Architecture/ADRs/` — every scaffolded project knows to consult accepted ADRs before making architectural decisions

## 2.3.2
- `admin:new-skill`: eval records now write to `Skill-Evals/` directly (removed `shared/` prefix); filesystem-direct write replaces Obsidian CLI check

## 2.3.1
- Fix `reinstall-plugin.sh` verification note — example skill updated from `sprint:changelog` to `admin:changelog sprint --latest`

## 2.3.0
- `admin:changelog` now handles changelogs for all plugins — pass the plugin name as the first argument (e.g. `admin:changelog sprint --latest`); no plugin argument lists available plugins
- `admin:changelog` resolves sibling plugins from the shared cache directory, so no per-plugin changelog skills are needed
- Added `admin:agent-team` skill — sets up a proper agent team using TeamCreate so spawned agents share a communication channel and can coordinate via SendMessage

## 2.2.1
- Fixed `bump-version` skill to use `zsh` instead of `bash` in reinstall command output and code blocks

## 2.2.0
- Added `admin:schedule` skill — create, list, enable, disable, delete, and view logs for macOS launchd scheduled tasks under the `com.chrisweber.*` namespace; supports prompt, skill, and script task types
- Added `admin:schedule ui` — local web dashboard at localhost:7474 showing all scheduled tasks with status, log viewer, and enable/disable/delete actions
- Fixed `admin:new-skill` testing reference to document `--plugin-skill` requirement when evaluating installed skills (omitting it causes 0% recall)

## 2.1.0
- `admin:new-skill` now saves an eval record to the Neurons vault after every skill create/improve pass (`shared/Skill-Evals/<plugin>/<skill-name>/`)
- Eval storage uses `OBSIDIAN_VAULT_NAME` env var with full absolute path; falls back to same path locally if Obsidian not running
- Removed cross-plugin dependency on `lib:vault-store` — eval storage logic is self-contained

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
