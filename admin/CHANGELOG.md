# Changelog

## 1.1.1
- Rewrite admin skill descriptions as triggering conditions (CSO audit) — new-agent, new-skill, optimize-agents, and scaffold now open with "Use when..." and include concrete trigger phrases and negative boundaries

## 1.1.0
- Update scaffold-detect.sh with Drupal project detection (composer.json + core/lib/Drupal.php check) and three-state prompting; adds independent `drupalScaffoldComplete` flag
- Update new-agent SKILL.md template to include Error Recovery and Quality Gates sections with guided questions

## 1.0.0
- Initial release — split from agent-squad plugin
- Skills: bump-version, new-agent (was agent-creator), new-skill (was skill-creator), optimize-agents, scaffold, scaffold-silence, update-plugins, release-notes
- Hooks: SessionStart (scaffold-detect.sh)
