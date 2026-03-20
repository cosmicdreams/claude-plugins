# Step 2 — Fetch Stories in Parallel

Fetch all sources simultaneously. Do NOT wait for one before starting the next.

## Primary sources

- `https://simonwillison.net/` — AI agents, Claude, MCP, developer tooling (last 3 days)
- `https://news.ycombinator.com/` — AI/dev tooling stories with 50+ points
- `https://www.anthropic.com/news` — Anthropic announcements
- `https://www.deeplearning.ai/the-batch/` — AI ecosystem roundup

**Prompt for each fetch:** "List recent stories about AI agents, Claude, MCP, developer tooling,
CLI tools for AI, AI workflows, coding productivity, and claudepilled developer practices.
Titles and 1-line summaries only. Focus on the last 3 days."

If a source returns no relevant content, skip it silently.

## Supplemental search (run in parallel with fetches)

- WebSearch: `Claude Code new features [current month year]`
- WebSearch: `AI agent CLI tools developer productivity [current month year]`

Proceed to `steps/03-diff-debate.md` with all fetched stories.
