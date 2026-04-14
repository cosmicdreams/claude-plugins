# monitors/

Registers `umbrella-ideas.sh` with Claude Code's plugin monitor. Every stdout line emitted by the umbrella script wakes the orchestrator skill. No polling from the agent side.

## Signal catalog

Canonical list of signals. Every line is space-delimited; the first token is the prefix.

| Prefix | Payload | Emitter | Consumer |
|---|---|---|---|
| `Raw/Inbox/<domain>/batch_complete` | `<domain> <count> <batch_id>` | `rss-ingest.sh` | orchestrator → ingest agent |
| `wiki/concept-density-threshold` | `<concept> <sources_count>` | ingest agent (post-write) | orchestrator → refinery |
| `wiki/bridge-threshold-crossed` | `<concept> <domain_count>` | refinery (post-write) | orchestrator → refinery (bridge mode) |
| `wiki/trust-decay` | `<page> <new_confidence>` | `decay-cron.sh` | orchestrator (logs only) |
| `user/manual-ingest` | `<path> <domain>` | webhook listener / CLI helper | orchestrator → ingest agent |
| `Raw/Inbox/<domain>/error` | `<domain> <error_msg>` | `rss-ingest.sh` | orchestrator (logs + alert) |
| `heartbeat` | `<ISO8601 timestamp>` | `umbrella-ideas.sh` | orchestrator (no-op, liveness check) |

## Backpressure

- Lock file: `~/.claude/ideas-funnel.lock` (5-minute TTL)
- Backlog: `~/.claude/ideas-funnel.backlog.jsonl` (FIFO)
- Events log: `~/.claude/ideas-funnel.events.jsonl`

## Adding a new signal

1. Update this table.
2. Emit the line from a script or agent.
3. Handle the prefix in `agents/orchestrator.md` — unhandled prefixes are logged to `~/.claude/ideas-funnel.unknown-signals.log` and otherwise ignored (safe default).
