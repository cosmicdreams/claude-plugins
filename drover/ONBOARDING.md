# Drover Onboarding

A first-run guide, written for someone who has never used an AI coding agent before. By the end, Drover will be watching one of your Drupal projects and you'll have seen it handle a real error end-to-end.

Budget: **about 15 minutes** of your time plus a few minutes of waiting.

---

## Before you start

You need these installed:

| Tool | Why | Check it works |
|---|---|---|
| [Claude Code](https://docs.claude.com/claude-code) | Runs the plugin | `claude --version` |
| [DDEV](https://ddev.com/) | Runs your Drupal site locally | `ddev version` |
| [Beads](https://github.com/sonrise/beads) | Kanban database for tickets | `bd --version` (install: `brew install beads`) |
| `git` and [`gh`](https://cli.github.com/) | Version control and GitHub | `git --version && gh --version` |
| `node` ≥ 18 | Powers the dashboard UI | `node --version` |

You also need:

- **A Drupal project in DDEV**, with the site running (`ddev start`). It can be new or existing — Drover doesn't modify your site's code at setup time.
- **An Anthropic API key** configured for Claude Code. Running Drover uses tokens; expect a few cents per triage cycle during normal operation, more when it attempts fixes.
- **A git repo** for that project, with a clean working tree. Drover will create worktrees off your main branch.

Optional (you can skip these and add them later):

- An **Acquia Cloud** account with `acli` authenticated (`acli auth:login`) — if you want Drover to watch staging or production logs.
- A **Slack user ID** — for DM notifications. Find yours in Slack → your profile → "Copy member ID". Looks like `U012AB3CD`.

---

## Step 1 — Install the plugin

Drover lives in a local plugin marketplace. One-time setup:

```bash
claude plugin install drover@local --scope user
```

Confirm it's installed:

```bash
claude plugin list 2>&1 | grep drover
```

You should see `drover` with a version number.

---

## Step 2 — Configure your project

From the root of your Drupal project (the folder containing `.ddev/` and your git repo), open Claude Code and run:

```
/drover:setup
```

Drover will ask you a series of questions. Reasonable defaults are shown in brackets — you can hit enter through most of them.

Expect to be asked:

- **Project name** — a slug used in notifications. Use your site's short name.
- **Slack User ID** — paste it if you want DMs; leave blank otherwise.
- **Quiet mode / quiet hours** — whether to suppress non-critical pings.
- **DDEV project name** — Drover shows you your DDEV projects; pick the one for this site.
- **Acquia staging/production** — skip these if you don't have Acquia. Otherwise paste the app UUID from `acli app:list`.
- **Quality checks** — keep PHPCS on (recommended), PHPStan is optional.

When it finishes you'll see:

```
drover setup complete ✓
Project: your-site
Config:  .claude/drover-config.json
Board:   .beads/drover.db (empty)
Environments:
  local (DDEV: your-site) — trust:low — noise filter ON
```

Two files now exist that you should know about:

- `.claude/drover-config.json` — project-specific settings (commit this, it's not sensitive)
- `~/.claude/drover-global-config.json` — your personal Slack / quiet-hours settings (do NOT commit; lives in your home dir)

---

## Step 3 — Register the project for continuous watching

Setup configured the project, but Drover doesn't start watching it until you register it:

```
/drover:add-project
```

On macOS this opens a folder picker — point it at your project root. On other platforms, pass the path as an argument.

You should see:

```
Added your-site at /path/to/your-site. Drover will start watching within 30s.
```

An umbrella monitor process (shipped with the plugin, auto-armed at session start) now polls `drush watchdog:tail` and `ddev logs --service web` every 30 seconds for your project.

---

## Step 4 — Run the first triage cycle

Register-and-wait works, but for your first run it's more satisfying to trigger a cycle manually and watch it happen:

```
/drover:run
```

This will:

1. Validate your config and check DDEV is healthy.
2. Launch the dashboard UI at `http://localhost:3749` (it should auto-open in your browser).
3. Spawn a triage agent for each environment you configured.
4. Print a summary when done.

You should see output like:

```
DDEV healthy: your-site @ /path/to/your-site
Dashboard: http://localhost:3749
━━━ drover:run complete ━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Dashboard:     http://localhost:3749
  Environments:  local
TRIAGE
  New errors:    0
  Augmented:     0
  Promoted:      0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Zero errors on a healthy site is the right answer. If your site has log entries already, you may see non-zero numbers — those are real.

Open the dashboard in your browser. You'll see tiles for each environment, a timeline, and lanes for tickets. Empty is fine.

---

## Step 5 — Trigger a fake error to see the pipeline

The most reassuring way to see Drover work is to make it handle a real error. Add a deliberate bug to your site:

In a throwaway custom module (or a test-only file), add a PHP notice:

```php
<?php
// somewhere that gets executed
$undefined = $thisVariableDoesNotExist;
```

Load the page that triggers it a few times. Then wait ~1 minute for the umbrella monitor to poll, or run `/drover:run` again.

This time the triage summary should show `New errors: 1` or `Augmented: 1`. Check the dashboard — a ticket appeared in the **lane-errors** column.

---

## Step 6 — Watch Drover attempt a fix

When a ticket's occurrence count crosses its threshold (default for local: 5 occurrences), it moves to **lane-ready**. You can force this by hitting the bad page a few more times, or by manually moving the ticket with `bd`:

```bash
bd update <ticket-id> --db .beads/drover.db --remove-label lane-errors --add-label lane-ready
```

Then:

```
/drover:implement
```

Drover will:

1. Pick the highest-priority ticket from `lane-ready`.
2. Create a git worktree at `worktrees/drover-<ticket-id>/`.
3. Spawn an implementer agent to write a fix.
4. Run your configured quality checks (PHPCS, optionally PHPStan) inside DDEV.
5. Move the ticket to `lane-awaiting-review`.
6. Send you a Slack DM (if configured).

You can watch progress in the dashboard. When it finishes, `cd` into the worktree and `git diff main` to see what Drover wrote.

**You're the reviewer.** Nothing gets merged. If the fix looks good, merge it yourself. If not, close the ticket as `rejected` and the error will re-appear in triage next cycle (so Drover can try again with more context).

---

## Step 7 — Ongoing use

Once you trust the setup, day-to-day use is:

- **Leave it running.** The umbrella monitor polls every 30s whenever you have a Claude Code session open in the project.
- **Glance at the dashboard** when you want a snapshot: `/drover:dashboard`.
- **Check the board** when you want text output: `/drover:board`.
- **Trigger fixes on demand**: `/drover:implement` (or `/loop 30m /drover:implement` for an autonomous loop).
- **Baselines** (Acquia only): once a day, run `/drover:baseline` to refresh 24h error-velocity stats.

---

## Troubleshooting

### The dashboard doesn't open

```bash
lsof -ti:3749  # is anything listening?
```

If empty, the server failed to start. Run `/drover:run` again and watch for `WARNING: Dashboard failed to start`.

### Drover says "DDEV project 'x' is not running"

Drover never starts DDEV for you. Run `ddev start` in the project and try again.

### Tickets keep appearing for the same error after a "fix"

The fix didn't actually resolve it. Look at the ticket's re-open note in the dashboard — it will say "fix ineffective after N cycles". Close the ticket manually and investigate.

### I need to start over

Reset Drover's state without losing tickets:

```
/drover:reset-state
```

Delete tickets too:

```bash
rm -rf .beads/drover.db
/drover:setup  # reinitialize the board
```

### Too many notifications

Enable quiet mode or quiet hours:

```bash
# Edit your global config:
code ~/.claude/drover-global-config.json
```

Set `notify.quiet_mode` to `true`, or fill in `quiet_hours`.

### I want to stop Drover entirely

Set `enabled: false` in `.claude/drover-config.json`. The umbrella monitor will skip the project on its next poll.

To uninstall the plugin:

```bash
claude plugin uninstall drover
```

---

## Glossary

| Term | Meaning |
|---|---|
| **Agent** | A Claude instance with a specific role (triage, implementer). Spawned on demand, not persistent. |
| **Beads** | The kanban CLI (`bd`) Drover uses for ticket storage. Each ticket is a row in a SQLite-backed DB. |
| **Fingerprint** | A hash of an error's signature (file, line, message shape) so duplicates collapse into one ticket. |
| **Lane** | A ticket's state — `errors`, `ready`, `implementing`, `awaiting-review`, `done`. |
| **Monitor** | A long-running umbrella process that polls log sources every 30s. Auto-armed by the plugin. |
| **Skill** | A Markdown file describing a procedure Claude follows. Invoked with `/drover:<name>`. |
| **Trust level** | How aggressively Drover should act. `low` (local dev) → wait for multiple occurrences. `high` (prod) → act on the first. |
| **Worktree** | An isolated git working directory on a separate branch. Drover creates one per fix attempt so your main checkout stays clean. |

---

## Next steps

- Read the per-skill docs in `drover/skills/<name>/SKILL.md` to understand each step in depth.
- Look at the agent prompts in `drover/agents/` to see exactly what Drover asks Claude to do at each stage.
- If you want to add log sources, quality checks, or notification channels, the skills and agents are plain Markdown — fork and edit.

Questions, rough edges, or ideas? File a card on the sprint board or ping Chris.
