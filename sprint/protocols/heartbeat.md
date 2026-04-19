# Heartbeat Protocol

Sidecars give team-lead and observers a live signal that agents are still making progress.
Without them, a hung agent is invisible until it misses two full team-lead turns.

---

## Sidecar Location

```
~/.claude/plugins/data/sprint/heartbeats/<card-id>.json
```

This path is project-local and fully disposable. It does **not** touch the Beads schema,
card frontmatter, or any shared database.

## JSON Schema

```json
{
  "card_id": "sprint-42",
  "agent":   "slice-1",
  "started_at":          "2026-04-19T14:00:00Z",
  "started_epoch":       1713535200,
  "last_touch":          "2026-04-19T14:08:00Z",
  "last_touch_epoch":    1713535680,
  "phase":               "implement"
}
```

Fields:

| Field | Type | Description |
|-------|------|-------------|
| `card_id` | string | Beads card ID (`bd show <id>`) |
| `agent` | string | `BD_ACTOR` / agent name |
| `started_at` | ISO-8601 UTC | When the agent claimed the card |
| `started_epoch` | integer (Unix) | Machine-comparable timestamp |
| `last_touch` | ISO-8601 UTC | Most recent heartbeat |
| `last_touch_epoch` | integer (Unix) | Machine-comparable timestamp |
| `phase` | string | Current work phase (free-form: `analyze`, `implement`, `test`, `validate`) |

---

## Script Reference

`sprint/scripts/heartbeat.sh` — ships with the sprint plugin.

```bash
SCRIPT="~/.claude/plugins/cache/local/sprint/<ver>/scripts/heartbeat.sh"

# Agent claims a card and starts working:
$SCRIPT start sprint-42 slice-1 analyze

# Agent crosses a major milestone (tool use, phase change, commit):
$SCRIPT touch sprint-42 implement

# Agent finishes — sidecar cleaned up:
$SCRIPT stop sprint-42

# Team-lead checks for stalled agents (default 600s threshold):
$SCRIPT stalled
$SCRIPT stalled --max-age-sec 300
```

Override the sidecar directory for testing:
```bash
SPRINT_HEARTBEAT_DIR=/tmp/hb-test $SCRIPT start sprint-1 test-agent
```

---

## Agent Convention (Voluntary — Initial Rollout)

During the initial rollout heartbeat calls are **voluntary** but strongly encouraged.
Agents that adopt the protocol surface problems faster; those that skip it are simply invisible.

### When to call each subcommand

| Event | Call |
|-------|------|
| Card claimed (`bd update --claim`) | `start <card-id> <agent> analyze` |
| Phase transition (analyze → implement, etc.) | `touch <card-id> <new-phase>` |
| Every significant tool use (Read, Edit, Bash) | `touch <card-id>` |
| Card completed or escalated | `stop <card-id>` |

A reasonable rule of thumb: **if more than ~5 minutes have passed without a touch, add one.**

### Sample agent prologue snippet

```bash
HEARTBEAT="~/.claude/plugins/cache/local/sprint/<ver>/scripts/heartbeat.sh"
$HEARTBEAT start "${CARD_ID}" "${BD_ACTOR}" analyze
# ... work ...
$HEARTBEAT touch "${CARD_ID}" implement
# ... work ...
$HEARTBEAT stop "${CARD_ID}"
```

---

## Team-Lead Convention

Add this check to the **every-turn checklist** (see `sprint:run`, Step 3 / TEAM-LEAD LOOP):

```bash
# Check for stalled agents (default 600s / 10 min threshold)
~/.claude/plugins/cache/local/sprint/<ver>/scripts/heartbeat.sh stalled
```

**Output interpretation:**

| Output | Action |
|--------|--------|
| `no stalled agents` | No action needed |
| `STALLED card=… agent=…` | Cross-check with `bd list -s in_progress --json`; if agent is unresponsive after 2 turns → reassign |

**Do NOT auto-kill stalled agents.** This protocol surfaces them only. Kill policy is a future card.

---

## Retro Plugin

Retro plugin does not have its own heartbeat infrastructure. It can reuse `heartbeat.sh` via
the sprint plugin's installed path:

```bash
~/.claude/plugins/cache/local/sprint/<ver>/scripts/heartbeat.sh start retro-42 retro-agent review
```

Full retro integration is a future card (`retro: import heartbeat from sprint`).
