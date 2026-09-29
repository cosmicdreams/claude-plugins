"""Append-only local process event log."""
import fcntl
import json
import os
from datetime import datetime, timezone
from pathlib import Path


def ledger_path():
    override = os.environ.get("PROCESS_LAB_LEDGER")
    if override:
        return Path(override).expanduser()
    return Path(os.environ.get("CLAUDE_CONFIG_DIR", "~/.claude")).expanduser() / "process-lab" / "ledger.jsonl"


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def append(project, ticket, branch, event, **fields):
    entry = {"ts": timestamp(), "project": project, "ticket": ticket, "branch": branch, "event": event, **fields}
    path = ledger_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        stream.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")
        stream.flush()
        fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
    return entry


def read():
    path = ledger_path()
    if not path.exists():
        return []
    entries = []
    with path.open("r", encoding="utf-8") as stream:
        for line in stream:
            try:
                value = json.loads(line)
                if isinstance(value, dict):
                    entries.append(value)
            except json.JSONDecodeError:
                continue
    return entries


def log_error(exc):
    path = ledger_path().parent / "errors.log"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as stream:
            stream.write(timestamp() + " " + type(exc).__name__ + ": " + str(exc).replace("\n", " ")[:500] + "\n")
    except OSError:
        pass
