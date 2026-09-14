# Changelog

## 1.2.1
- Shrink all 17 skill descriptions to a routing-sufficient summary; the full trigger-phrase detail moves into each SKILL.md body under `## When to use`, where it loads on invocation instead of sitting in context every session.
- Saves roughly 7,210 characters (~1,802 est. tokens) of always-resident context.
- Descriptions keep the distinctive tool vocabulary and the "not for X, use Y" disambiguation, so routing between sibling skills is unchanged.

## 1.2.0
- Rework lib:image-optimize on a Bun-first progressive-enhancement model: Bun.Image (≥1.3.14) is the only hard dependency for the common web path (resize, JPEG/PNG/WebP/AVIF/HEIC, palette quantization, strip metadata)
- Demote Homebrew specialists (magick, avifenc, pngquant, jpegtran, gif2webp, svgo) to an optional escalation tier surfaced only when a task needs them — with targeted install guidance at that moment
- Fix broken `avifenc --quality` syntax (must be `-q` on avifenc 1.4.2+)
- Add Linux platform caveat: Bun.Image cannot encode AVIF/HEIC or handle TIFF there

## 1.1.0
- Add lib:ddev skill for general DDEV knowledge (lifecycle, naming, providers, troubleshooting, worktree isolation)
- Includes references/providers.md with direct mysqldump, SSH tunnel, and wp-cli/drush patterns
- Includes references/troubleshooting.md with error table, Mutagen, port conflicts, Docker diagnostics
- Documents project_tld convention for multi-project worktree URL namespacing

## 1.0.1
- Fix stale obsidian-rules.md paths in archive and vault-store skills: office → workflow

## 1.0.0
- Initial release: extracted from `office` plugin
- Skills: slack, jira, github, testrail, csv-analysis, log-analyzer, image-optimize, vault-search, vault-store, archive
