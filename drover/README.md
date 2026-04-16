# Drover

**Drover watches your Drupal site's error logs and opens fix PRs for you to review.**

It's an automated error-monitoring pipeline for Drupal projects. When an error appears in the logs, Drover notices it, groups it with related errors, writes up a ticket, spins up an isolated sandbox, attempts a fix, and hands the result back to you as a ready-to-review change. A human always makes the final call — Drover never merges code on its own.

---

## Why you might want this

Every Drupal site accumulates errors faster than the team can triage them. PHP warnings, deprecation notices, watchdog entries, nginx 500s — they pile up in logs nobody reads. Real bugs hide inside that noise for weeks.

Drover is a tireless junior engineer who:

- reads the logs every few minutes,
- groups identical errors so you see "this happened 47 times" instead of 47 separate rows,
- files a ticket for anything that looks real,
- opens a git worktree and tries a fix,
- runs your project's quality checks (PHPCS, PHPStan),
- pings you when a fix is ready for review.

You stay in control. Drover does the tedious parts.

---

## How it works (the 30-second tour)

```
┌──────────────┐    ┌──────────┐    ┌─────────┐    ┌──────────────┐    ┌─────────┐
│ Drupal logs  │ →  │  Triage  │ →  │ Ticket  │ →  │ Fix attempt  │ →  │ You     │
│ (DDEV/Acquia)│    │  agent   │    │ (Beads) │    │ (worktree)   │    │ review  │
└──────────────┘    └──────────┘    └─────────┘    └──────────────┘    └─────────┘
```

1. **Log watching.** An umbrella process tails `drush watchdog:tail` and web-container logs for every project you've registered.
2. **Triage.** A Claude agent reads the new log lines, fingerprints each error (so duplicates collapse), and either opens a new ticket or increments the counter on an existing one.
3. **Promotion.** Once a ticket crosses a threshold (e.g. 5 occurrences for local dev, 1 for production), it moves to the "ready to fix" lane.
4. **Fix attempt.** An implementer agent claims the ticket, creates an isolated git worktree, writes a fix, and runs your quality checks.
5. **Review.** The ticket moves to "awaiting review" and you get a Slack DM. You look at the diff, decide whether to merge, and close the ticket.

A dashboard UI at `http://localhost:3749` shows the whole pipeline live.

---

## What you'll need

- **Claude Code** (the CLI this plugin runs inside)
- **A Drupal project** running locally in [DDEV](https://ddev.com/)
- **Beads** (`brew install beads`) — the kanban database Drover uses for tickets
- **Git** and the **`gh` CLI** (for branches and eventual PRs)
- **Acquia CLI** (`acli`) — only if you want Drover to watch Acquia staging/production logs
- **Slack** — optional, for DM notifications when a fix is ready

You don't need to know anything about AI agents or prompt engineering. The plugin's skills are the interface — you run `/drover:setup`, answer a few questions, and Drover takes care of the rest.

---

## What Drover will and won't do

**Will:**

- Read log files (local DDEV and/or remote Acquia environments you configure)
- Create Beads tickets in a local database (`.beads/drover.db`)
- Create git worktrees under `worktrees/drover-*`
- Write code on a branch inside those worktrees
- Run PHPCS / PHPStan locally via DDEV
- Send you a Slack DM when something needs your attention
- Use Claude API tokens (so, yes — it costs money to run)

**Won't:**

- Push branches to your remote without you asking
- Open pull requests automatically (unless you explicitly opt in)
- Merge anything
- Touch your `main` branch or your main working directory
- Restart DDEV or your database
- Send errors or code to any third party other than Anthropic (Claude API)

---

## Getting started

See **[ONBOARDING.md](./ONBOARDING.md)** for a step-by-step first-run guide — install the plugin, configure a project, and watch Drover handle its first error, all in about 15 minutes.

---

## Where things live

| Thing | Location |
|---|---|
| Per-project config | `<your-project>/.claude/drover-config.json` |
| Global user config (Slack, quiet hours) | `~/.claude/drover-global-config.json` |
| Registered projects list | `~/.claude/plugins/data/drover/projects.json` |
| Ticket database (Beads) | `<your-project>/.beads/drover.db` |
| Dashboard UI | `http://localhost:3749` |
| Log processing state | `~/.claude/drover.state.jsonl` |

---

## The skills you'll use most

| Skill | What it does |
|---|---|
| `/drover:setup` | First-time config wizard for a project |
| `/drover:add-project` | Tell the umbrella monitor to start watching a project |
| `/drover:run` | End-to-end: validate, launch dashboard, run one triage cycle |
| `/drover:board` | Show current tickets by lane |
| `/drover:dashboard` | Open the live ops dashboard |
| `/drover:implement` | Pick the top-priority ticket and attempt a fix |
| `/drover:baseline` | Compute 24h error-velocity baselines for Acquia envs |

Full skill list: `drover/skills/*/SKILL.md`.

---

## A note for the curious

Under the hood, Drover is a cooperating set of Claude Code agents (a triage agent, an implementer agent) plus a few Node/Python scripts for log fetching, fingerprinting, and the dashboard UI. It leans heavily on the [Beads](https://github.com/sonrise/beads) kanban CLI for ticket state. The pipeline is event-driven: an umbrella monitor process polls every 30 seconds and wakes the right skill when something happens.

If you want to extend it — add a new log source, a new quality check, a new fix heuristic — every agent and skill is a plain Markdown file you can read and edit.
