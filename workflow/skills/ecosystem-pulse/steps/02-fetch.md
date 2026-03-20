# Step 2 — Fetch Stories in Parallel

Fetch all sources simultaneously. Do NOT wait for one before starting the next.

**SOURCES ARE EXTENSIBLE**: This list is a starting point and will grow over time. To add a new source:
1. Choose RSS feed URL or API endpoint
2. Add entry to the appropriate category (Tool features / Workflow patterns)
3. Include format hint (RSS, GitHub API, etc.)
4. Test with a full run; report success/failure
5. Commit to workflow/skills/ecosystem-pulse/steps/02-fetch.md

## Tool feature sources (new capabilities in your stack)

- `https://simonwillison.net/` — Claude, MCP, agentic tooling coverage (last 3 days)
- `https://api.github.com/repos/anthropics/claude/releases` — Claude model releases (GitHub API JSON)
- `https://api.github.com/repos/anthropics/claude-code/releases` — Claude Code changelog (GitHub API JSON)
- `https://api.github.com/repos/openai/gpt-4` — OpenAI model releases (GitHub API JSON, filter by updates about new models/APIs)
- `https://github.blog/feed/` — GitHub Copilot features and developer tooling (RSS feed)
- `https://api.github.com/repos/modelcontextprotocol/modelcontextprotocol/releases` — MCP spec updates (GitHub API JSON)
- `https://news.ycombinator.com/newest?p=1` — Real-time HN feed for Anthropic/OpenAI news (secondary, cross-checked with primary)
- `https://news.google.com/rss/topics/CAAqKAgKIkZPUjBCVExFYm5rTEpKRWZEZ3dFQVFJQ0JBRWlHQ3lFSktEb3dFCg` — Google News: AI (RSS feed)

## Workflow pattern sources (new ways of working with AI)

- `https://news.ycombinator.com/` — AI/dev tooling stories with 50+ points; skip anything not about agents, workflows, or developer tooling
- `https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml` — Broad tech coverage (includes AI workflow/policy stories)

**Prompt for each fetch:** "List recent stories about AI agents, Claude Code, MCP, developer
tooling, CLI tools for AI, agentic workflows, multi-agent patterns, and coding productivity.
Titles and 1-line summaries only. Focus on the last 3 days."

**Source format notes:**
- RSS feeds (`.xml`, `/feed`, `/feeds`): Parse entries by title and description
- GitHub API (api.github.com): Extract from `name`, `body`, `published_at` fields
- Skip any entries older than 3 days

If a source returns no relevant content, skip it silently.

## Supplemental searches (run in parallel with fetches)

- WebSearch: `Claude Code new features [current month year]`
- WebSearch: `agentic workflow patterns AI [current month year]`
- WebSearch: `MCP new servers tools [current month year]`
- WebSearch: `AI workflow developer blogs newsletters worth following [current year]` — **source discovery**: note any domains that produce 2+ high-signal hits per cycle; candidate for addition as permanent source

**Source discovery pipeline**: If a domain from supplemental searches produces consistent high-signal hits, report it to team-lead for evaluation as a permanent source. This keeps the source list evolving with ecosystem trends.

Proceed to `steps/03-diff-debate.md` with all fetched stories.
