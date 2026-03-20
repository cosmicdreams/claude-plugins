# Step 2 — Fetch Stories in Parallel

Fetch all sources simultaneously. Do NOT wait for one before starting the next.

## Tool feature sources (new capabilities in your stack)

- `https://simonwillison.net/` — Claude, MCP, agentic tooling coverage (last 3 days)
- `https://www.anthropic.com/news/feed.xml` — Claude and Claude Code announcements (RSS feed)
- `https://api.github.com/repos/anthropics/claude-code/releases` — Claude Code changelog (GitHub API JSON)
- `https://openai.com/blog/feed` — Codex and OpenAI tooling updates (RSS feed)
- `https://github.blog/feed/` — GitHub Copilot features and developer tooling (RSS feed)
- `https://api.github.com/repos/modelcontextprotocol/modelcontextprotocol/releases` — MCP spec updates (GitHub API JSON)
- `https://blog.google/feed/technology/` — Google AI and DeepMind announcements (RSS feed)
- `https://developers.google.com/blog/feeds` — Google AI developer tooling and Gemini API (RSS feed)

## Workflow pattern sources (new ways of working with AI)

- `https://news.ycombinator.com/` — AI/dev tooling stories with 50+ points; skip anything not about agents, workflows, or developer tooling
- `https://www.deeplearning.ai/the-batch/feed` — AI workflow and agentic pattern coverage (RSS feed)

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
- WebSearch: `AI workflow developer blogs newsletters worth following [current year]` — source discovery; note any domains that produce 2+ high-signal hits

Proceed to `steps/03-diff-debate.md` with all fetched stories.
