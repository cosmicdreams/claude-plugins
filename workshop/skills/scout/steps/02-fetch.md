# Step 2 — Fetch Stories in Parallel

Fetch every configured source **simultaneously** (one subagent per source). Do not wait for one
before starting the next.

## Drive from the config source list

For each entry in `scout.sources` (from step 1), fetch by `type`:

- **`feed`** — fetch the RSS/Atom feed; parse entries by title + description; skip entries older
  than the source's `cadence` (default 3 days).
- **`page`** — fetch the page and extract headline content (use the defuddle/obsidian extractor or
  WebFetch); skip if unchanged since last run.
- **`search`** — run the standing query via WebSearch with the current month/year interpolated.

**Prompt for each fetch:** "List recent items from this source about {interests}. Titles and
one-line summaries only. Skip anything older than {cadence}." Pass the interest profile so each
fetch is already biased toward relevant material.

## Seed list (fallback only — used when no `scout.sources` is configured)

These are the original defaults; on first run, offer to write them into `scout.sources` so the list
becomes user-owned and extensible:

- `feed`  — `https://simonwillison.net/atom/everything/` (Claude, MCP, agentic tooling)
- `feed`  — `https://github.blog/feed/` (developer tooling)
- `page`  — `https://www.anthropic.com/news` (Claude releases)
- `search`— `Claude Code new features {month year}`
- `search`— `agentic workflow patterns AI {month year}`
- `search`— `MCP new servers tools {month year}`
- `feed`  — Hacker News front page, filtered to agents/workflows/dev-tooling

## Source discovery

While fetching, note any domain **not** in `scout.sources` that surfaces a clearly on-interest item.
Tag it `[SOURCE CANDIDATE: domain — why it produced signal]` and pass it to step 4. Candidates are
surfaced for review only; the user promotes them via `steps/06-sources.md`.

Proceed to `steps/03-score.md` with all fetched items.
