# Drupal MCP Landscape: `mcp_tools` and `mcp_server`

**Date:** 2026-03-02
**Status:** Research report

---

## Executive Summary

`mcp_tools` and `mcp_server` are two complementary Drupal modules that expose Drupal capabilities over the Model Context Protocol (MCP):

- **`mcp_tools`** — A batteries-included suite of 222 pre-built tools across 34 submodules for AI-driven site administration. Think of it as a Drupal admin UI reimagined for AI agents.
- **`mcp_server`** — A configuration-driven MCP transport framework. It's the infrastructure layer for exposing *any* Drupal capability over MCP — including custom modules, third-party APIs, and business logic.

**Central finding:** MCP does not replace Drush. It is a different abstraction optimized for AI-first interaction. Where Drush is a command-line interface for developers, MCP is a typed, stateful, conversationally-aware protocol for AI agents. They coexist — `mcp_tools` even includes a submodule (`mcp_tools_dev_tools`) that exposes Drush commands as MCP tools.

---

## The Two Modules

### `mcp_tools`

| | |
|---|---|
| **Maintainer** | mowens |
| **Created** | January 2, 2026 |
| **Version** | 1.0.0-beta5 |
| **Security coverage** | None (not covered by Drupal's security advisory policy) |
| **Requires** | Drupal 10.3+ / 11, Tool API module, PHP 8.3+ |

222 tools organized across 34 optional submodules:

| Category | Submodule | What it covers |
|---|---|---|
| Site building | `mcp_tools_structure` | Content types, fields, vocabularies, roles, permissions, menus |
| | `mcp_tools_views` | Views and display modes |
| | `mcp_tools_blocks` | Block placement |
| | `mcp_tools_layout_builder` | Layout Builder configuration |
| Content | `mcp_tools_content` | Node CRUD, publishing, bulk operations |
| | `mcp_tools_media` | Media assets |
| | `mcp_tools_paragraphs` | Paragraphs fields |
| | `mcp_tools_webform` | Webform management |
| Workflow | `mcp_tools_moderation` | Content moderation states |
| | `mcp_tools_scheduler` | Scheduled publishing |
| Operations | `mcp_tools_cache` | Cache clearing |
| | `mcp_tools_cron` | Cron and queue management |
| | `mcp_tools_config` | Config import/export |
| | `mcp_tools_batch` | Batch operations |
| | `mcp_tools_dev_tools` | Drush command access via MCP |
| Other | `mcp_tools_metatag`, `mcp_tools_theme`, `mcp_tools_image_styles`, `mcp_tools_recipes`, `mcp_tools_users`, `mcp_tools_analysis` | SEO, theming, image styles, Recipes, user management, site audits |

Each tool is an **atomic operation** with typed JSON Schema inputs and structured JSON output. Tools are designed to chain: create a content type → add fields → build a view, all in one conversation.

### `mcp_server`

| | |
|---|---|
| **Maintainers** | e0ipso (Lullabot), gagosha, jibla (Omedia) |
| **Created** | November 14, 2025 |
| **Version** | No stable release |
| **Security coverage** | None |
| **Status** | 13 open issues, 5 bug reports — actively stabilizing |

`mcp_server` is the transport infrastructure, not a tool suite. It:
- Implements the **full MCP specification** (tools, resources, prompts, sampling)
- Uses **configuration entities** for dynamic tool registration (not hardcoded PHP)
- Supports **OAuth 2.1** via Simple OAuth module
- Provides a UI at `/admin/config/mcp` for managing tool exposure
- Lets any Drupal module register tools via Drupal's plugin system

In short: `mcp_tools` ships 222 tools, `mcp_server` ships zero tools but lets you expose anything.

---

## Transport: How It Works Technically

Both modules support two transports:

### STDIO (Local Development)

Runs as a subprocess via Drush. Claude Desktop, Cursor, and Windsurf use this for local dev.

```json
// ~/.config/claude/claude_desktop_config.json
{
  "mcpServers": {
    "drupal": {
      "type": "stdio",
      "command": "drush",
      "args": ["mcp-tools:serve"]
    }
  }
}
```

Auto-detects DDEV/Lando. `drush mcp-tools:client-config` generates the config block automatically.

### HTTP / SSE (Remote)

Available at `https://your-site.com/_mcp`. Uses Server-Sent Events for streaming. API key auth at `/admin/config/services/mcp-tools/remote`.

### Protocol

JSON-RPC 2.0 with MCP extensions:

```
Client → initialize → Server
Client ← capabilities, tools/list ← Server
Client → tools/call { tool: "create_content_type", input: {...} } → Server
Client ← { status: "success", content_type_id: "product" } ← Server
```

---

## Security Model

### `mcp_tools`: Three-Tier Presets

| Preset | Use case | Rate limit | Write access |
|---|---|---|---|
| Development | Local dev | None | Full |
| Staging | Config/analysis only | ~100 req/hr | Config only |
| Production | Read-only, remote clients | ~10 req/hr | None |

Plus scope-based access per connection (`read`, `write`, `admin`, `config`) and API key management for remote HTTP. UID 1 (Drupal superadmin) is always shielded.

### `mcp_server`: OAuth 2.1 + RBAC

- OAuth 2.1 Bearer tokens (Simple OAuth 2.1 module)
- Role-based permissions at the individual tool level
- Per-tool auth modes: Required / Disabled / Inherited
- Admin UI for full permission visibility

`mcp_tools` presets are simpler and opinionated. `mcp_server` OAuth 2.1 is standards-based and flexible.

---

## The Central Question: If MCP Were a CLI, How Different Would It Be from Drush?

This is the right question. The answer is: **they're solving different problems at different layers**.

### What MCP gives you that a Drush CLI doesn't

**1. Machine-readable discovery**
`drush help` returns human-readable text. `tools/list` returns JSON with full parameter schemas, descriptions, and types — structured for an AI to reason over, not for a human to read.

**2. Typed, validated inputs**
Drush parses strings from the command line. MCP validates JSON inputs against a schema *before* execution. The AI knows exactly what parameters a tool accepts and what types they must be.

**3. Stateful conversation context**
Drush is stateless — each command is independent. MCP maintains context across a conversation. The AI can reference the output of `create_content_type` when calling `create_field` without re-parsing anything.

**4. Tool composition without shell scripting**
Multi-step workflows happen in the AI's reasoning layer, not in bash scripts. The AI decides which tools to chain based on schemas, not by parsing `--help` output.

**5. No shell escaping / injection risk**
MCP uses JSON-RPC. No shell injection surface.

**6. IDE integration is first-class**
Claude Desktop, Cursor, and Windsurf integrate MCP natively. There's no terminal required.

### What Drush has that MCP doesn't

**1. Simplicity** — `drush` is a binary. MCP requires a running Drupal instance, module install, and STDIO/HTTP configuration.

**2. Shell composability** — `drush field:info | grep custom | wc -l` works in one line. MCP composition is conversational, not pipeline-based.

**3. Offline/local usage** — Drush can bootstrap Drupal locally without a web server. MCP needs a live Drupal instance.

**4. Scripting and automation** — Shell scripts, CI pipelines, cron jobs all work naturally with Drush. MCP is not designed for unattended scripting.

**5. Ecosystem maturity** — Drush has 15+ years of modules, hooks, recipes, and battle-tested patterns. MCP for Drupal is 5 months old.

**6. Security coverage** — Drush is Drupal-security covered. Neither MCP module is.

### The comparison table

| Dimension | Drush | `mcp_tools` (hypothetical CLI mode) | `mcp_tools` (actual MCP) |
|---|---|---|---|
| Invocation | `drush ctype:create --label="Product"` | `drush mcp:create-content-type --name="product"` | JSON-RPC via tools/call |
| Discovery | `drush help` (human text) | `drush list` (human text) | `tools/list` (machine JSON + schemas) |
| Validation | String arg parsing | String arg parsing | JSON Schema validation before exec |
| Context | Stateless | Stateless | Stateful (conversation) |
| Composition | Shell piping | Shell piping | AI reasoning over schemas |
| AI-friendliness | Usable but not designed for AI | Same | Native |
| Human-friendliness | Designed for humans | Designed for humans | Not designed for humans |
| Setup | Binary install | Binary install | Module + STDIO/HTTP config |

### The real relationship

They're not alternatives — they coexist. `mcp_tools_dev_tools` *wraps Drush commands as MCP tools*, so an AI can call `drush pm:install` via MCP. Developers still use Drush directly for scripting and terminal work. AI agents use MCP for conversational site management.

The question "what if MCP were a CLI" is a bit like asking "what if a REST API were a CLI" — you'd get something like curl, which works but loses the structured discovery and contract that makes APIs valuable for tooling. The value isn't in the transport; it's in the schema-first, typed, discoverable interface that MCP enforces.

---

## Maturity Assessment

Both are nascent. Neither has Drupal security coverage.

| Module | Age | Status | Production? |
|---|---|---|---|
| `mcp_tools` | ~2 months | Beta (actively iterated) | No |
| `mcp_server` | ~4 months | Pre-release (stabilizing) | No |

`mcp_tools` has more momentum right now — beta5 in 2 months, growing community blog coverage, real adoption by Claude Code / Cursor users. `mcp_server` is architecturally more principled (OAuth 2.1, full MCP spec) but slower to stabilize.

---

## Relevance to drupal-lab

drupal-lab agents (implementer, fixer, reviewer) work at the **code development layer** — writing PHP, running PHPCS/PHPStan/PHPUnit in DDEV, submitting patches to drupal.org. They don't administer running Drupal sites.

`mcp_tools` / `mcp_server` operate at the **site administration layer** — creating content types, managing views, clearing caches on a live Drupal instance.

These are different layers. There is no overlap with your current workflow.

**One potential future use case:** If drupal-lab were extended to include integration testing against a live DDEV Drupal instance (not just unit/kernel tests), MCP tools could let agents verify that configuration changes took effect on the running site. But this is not a current gap.

**The `mcp_tools_dev_tools` submodule** (Drush-as-MCP-tools) is the most interesting to watch — it's the inverse of drupal-lab's approach (you use Drush directly; they wrap Drush in MCP). If you ever wanted to give Claude Code direct structured access to a running Drupal admin surface (not DDEV, but a real site), this is the path.

---

## Sources

- [MCP Tools | Drupal.org](https://www.drupal.org/project/mcp_tools)
- [MCP Server | Drupal.org](https://www.drupal.org/project/mcp_server)
- [Turn Your Drupal Site Into an MCP Server | TheDropTimes](https://www.thedroptimes.com/66132/turn-your-drupal-site-mcp-server-ai-tools-claude-and-cursor)
- [Tool API | Drupal.org](https://www.drupal.org/project/tool)
- [Drupal MCP documentation site](https://drupalmcp.io/en/)
- [Drupal as an AI Gateway | Skywork](https://skywork.ai/skypage/en/drupal-ai-gateway-engineer-guide/1981188826850054144)
- [MCP Tools: AI-Powered Site Building | CodeWheel](https://github.com/code-wheel/mcp-tools)
- [MCP vs CLI for AI Agents | ModelsLab](https://modelslab.com/blog/api/mcp-vs-cli-ai-agents-developers-2026)
- [Why CLI Tools Are Beating MCP for AI Agents | Jannik Reinhard](https://jannikreinhard.com/2026/02/22/why-cli-tools-are-beating-mcp-for-ai-agents/)
- [Drupal MCP 1.2 Released | TheDropTimes](https://www.thedroptimes.com/56065/drupal-mcp-12-released-with-security-coverage-tools-api-integration-and-oauth-support)
