---
name: transcript
description: Retrieves and summarizes a sprint agent's JSONL session transcript, showing tool calls, errors, messages, and retry patterns. Diagnostic tool — use when asked to "read the transcript for slice-1", "what did agent X do", "show me the agent log", "analyze what happened during task 25", or "retrieve agent session". Accepts --teammate, --task, --focus, and --session arguments. Do not use for reading kanban cards, analysis reports, or non-JSONL files — use Read tool directly for those.
allowed-tools: Bash, Read, Glob, Grep
---

# Read Agent Transcript

Retrieve and summarize a sprint agent's JSONL session transcript to support process observation and retrospective analysis.

## How Agent Transcripts Are Stored

Each agent spawned by team-lead gets its own JSONL file:

```
~/.claude/projects/<project-slug>/
  <session-id>.jsonl              ← team-lead's session
  <session-id>/
    subagents/
      agent-<agentId>.jsonl       ← one file per spawned agent
```

Agent JSONL files do NOT store the agent's name directly. Identity is inferred from:
- `SendMessage` tool calls (recipient and summary reveal role)
- Task assignments in message content
- Timing correlated with kanban card narrative timestamps

## Arguments

| Argument | Required | Description |
|---|---|---|
| `--teammate` | yes | Agent name to find (e.g. `implementer-1`, `reviewer`) |
| `--task` | no | Task ID to scope the time window (e.g. `25`) |
| `--focus` | no | `errors`, `tools`, `messages`, `all` (default: `all`) |
| `--session` | no | Session ID prefix if known; otherwise auto-discover |

## Instructions

### Step 1: Locate the Project Slug

Find the correct project directory under `~/.claude/projects/`:

```bash
ls ~/.claude/projects/ | grep -i "SAME-PAGE-PREVIEW"
```

The slug is the directory name with path separators replaced by hyphens. For this project it is `-Users-Chris-Weber-OpenSource-SAME-PAGE-PREVIEW`.

### Step 2: Find the Active Session

List JSONL files in the project directory, sorted by modification time to find the most recent sprint session:

```bash
ls -lt ~/.claude/projects/<project-slug>/*.jsonl | head -5
```

If `--session` was provided, match on the session ID prefix. Otherwise use the most recently modified file that has a corresponding subagents directory:

```bash
ls ~/.claude/projects/<project-slug>/
# Look for entries that are BOTH a .jsonl file AND a directory (directory = has subagents)
```

### Step 3: Discover the Agent's File

Each agent's transcript is in `<session-id>/subagents/agent-<agentId>.jsonl`. Use the bundled script to identify which file belongs to `--teammate`:

```bash
python3 scripts/find_agent_file.py \
    --teammate implementer-1 \
    --session-dir ~/.claude/projects/<project-slug>/<session-id>/subagents/
```

The script scans SendMessage call summaries across all subagent files and prints the best-matching file path to stdout. Exit code 1 means no match was found.

If `--teammate` is `team-lead`, read the top-level session JSONL directly instead of the subagents directory.

### Step 4: Scope to Task Window (if --task provided)

Read the bead notes to get the task timeframe:

```bash
bd show <bead_id> --json | jq '.notes'
```

Narrow the JSONL scan to entries whose `timestamp` falls within the task window. If timestamps are ambiguous (same-day, no time in narrative), use the full file.

### Step 5: Extract and Summarize

Run the bundled summarize script against the identified agent file:

```bash
python3 scripts/summarize_transcript.py \
    --file <path-to-agent-file> \
    --focus all
```

Optional time-window scoping (ISO8601 timestamps from Step 4):

```bash
python3 scripts/summarize_transcript.py \
    --file <path-to-agent-file> \
    --focus errors \
    --after 2026-02-20T14:00:00Z \
    --before 2026-02-20T15:30:00Z
```

### Step 6: Format and Return Summary

Present the output as a structured markdown summary:

```
## Transcript Summary — <teammate> / Task #<task>

Session file: agent-<agentId>.jsonl
Time window: <start> → <end> (<duration>)

### Tool Calls (<total> total)
- <Tool>: <count> (<errors> errors)
...

### Errors (<count>)
- <description>
...

### Messages Sent
- → <recipient>: <summary>
...

### Retry Patterns
- <count>x: <command> (possible friction point)

### Process Notes
<Any observations worth flagging — stale flags, scope drift, missing handoff>
```

If `--focus errors` is specified, omit tool counts and messages. If `--focus messages`, show only the messages section. If `--focus tools`, show tool counts and retries only.

## Examples

**Example 1**: Team-lead pings after task completion
- Ping received: `{task_id: 25, owner: "implementer-1", bead_id: "sprint-a1b2"}`
- Run: `/retro:transcript --teammate implementer-1 --task 25 --focus errors`
- Result: Structured summary of implementer-1's session scoped to task 25, errors highlighted

**Example 2**: Full review after reviewer completes
- Run: `/retro:transcript --teammate reviewer --focus all`
- Result: Complete tool call breakdown, all messages sent to team-lead, any retry loops

**Example 3**: Targeted message review after communication confusion
- Run: `/retro:transcript --teammate issue-analyzer-2 --focus messages`
- Result: Only the SendMessage calls — who they messaged and what, useful for routing artifact detection

## Troubleshooting

**No subagents directory found**
- Cause: Session has no spawned agents yet, or wrong session ID
- Solution: Confirm the session directory exists: `ls ~/.claude/projects/<slug>/`

**Cannot identify which file belongs to --teammate**
- Cause: Agent file does not contain clear role markers in SendMessage summaries
- Solution: Scan all files for the task ID mentioned in message content, or correlate by timestamp with kanban card narrative

**JSONL parse errors**
- Cause: Incomplete lines from in-progress sessions written mid-turn
- Solution: Wrap all `json.loads()` in try/except — skip malformed lines silently

**Timestamps don't narrow the window**
- Cause: Kanban narrative has date only (no time), multiple tasks same day
- Solution: Use the full agent file rather than a partial window; note the ambiguity in the summary
