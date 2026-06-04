# Spec — `workflow:scout`

**Status:** draft for review (spec-first; no code until approved)
**Evolves:** `workflow:ecosystem-pulse` (renamed `scout`; ends the "pulse" name collision)
**Name rationale:** a verb (skills=verbs); reconnaissance — range out across sources and bring back what's worth knowing. The act of gathering knowledge to distill/synthesize later. Distinct from `research-lab:gather` (which builds a corpus for a *specific* question); `scout` is continuous, passive, interest-tuned intake.

---

## Purpose

A personal, interest-tuned **radar** that passively surfaces net-new ideas worth knowing — a **better Feedly**. It doesn't just aggregate; it *filters to what matters to you* and *learns from your feedback*. The continuous-learning counterpart to `prioritize`: that one is "what should I do," this one is "what should I be aware of."

## Keep (good bones from `ecosystem-pulse`)
Parallel fetch → diff against the Obsidian vault (dedup) → store net-new → `/loop 30m` cadence → concise briefing. Don't rebuild these.

## Three upgrades (the Feedly-beating parts)

### 1. Extensible, curated source list (config-driven)
Sources move out of the step file into config (`scout` block in `workflow.json`, or `scout.json`): a list, each `{type, url, cadence, weight}`. Types:
- **feed** — subscription feeds (the RSS/Atom sources Feedly subscribes to)
- **page** — fetch + extract a non-feed page
- **search** — a standing web search

The current four hardcoded sources (Simon Willison, Hacker News, Anthropic news, The Batch) become the seed list. Add/remove conversationally — "add Ben Thompson to my scout," "drop The Batch."

### 2. Tunable interest profile (the filter Feedly lacks)
An explicit, inspectable profile: topics / keywords / themes you care about + anti-topics to suppress, in config. Relevance scoring reads this profile instead of re-judging from scratch each run — consistent, and you can see *why* an item was surfaced or dropped.

### 3. Feedback loop (what makes it learn)
When surfacing items, offer: **useful / not / more-like-this / mute-source / mute-topic.** Feedback persists and feeds back into the interest profile + source weights, so the radar sharpens with use. This is the part Feedly never had — passive aggregation becomes an adapting filter.

## Steps (`steps/`)
1. `01-load.md` — read source list + interest profile + feedback history; load vault dedup baseline *(evolves 01-vault-baseline)*
2. `02-fetch.md` — parallel fetch across all configured sources by type *(evolves 02-fetch; now source-list-driven, not hardcoded)*
3. `03-score.md` — dedup vs vault, score relevance against the interest profile + feedback weights *(evolves 03-diff-debate; now profile-driven)*
4. `04-store-output.md` — write net-new to vault, emit ranked briefing with feedback affordance *(evolves 04-store-output)*
5. `05-feedback.md` — capture marks, update profile/weights (propose-then-apply) *(new)*
6. `06-sources.md` — add/remove/mute sources mid-session *(evolves 05-watch-items)*

## Output
Concise briefing, **most-relevant-to-you first**, each with a one-line "why it matched," grouped by source/topic, net-new only, with the mark-feedback affordance.

## Frontmatter
- Rename `ecosystem-pulse` → `scout`; keep trigger phrases ("find AI stories", "check for AI news", "what's new in the AI ecosystem", "run the scout"), drop "pulse" wording.
- `allowed-tools:` Agent, Bash, Read, Write, WebFetch, WebSearch (unchanged).

## Open questions (needs your input before build)
1. **State location:** interest profile + source list in `workflow.json` (or `scout.json`); feedback log in the vault, or a dedicated state file? (Lean: config for sources/profile, vault for feedback so it's reviewable.)
2. **Auto-tuning aggressiveness:** feedback **auto-adjusts** source/topic weights, or **proposes** adjustments you approve? (Lean: propose-then-apply — keeps you in the loop, fittingly.)
3. **Dedup horizon:** rolling window vs whole-vault-forever.
