"""Append-only local process event log."""
import fcntl
import json
import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def ledger_path():
    override = os.environ.get("PROCESS_LAB_LEDGER")
    if override:
        return Path(override).expanduser()
    return Path(os.environ.get("CLAUDE_CONFIG_DIR", "~/.claude")).expanduser() / "process-lab" / "ledger.jsonl"


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _read_stream(stream):
    stream.seek(0)
    entries = []
    for line in stream:
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                entries.append(value)
        except json.JSONDecodeError:
            continue
    return entries


@contextmanager
def locked():
    path = ledger_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+", encoding="utf-8") as stream:
        deadline = time.monotonic() + 0.2
        while True:
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError as exc:
                if time.monotonic() >= deadline:
                    log_error(exc)
                    yield None
                    return
                time.sleep(min(0.01, max(0, deadline - time.monotonic())))
        try:
            yield stream
        finally:
            fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def write(stream, project, ticket, branch, event, **fields):
    entry = {"ts": timestamp(), "project": project, "ticket": ticket, "branch": branch, "event": event, **fields}
    stream.seek(0, os.SEEK_END)
    stream.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")
    stream.flush()
    return entry


def append(project, ticket, branch, event, **fields):
    with locked() as stream:
        return write(stream, project, ticket, branch, event, **fields) if stream else None


def read():
    path = ledger_path()
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as stream:
        return _read_stream(stream)


def read_locked(stream):
    return _read_stream(stream)

def log_error(exc):
    path = ledger_path().parent / "errors.log"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as stream:
            stream.write(timestamp() + " " + type(exc).__name__ + ": " + str(exc).replace("\n", " ")[:500] + "\n")
    except OSError:
        pass
