#!/usr/bin/env python3
"""
Find the subagent JSONL file for a named sprint agent.

Usage:
    python3 find_agent_file.py --teammate implementer-1 --session-dir ~/.claude/projects/<slug>/<session-id>/subagents/

Output:
    Prints the matching file path to stdout, or exits with code 1 if not found.
"""

import argparse
import glob
import json
import os
import sys


def find_agent_file(subagent_dir, teammate):
    """Scan subagent JSONL files and return the one belonging to the named teammate."""
    files = sorted(glob.glob(os.path.join(subagent_dir, "*.jsonl")))
    if not files:
        print(f"No subagent files found in: {subagent_dir}", file=sys.stderr)
        sys.exit(1)

    teammate_lower = teammate.lower()
    candidates = []

    for fpath in files:
        send_summaries = []
        recipient_names = set()
        timestamps = []

        try:
            with open(fpath) as f:
                for line in f:
                    try:
                        e = json.loads(line)
                        if e.get("timestamp"):
                            timestamps.append(e["timestamp"])
                        msg = e.get("message", {})
                        if not isinstance(msg, dict):
                            continue
                        for c in msg.get("content", []):
                            if not isinstance(c, dict):
                                continue
                            if c.get("type") == "tool_use" and c.get("name") == "SendMessage":
                                inp = c.get("input", {})
                                summary = inp.get("summary", "").lower()
                                recipient = inp.get("recipient", "").lower()
                                send_summaries.append(summary)
                                recipient_names.add(recipient)
                    except (json.JSONDecodeError, KeyError):
                        continue
        except OSError:
            continue

        combined_text = " ".join(send_summaries)

        # Match by role keywords in message summaries
        role_base = teammate_lower.split("-")[0]  # e.g. "implementer" from "implementer-1"
        instance = teammate_lower  # e.g. "implementer-1"

        score = 0
        if instance in combined_text:
            score += 2
        if role_base in combined_text:
            score += 1
        # If the agent messages team-lead, that's a strong signal it's a worker agent
        if "team-lead" in recipient_names and score > 0:
            score += 1

        if score > 0:
            start = timestamps[0] if timestamps else ""
            candidates.append((score, start, fpath))

    if not candidates:
        print(f"Could not identify a subagent file for teammate: {teammate}", file=sys.stderr)
        print(f"Searched {len(files)} files in: {subagent_dir}", file=sys.stderr)
        sys.exit(1)

    # Return highest-scoring match (by score, then by start time descending for most recent)
    candidates.sort(key=lambda x: (-x[0], x[1]))
    print(candidates[0][2])


def main():
    parser = argparse.ArgumentParser(description="Find subagent JSONL file for a named sprint agent.")
    parser.add_argument("--teammate", required=True, help="Agent name, e.g. implementer-1")
    parser.add_argument("--session-dir", required=True, help="Path to subagents/ directory")
    args = parser.parse_args()

    session_dir = os.path.expanduser(args.session_dir)
    if not os.path.isdir(session_dir):
        print(f"Directory not found: {session_dir}", file=sys.stderr)
        sys.exit(1)

    find_agent_file(session_dir, args.teammate)


if __name__ == "__main__":
    main()
