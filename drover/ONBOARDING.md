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
| `websockets` (Python) | Streams Acquia logs in real-time | `python3 -c "import websockets"` (install: `pip install websockets`) |

You also need:

- **A Drupal project in DDEV**, with the site running (`ddev start`). It can be new or existing — Drover doesn't modify your site's code at setup time.
- **An Anthropic API key** configured for Claude Code. Running Drover uses tokens; expect a few cents per triage cycle during normal operation, more when it attempts fixes.
- **A git repo** for that project, with a clean working tree. Drover will create worktrees off your main branch.

Optional (you can skip these and add them later):

- An **Acquia Cloud API key and secret** — if you want Drover to watch staging or production logs. Generate them at https://cloud.acquia.com/a/profile/tokens. Setup will ask for these and store them locally.
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
- **Acquia staging/production** — skip these if you don't have Acquia. Otherwise enter your API key and secret; Drover lists your applications and environments automatically.
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

This time the triage summary should show `New errors: 1` or `Augmented: 1`. Open the dashboard — a new ticket appears in the error table and the header chip reads **1 need documentation** in orange.

---

## Step 6 — Document the error

This is the action Drover is built around. Click the `Document` button on the new row (orange, rightmost cell), or click the row and then `Document this error` inside the modal.

The modal opens with three things stacked top-to-bottom:

1. **"Have we seen this before?"** — Drover searches every registered project's past documented solutions for similar errors (by exception class + fingerprint + message overlap) and surfaces the top matches with a confidence score. On your first run the result will be empty — you haven't documented anything yet. Later, this is where recurrence memory earns its keep.
2. **The capture form** — two free-text fields (root cause, fix summary) plus an optional commit SHA.
3. **Agent notes (optional)** — deliberately muted. If the optional implementer-agent ran, its hypothesis / proposed-fix show up here as a reference, not as the authoritative record. You write the authoritative record.

Fill in the form. `Save documentation` closes the ticket.

In the pulse feed at the top of the page, you'll see: `error-documented · <project> · <ticket-id> · Documented · <root cause>`.

If you decide the error is known noise (not a real bug, ignore forever), the secondary `Mark as known noise` button in the same modal moves the ticket to `lane-noise` with your reason recorded.

---

## Step 7 — Prove the recall loop

Trigger a second, similar error — or if you don't want to, just open another existing ticket whose title resembles the one you just documented. Click `Document`. This time, the **"Have we seen this before?"** section should surface your previous documentation with a match percentage. Click `Apply this` — the form below prefills with the past root cause + fix summary. Adjust if needed, save.

That's the whole loop. The value compounds: every documented error makes the next recurrence across any client site a one-click resolution.

---

## Step 8 — Grouping across projects

When two projects produce what's clearly the same bug — different fingerprints because their URLs or line numbers differ, but the underlying cause is identical — mark them as one group:

1. Check the checkbox on the left of each row.
2. When selection count reaches 2+, a bar slides in above the table: `N selected · Group selected · Clear`.
3. Click `Group selected`. The two rows fold into one parent row with the members indented (click-to-expand) and the group metadata surfaces in a separate group modal.

Groups persist across dashboard restarts (stored in `~/.claude/plugins/data/drover/drover-groups.json`) and are also written into each project's bd database as a `group-<id>` label — so `bd list -l group-abc` in either project returns the members, and any bd-facing tool sees the grouping natively.

---

## Step 9 — Ongoing use

Once you trust the setup, day-to-day use is:

- **Leave it running.** The umbrella monitor polls every 30s whenever you have a Claude Code session open in the project.
- **Glance at the dashboard** first thing in the morning. The header chip tells you how many errors need documentation. The pulse feed tells you what drover saw overnight.
- **Document as you resolve.** Every error you fix gets a quick two-field capture. That's the work.
- **Check past solutions** when a new error looks familiar — `/drover:recall <keyword>` from the CLI or just open the ticket and read the "Have we seen this before?" section.
- **Mark known noise** aggressively. False positives shouldn't clog your queue.
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
| **Agent** | A Claude instance with a specific role (triage, optionally implementer). Spawned on demand, not persistent. |
| **Beads** | The kanban CLI (`bd`) Drover uses for ticket storage. Each ticket is a row in a SQLite-backed DB. |
| **Document** | The primary operator action — capture the root cause + fix summary (+ optional commit SHA) on a ticket. Closes the ticket and feeds the Recall engine. |
| **Fingerprint** | A hash of an error's signature (file, line, message shape) so duplicates collapse into one ticket. |
| **Group** | A user-curated set of tickets (across one or more projects) that represent the same bug. Stored as a `group-<id>` label on each member's bd card + a JSON manifest. |
| **Lane** | A ticket's state — `triage`, `ready`, `done`, `noise`, `closed`. Optional lanes (`implementing`, `awaiting-review`) exist for the opt-in implementer-agent workflow. |
| **Monitor** | A long-running umbrella process that polls log sources every 30s. Auto-armed by the plugin. |
| **Pulse** | The live event feed in the dashboard header. Every meaningful transition drover makes (new fingerprint, threshold crossing, document, group, watcher lifecycle) emits a pulse event. |
| **Recall** | The "have we seen this before?" engine. When you open a ticket to document it, drover searches past documented solutions across all projects and surfaces matches. |
| **Skill** | A Markdown file describing a procedure Claude follows. Invoked with `/drover:<name>`. |
| **Trust level** | How aggressively Drover should act. `low` (local dev) → wait for multiple occurrences. `high` (prod) → act on the first. |

---

## Next steps

- Read the per-skill docs in `drover/skills/<name>/SKILL.md` to understand each step in depth.
- Look at the agent prompts in `drover/agents/` to see exactly what Drover asks Claude to do at each stage.
- If you want to add log sources, quality checks, or notification channels, the skills and agents are plain Markdown — fork and edit.

Questions, rough edges, or ideas? File a card on the sprint board or ping Chris.
