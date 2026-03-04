#!/usr/bin/env python3
"""
Summarize a sprint agent's JSONL transcript.

Usage:
    python3 summarize_transcript.py --file agent-abc123.jsonl [--focus all|errors|tools|messages] [--after ISO8601] [--before ISO8601]

Output:
    Structured markdown summary of tool calls, errors, retries, and messages sent.
"""

import argparse
import json
import os
import sys
from collections import Counter, defaultdict


def parse_args():
    parser = argparse.ArgumentParser(description="Summarize a sprint agent JSONL transcript.")
    parser.add_argument("--file", required=True, help="Path to agent JSONL file")
    parser.add_argument(
        "--focus",
        choices=["all", "errors", "tools", "messages"],
        default="all",
        help="What to include in the summary (default: all)",
    )
    parser.add_argument("--after", default=None, help="Only include entries after this ISO8601 timestamp")
    parser.add_argument("--before", default=None, help="Only include entries before this ISO8601 timestamp")
    return parser.parse_args()


def in_window(timestamp, after, before):
    if not timestamp:
        return True
    if after and timestamp < after:
        return False
    if before and timestamp > before:
        return False
    return True


def summarize(fpath, focus, after, before):
    tool_counts = Counter()
    tool_errors = []
    send_messages = []
    bash_commands = []
    timestamps = []

    try:
        with open(fpath) as f:
            for line in f:
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue

                ts = e.get("timestamp", "")
                if not in_window(ts, after, before):
                    continue
                if ts:
                    timestamps.append(ts)

                # Tool use blocks inside assistant messages
                msg = e.get("message", {})
                if isinstance(msg, dict):
                    for c in msg.get("content", []):
                        if not isinstance(c, dict):
                            continue
                        if c.get("type") != "tool_use":
                            continue

                        name = c.get("name", "unknown")
                        tool_counts[name] += 1

                        if name == "Bash":
                            cmd = c.get("input", {}).get("command", "").strip()
                            bash_commands.append(cmd)

                        if name == "SendMessage":
                            inp = c.get("input", {})
                            send_messages.append({
                                "to": inp.get("recipient", "?"),
                                "summary": inp.get("summary", "?"),
                                "type": inp.get("type", "message"),
                            })

                # Tool errors from result entries
                result = e.get("toolUseResult", {})
                if isinstance(result, dict) and result.get("isError"):
                    content = result.get("content", "")
                    if isinstance(content, list):
                        text = " ".join(
                            c.get("text", "") for c in content if isinstance(c, dict)
                        )
                    else:
                        text = str(content)
                    tool_errors.append({
                        "ts": ts,
                        "error": text[:200],
                    })

    except OSError as ex:
        print(f"Cannot read file: {ex}", file=sys.stderr)
        sys.exit(1)

    # Detect retry patterns: consecutive identical bash commands
    retries = defaultdict(int)
    prev = None
    for cmd in bash_commands:
        key = cmd[:80]
        if key == prev and key:
            retries[key] += 1
        prev = key

    # Build output
    fname = os.path.basename(fpath)
    start = timestamps[0] if timestamps else "unknown"
    end = timestamps[-1] if timestamps else "unknown"
    total_tools = sum(tool_counts.values())

    lines = []
    lines.append(f"## Transcript Summary — {fname}")
    lines.append(f"")
    lines.append(f"File: `{fpath}`")
    lines.append(f"Window: {start} → {end}")
    lines.append(f"")

    if focus in ("all", "tools"):
        lines.append(f"### Tool Calls ({total_tools} total)")
        for tool, count in tool_counts.most_common():
            lines.append(f"- {tool}: {count}")
        lines.append("")

    if focus in ("all", "errors"):
        lines.append(f"### Errors ({len(tool_errors)})")
        if tool_errors:
            for err in tool_errors:
                lines.append(f"- [{err['ts'][:19]}] {err['error']}")
        else:
            lines.append("- None")
        lines.append("")

    if focus in ("all", "messages"):
        lines.append(f"### Messages Sent ({len(send_messages)})")
        if send_messages:
            for m in send_messages:
                lines.append(f"- → {m['to']} ({m['type']}): {m['summary']}")
        else:
            lines.append("- None")
        lines.append("")

    if focus in ("all", "tools") and retries:
        lines.append(f"### Retry Patterns (possible friction)")
        for cmd, count in sorted(retries.items(), key=lambda x: -x[1]):
            lines.append(f"- {count + 1}x: `{cmd}`")
        lines.append("")

    print("\n".join(lines))


def main():
    args = parse_args()
    fpath = os.path.expanduser(args.file)
    if not os.path.isfile(fpath):
        print(f"File not found: {fpath}", file=sys.stderr)
        sys.exit(1)
    summarize(fpath, args.focus, args.after, args.before)


if __name__ == "__main__":
    main()
