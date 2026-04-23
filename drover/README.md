# Drover

**Drover watches your Drupal sites' error logs and captures what you know about each error — so the next time a similar one surfaces, you're not rediscovering the fix.**

It's an error-tracking and error-documenting system for teams running one or more Drupal sites. Drover tails the logs (local DDEV + remote Acquia envs you authorize), fingerprints errors so duplicates collapse into one ticket with an occurrence count, surfaces them in a live dashboard, and lets you group related errors across projects and document what they are and how you resolved them. When a similar error recurs later, Drover shows you what worked last time.

Drover does **not** write fixes, open pull requests, or merge code. An optional advisor-agent can read historical documentation and suggest what a solution might look like; the fix itself is yours to make.

---

## Why you might want this

Every Drupal site accumulates errors faster than the team can triage them. PHP warnings, deprecation notices, watchdog entries, nginx 500s — they pile up in logs nobody reads. Real bugs hide inside that noise for weeks, and when they resurface on a sister site six months later, the team rediscovers the fix from scratch.

Drover's job is to turn "seven clients' worth of error streams" into:

- **One dashboard.** All registered projects' errors in one table, grouped by fingerprint so "this happened 47 times" is a single row, not 47.
- **Cross-project grouping.** When the same class of bug affects pncb and ahri, you mark them as one group. Fix once, document once, watch once.
- **Durable documentation.** Every resolved error carries a structured root cause + fix summary + commit SHA on the ticket. That documentation is searchable and — critically — gets surfaced automatically when a matching error appears on another project next month.
- **An honest live view.** A pulse feed in the header shows every significant event as it happens (new fingerprints, threshold crossings, docs captured, groups created, watchers started and stopped). When drover is silent, the dashboard is honestly silent.

---

## How it works (the 30-second tour)

```
┌──────────────┐    ┌──────────┐    ┌─────────┐    ┌─────────────┐    ┌─────────┐
│ Drupal logs  │ →  │  Triage  │ →  │ Ticket  │ →  │ Document    │ →  │ Recall  │
│ (DDEV/Acquia)│    │  agent   │    │ (Beads) │    │ (you)       │    │ (later) │
└──────────────┘    └──────────┘    └─────────┘    └─────────────┘    └─────────┘
```

1. **Log watching.** An umbrella process tails `drush watchdog` + project-configured Acquia log streams for every project you've registered.
2. **Triage.** A Claude agent normalizes each new log line, computes a fingerprint, and either opens a new Beads ticket or increments the occurrence counter on an existing one.
3. **Promotion.** Tickets that cross a per-env threshold (lenient for local dev, aggressive for production) move to the `ready` lane so they stand out in the dashboard.
4. **Document.** A human opens the ticket in the dashboard and fills in a short form: root cause, what was done about it, commit SHA if fixed. Or marks it as known noise. This is the action drover is designed around.
5. **Recall.** Next time a similar error fingerprint surfaces — on *any* registered project — the dashboard's capture modal opens with the past documentation at the top: "we've seen this before; here's what worked." One click applies the past root cause + fix summary to the new ticket.

A dashboard UI at `http://localhost:3749` shows the whole system live.

---

## What Drover will and won't do

**Will:**

- Read log files — local DDEV and/or remote Acquia environments you explicitly enable (all remote envs start paused; you opt in per env).
- Create Beads tickets in each project's `.beads/drover.db`.
- Group tickets across projects that you mark as the same bug; propagate `group-<id>` labels into each project's bd database so the grouping is visible to `bd list`, `drover:recall`, and any other bd-facing tool.
- Store your documented solutions and surface them when a matching error recurs.
- Send you a Slack DM (optional) when a new promoted error appears.
- Use Claude API tokens (so yes, running it costs something).

**Won't:**

- Write code. Drover has no commit / push / PR authority.
- Merge anything.
- Touch your `main` branch or your main working directory.
- Restart DDEV or your database.
- Send error content or documentation to any third party other than Anthropic (Claude API).
- Stream logs from any env you haven't explicitly enabled. Remote envs default to paused.

### An optional, opt-in capability

Drover ships with an experimental *implementer-agent* skill (`/drover:implement`) that can attempt a fix in an isolated git worktree and run quality checks. This is **not part of the primary product** — it requires granting the agent permission to create worktrees, read/write source, and invoke DDEV — and we explicitly do not position drover as a fix-writing tool. Treat it as a future direction that you can opt into if your team wants to experiment with it. The error-tracking + documenting pipeline does not depend on it.

---

## What you'll need

- **Claude Code** (the CLI this plugin runs inside).
- **One or more Drupal projects** running locally in [DDEV](https://ddev.com/).
- **Beads** (`brew install beads`) — the kanban database Drover uses for tickets.
- **Git** for per-project state.
- **Acquia Cloud API credentials** — only if you want Drover to watch Acquia staging/production logs. Get a key + secret from https://cloud.acquia.com/a/profile/tokens
- **Slack** — optional, for DM notifications when a new promoted error appears.

You don't need to know anything about AI agents or prompt engineering. The plugin's skills are the interface — run `/drover:setup`, answer a few questions, and Drover takes care of the rest.

---

## Getting started

See **[ONBOARDING.md](./ONBOARDING.md)** for a step-by-step first-run guide — install the plugin, register a project, open the dashboard, and document your first error, all in about 15 minutes.

For the product spec written as user stories, see **[docs/user-stories.md](./docs/user-stories.md)**.

---

## Where things live

| Thing | Location |
|---|---|
| Per-project config | `<your-project>/.claude/drover-config.json` |
| Global user config (Slack, quiet hours) | `~/.claude/drover-global-config.json` |
| Registered projects list | `~/.claude/plugins/data/drover/projects.json` |
| Cross-project groups | `~/.claude/plugins/data/drover/drover-groups.json` |
| Ticket database (Beads) — one per project | `<your-project>/.beads/drover.db` |
| Dashboard UI | `http://localhost:3749` |
| Log processing state | `~/.claude/drover.state.jsonl` |

---

## The skills you'll use most

| Skill | What it does |
|---|---|
| `/drover:setup` | First-time config wizard for a project. |
| `/drover:add-project` | Register a project with the umbrella monitor. |
| `/drover:dashboard` | Open the live ops dashboard. |
| `/drover:run` | End-to-end: validate env, launch dashboard, run one triage cycle. |
| `/drover:board` | Show current tickets by lane in the terminal. |
| `/drover:solution` | CLI equivalent of the dashboard's Document button — write an Actual solution on a ticket. |
| `/drover:recall` | Search past documented solutions by keyword. |
| `/drover:baseline` | Compute 24h error-velocity baselines for Acquia envs. |

Opt-in / experimental:

| Skill | What it does |
|---|---|
| `/drover:implement` | Claim a ticket and attempt a fix in an isolated worktree. Requires granting the implementer-agent write/exec permissions on your codebase. Not part of the primary product. |

Full skill list: `drover/skills/*/SKILL.md`.

---

## A note for the curious

Under the hood, Drover is a few cooperating pieces:

- A **triage agent** (Claude, haiku) that reads log lines and manages Beads tickets.
- An **umbrella** shell process that supervises per-env watcher children (`ddev-watch.py` for DDEV, `acquia-watch.py` for Acquia, `wp-watch.py` for WordPress) and forwards their stdout to the dashboard.
- A **zero-dependency Node dashboard** that merges ticket state across every registered project's `.beads/` in virtual-central mode, exposes an event-stream over SSE, and holds the recall engine.
- **Beads** for ticket state. Groups are persisted as `group-<id>` labels on member cards (visible to `bd list`) plus a JSON manifest for cross-project metadata.

If you want to extend it — add a log source, change the promotion heuristic, swap the recall scorer — every agent and skill is a plain Markdown file you can read and edit.
