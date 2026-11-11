# Changelog

## 3.0.0 — 2026-11-10

**Breaking: `slack` reads through the host's Slack connector.** It no longer uses or installs the `agent-slack` command-line tool and does not fall back to it. Operations map to `slack_search_channels`, `slack_read_channel`, `slack_read_thread` and `slack_search_public_and_private`. The connector reaches the one workspace of the account signed in to the host. The skill stays read-only.

## 2.0.1 — 2026-11-10

- `jira`: the documented shape of `twg jira workitem get` was wrong for more than one key. Several keys return `.data.items[].data`, not `.data[]`, fields have no `.fields` wrapper, and descriptions and comment bodies are Atlassian Document Format objects. Four sessions each spent three to five calls finding that out. The skill now states both shapes and gives one `jq` recipe that reads either.

## 2.0.0 — 2026-11-11

**Breaking: `csv-analysis`, `hyperfine`, `lighthouse` and `pa11y` removed.** None was invoked in either account's sessions between August 3 and November 9, 2026, and each description loads into every session.

- `hyperfine`, `lighthouse` and `pa11y` repeated commands that `test-lab:perf-measure` and `test-lab:accessibility-scan` already carry, including the self-signed certificate flags for DDEV sites. Use those skills instead.
- `csv-analysis` was a generic pandas walkthrough with nothing specific to this toolset. Ask for the analysis directly.
- `DEPENDENCIES.md`, the plugin README and `admin:install`'s dependency map no longer list the removed skills or the pandas, matplotlib and seaborn packages only `csv-analysis` needed.

## 1.7.0 — 2026-11-11

- Add `upstream-post-guard`, a PreToolUse hook that blocks git.drupalcode.org posts (merge request and issue notes, `/do:` commands, merge request descriptions) unless the body comes from a file with a `<body>.gate.json` worth-it record whose sha256 matches, the body is at most 150 words with no headings, filler, side findings or agent attribution, and, for projects listed in `~/.claude/upstream-maintainers.json`, the user approved the exact text. All five merge request notes our agents posted on drupal/group on 2026-11-05 are refused by it.
- Add `references/worth-it.md`: the five-check gate (one problem, proven, smallest, asked for, worth the reviewer's time), its record format, and rules for writing to people outside the team.
- `babysit-pr` and `leave-pr-comment` run the gate before every commit and comment and record the answers; anything that fails becomes a follow-up for Chris.

## 1.6.2 — 2026-11-11

- `upload-to-pr`: proof and demo videos are made with `lib:record-demo` first; this skill only attaches the finished file. Drops the `screencapture -v` then trim guidance. Prose is unwrapped to one line per paragraph for the Markdown wrap check.

## 1.6.1 — 2026-11-11

- `ffmpeg`: send requests to make, cut or tighten a proof or demo video of a change to `lib:record-demo` (description "Not for" clause and a "Do NOT trigger" routing line).

## 1.6.0 — 2026-11-09

- Add `lib:record-demo`: turn a browser recording into a short proof video. The skill covers planning shots, staging before recording, tightening and reviewing the cut. `scripts/tighten_video.py` keeps moving stretches, caps each freeze at `--cap` (default 0.8 s), holds result frames with `--hold-at T[:SECS]` or `--auto-holds`, prepends a slide held for reading time, writes an optional contact sheet, re-checks the output for freezes and prints a JSON summary. Exit 1 means dead air remains; exit 2 means bad input or a missing tool. A closing hold longer than its freeze repeats the last frame. Synthetic-clip tests run in CI with ffmpeg and ImageMagick installed.

## 1.5.3 — 2026-11-06

- `hyperfine`: vet numbers with test-lab's benchmark checklist before reporting; lead with a verdict and give median, range, run count, limiter, error count and the work check. The comparison snippet now extracts median, range and run count.
- `lighthouse`: take the median of at least 5 runs, matching the benchmark checklist.

## 1.5.2 — 2026-11-05

- `vault-store` (and its `vault-paths.md`), `archive` and `wiki-query` use `Research-Lab/Topics/<topic>/` for research notes instead of `Research/<topic>/`. The folder name follows `folder` in `research-lab.json` when set. `Research/` keeps only `Model-Routing/`, which `wiki-query` still searches. Each skill states how to find the configured folder name (`RESEARCH_LAB_CONFIG`, else `research-lab.json` in `$CLAUDE_CONFIG_DIR` or `~/.claude`).

## 1.5.1

- `wiki-query` checks `Next-Adventures/` (renamed from `Next-Experiments/`).

## 1.5.0 — 2026-10-29

- Add `lib:transcript`: a timed transcript from a YouTube link, another yt-dlp source, or a local audio or video file. Captions come first (manual, then automatic; `json3` when offered, else VTT, with rolling auto-caption repeats removed); `mlx_whisper` speech recognition runs only with `--approve-asr`. Writes `transcript.json` (stable segment IDs and times, method, gaps, provenance, segment hash) and a readable `transcript.md` with timestamp links. Never summarizes.

## 1.4.2 — 2026-10-09

- Fix `testrail` authentication: select 1Password accounts by item ID, share QA-AI environment conventions, and use email-based Keychain lookup.
- Add a bounded read helper with identity/project visibility checks and curl authentication on stdin, keeping secrets out of arguments and diagnostics.

## 1.4.1 — 2026-09-29

- Point `pa11y`, `lighthouse`, and `hyperfine` at `test-lab:accessibility-scan` and `test-lab:perf-measure`.
- `vault-store` drops sprint and retro output paths; project retrospectives file under `Retrospectives/<date>+<project>/`.

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
