# Changelog

## 1.4.1
- `babysit-pr` records state in a file each pass and treats a finding as real only with file, line, reason, and a way to show it fails.
- `github` and `jira` pick the obvious merge method, transition, or retry instead of asking; `log-analyzer` uses its default source without asking.
- `wiki-query`, `csv-analysis`, and `log-analyzer` report what they could not confirm or cover.

## 1.4.0
- Add `lib:babysit-pr`: monitor an open pull request through review and continuous integration — poll for comments and checks newer than the latest push, verify each bot finding against the source before changing code, rebase when `main` moves, and stop when the bots and required checks are green. Ported from the skill Theo Browne demonstrated, with the polling loop and the GraphQL thread-resolve mutation Claude Code needs filled in.
- Add `lib:leave-pr-comment`: the voice for everything posted under Chris's name — narrative cause, change, consequence; no headings, no emoji, no agent attribution. Derived from his own commit bodies and from his one recorded review-bot dismissal, and it carries the Arnica `[arnica] ack` / `dismiss fp|accept|capacity` command syntax the Velir repositories use.
- Add `lib:upload-to-pr`: attach screenshots and video with `gh --attach`, generally available since gh 2.99.0. Replaces the branch-commit and gist workarounds, which stay documented only as fallbacks for older gh.

## 1.3.0
- Move `lib:jira` from jira-cli to Atlassian's twg CLI: JSON output, cursor paging, every project in the site instead of jira-cli's single default project.
- Add time logging (`twg jira workitem worklog add`) to `lib:jira`.
- Add the `twg-attribution-guard.sh` PreToolUse hook: blocks any twg write whose text credits an agent (Claude, AI-generated, co-author trailers, robot emoji). Everything written to Atlassian reads as the user's own work.

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
