# Step 2 — Fetch Stories in Parallel

Fetch all sources simultaneously. Do NOT wait for one before starting the next.

## Tool feature sources (new capabilities in your stack)

- `https://simonwillison.net/` — Claude, MCP, agentic tooling coverage (last 3 days)
- `https://www.anthropic.com/news` — Claude and Claude Code announcements
- `https://github.com/anthropics/claude-code/releases` — Claude Code changelog
- `https://openai.com/blog` — Codex and OpenAI tooling updates
- `https://github.blog` — GitHub Copilot features and developer tooling
- `https://github.com/modelcontextprotocol/modelcontextprotocol/releases` — MCP spec updates

## Workflow pattern sources (new ways of working with AI)

- `https://news.ycombinator.com/` — AI/dev tooling stories with 50+ points; skip anything not about agents, workflows, or developer tooling
- `https://www.deeplearning.ai/the-batch/` — AI workflow and agentic pattern coverage; skip if no actionable workflow content this cycle

**Prompt for each fetch:** "List recent stories about AI agents, Claude Code, MCP, developer
tooling, CLI tools for AI, agentic workflows, multi-agent patterns, and coding productivity.
Titles and 1-line summaries only. Focus on the last 3 days."

If a source returns no relevant content, skip it silently.

## Supplemental searches (run in parallel with fetches)

- WebSearch: `Claude Code new features [current month year]`
- WebSearch: `agentic workflow patterns AI [current month year]`
- WebSearch: `MCP new servers tools [current month year]`

Proceed to `steps/03-diff-debate.md` with all fetched stories.
