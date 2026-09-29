#!/usr/bin/env python3
"""Score a completed design-lab run and write scorecard.json plus a presentable report.html.

  score_run.py <run-dir> [--compare <other-run-dir> ...] [--transcripts <dir>]
               [--since <iso>] [--until <iso>] [--site-label <label>] --out <dir>

<run-dir> is the run's workspace (the folder holding project.json, usually `.design-lab`).
Every section is scored on its own from whatever evidence the run left behind. A section
with no evidence says "not measured" and why; it never guesses. The first scoring of a run
records the benchmark's end in the run's phase log; apart from that, and the run's own
benchmark/ folder, scoring never writes into the run directory, so it can be re-run whenever
the scorer improves.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import statistics
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PLUGIN_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from artifact_contracts import now, write_json  # noqa: E402
import library_counts  # noqa: E402

SCORECARD_VERSION = 1
BENCHMARK_DIR = "benchmark"
COMPLETION_TEMPLATE = PLUGIN_DIR / "references" / "completion-message.md"
BREAKPOINTS = ("desktop", "tablet", "mobile")
BLINDED_CRITERIA = (
    ("looksLikeSite", "Looks like the site"),
    ("finishedLibrary", "Reads as a finished library"),
    ("findability", "Findability"),
    ("documentation", "Documentation usefulness"),
)
SESSION_GAP = dt.timedelta(minutes=15)


# ---------------------------------------------------------------------------- helpers

def read_json(path: Path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def read_jsonl(path: Path) -> list[dict]:
    entries = []
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    value = json.loads(line)
                except ValueError:
                    continue
                if isinstance(value, dict):
                    entries.append(value)
    except OSError:
        pass
    return entries


def parse_time(value) -> dt.datetime | None:
    """ISO time to an aware datetime. Naive values (the runner log) are the local clock."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.astimezone()


def iso(value: dt.datetime | None) -> str | None:
    return value.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat() if value else None


def plugin_version() -> str:
    manifest = read_json(PLUGIN_DIR / ".claude-plugin" / "plugin.json") or {}
    return manifest.get("version") or "unknown"


def not_measured(reason: str, how: str | None = None, **extra) -> dict:
    return {"status": "not-measured", "reason": reason, **({"howToMeasure": how} if how else {}),
            **extra}


def median(values):
    return round(statistics.median(values), 4) if values else None


def quantile(values, q):
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return round(ordered[index], 4)


# ---------------------------------------------------------------------------- identity

def score_identity(run_dir: Path, project: dict | None, site_label: str | None) -> dict:
    if not project:
        return not_measured("project.json is missing, so nothing identifies this run",
                            "start runs with workflow.py init")
    run = project.get("run") if isinstance(project.get("run"), dict) else {}
    capture = read_json(run_dir / "capture-evidence.json") or {}
    canonical = capture.get("canonicalBaseUrl")
    host = re.sub(r"^https?://", "", canonical or "").strip("/") or None
    target = project.get("target") or {}
    repository = project.get("repository") or {}
    claude = run.get("claude") or {}
    plugin = run.get("plugin") or {}
    build_state = read_json(run_dir / "figma" / "state.json") or {}
    label_source = ("argument" if site_label else "manifest" if run.get("siteLabel")
                    else "public address" if host else "repository folder")
    fields = {
        "siteLabel": site_label or run.get("siteLabel") or host or Path(repository.get("root") or run_dir).name,
        "siteLabelSource": label_source,
        "publicAddress": canonical,
        "siteUrl": run.get("siteUrl") or build_state.get("siteUrl"),
        "rendererRuntime": build_state.get("runtime"),
        "builtToStandard": build_state.get("standardVersion"),
        "operator": run.get("operator"),
        "startedAt": run.get("startedAt") or project.get("createdAt"),
        "pluginVersion": plugin.get("version") or project.get("pluginVersion"),
        "pluginCommit": plugin.get("commit"),
        "standardVersion": project.get("standardVersion"),
        "repositoryCommit": repository.get("commit"),
        "repositoryDirty": repository.get("dirty"),
        "figmaFileKey": target.get("figmaFileKey"),
        "figmaUrl": target.get("figmaUrl"),
        "claudeConfigDir": claude.get("configDir"),
        "model": claude.get("model"),
        "strategies": {key: value for key, value in (project.get("decisions") or {}).items()
                       if key in ("componentSource", "tokenSource", "usageSource")},
    }
    missing = [key for key in ("siteUrl", "operator", "pluginCommit", "repositoryCommit",
                               "figmaFileKey", "claudeConfigDir", "model")
               if not fields.get(key)]
    status = "measured" if run and not missing else "partial"
    summary = ("Run identity recorded at start." if run else
               "This run predates recorded run identity; details come from the manifest.")
    return {"status": status, "summary": summary, "fields": fields, "missing": missing,
            "recordedAtStart": bool(run) and not run.get("recordedLate")}


# ---------------------------------------------------------------------------- cost and effort

RUNNER_LINE = re.compile(r"^(\S+)\s+(serving|recorded|skipped|error:?)\s*(.*)$")


def runner_steps(log: Path) -> dict | None:
    if not log.is_file():
        return None
    events = []
    for line in log.read_text(encoding="utf-8", errors="replace").splitlines():
        match = RUNNER_LINE.match(line)
        when = parse_time(match.group(1)) if match else None
        if when:
            events.append((when, match.group(2).rstrip(":"), match.group(3)))
    if not events:
        return None
    sessions, current = [], [events[0]]
    for event in events[1:]:
        if event[0] - current[-1][0] > SESSION_GAP:
            sessions.append(current)
            current = []
        current.append(event)
    sessions.append(current)
    by_kind: dict[str, float] = defaultdict(float)
    count_by_kind: Counter = Counter()
    durations = []
    pending: dict[str, dt.datetime] = {}
    for when, verb, rest in events:
        name = re.sub(r"\s*\(.*$", "", rest).strip()
        kind = name.split(":", 1)[0] or "other"
        if verb == "serving":
            pending[name] = when
        elif verb == "recorded" and name in pending:
            seconds = (when - pending.pop(name)).total_seconds()
            by_kind[kind] += seconds
            count_by_kind[kind] += 1
            durations.append(seconds)
    session_rows = [{"start": iso(s[0][0]), "end": iso(s[-1][0]),
                     "seconds": int((s[-1][0] - s[0][0]).total_seconds()),
                     "steps": sum(1 for e in s if e[1] == "recorded")} for s in sessions]
    return {
        "clock": "local time of the machine that ran the build",
        "sessions": session_rows,
        "activeSeconds": sum(row["seconds"] for row in session_rows),
        "steps": sum(count_by_kind.values()),
        "errors": sum(1 for e in events if e[1] == "error"),
        "skipped": sum(1 for e in events if e[1] == "skipped"),
        "medianStepSeconds": median(durations),
        "secondsByKind": {kind: round(value, 1) for kind, value in
                          sorted(by_kind.items(), key=lambda item: -item[1])},
        "stepsByKind": dict(count_by_kind.most_common()),
    }


def phase_timings(run_dir: Path, project: dict | None) -> dict | None:
    if not project:
        return None
    log = read_jsonl(run_dir / "phase-log.jsonl")
    start = parse_time((project.get("run") or {}).get("startedAt") or project.get("createdAt"))
    if log:
        first, last = {}, {}
        for entry in log:
            when, phase = parse_time(entry.get("at")), entry.get("phase")
            if not when or not phase or phase == "init":
                continue
            first.setdefault(phase, when)
            if entry.get("status") in ("complete", "approved", "waived"):
                last[phase] = when
        # A phase starts when the previous phase ended (or when it was first touched).
        ordered = sorted(last.items(), key=lambda item: item[1])
        rows, previous = [], start
        for phase, end in ordered:
            begin = min(first.get(phase, end), previous or end)
            rows.append({"phase": phase, "start": iso(begin), "end": iso(end),
                         "seconds": int((end - begin).total_seconds())})
            previous = end
        return {"source": "phase log", "exact": True, "phases": rows,
                "totalSeconds": int((ordered[-1][1] - start).total_seconds()) if ordered and start else None}
    checkpoints = []
    for phase, value in (project.get("phases") or {}).items():
        when = parse_time((value or {}).get("updatedAt"))
        if when:
            checkpoints.append({"phase": phase, "status": value.get("status"), "at": iso(when)})
    checkpoints.sort(key=lambda row: row["at"])
    if not checkpoints:
        return None
    last = parse_time(checkpoints[-1]["at"])
    return {"source": "manifest checkpoints", "exact": False, "checkpoints": checkpoints,
            "start": iso(start),
            "spanSeconds": int((last - start).total_seconds()) if start and last else None,
            "note": "Each phase keeps only its last update time, so these bound the run rather "
                    "than time each phase. Runs started with 0.15 or later log every phase change."}


MODEL_FAMILIES = {"opus": "Opus", "sonnet": "Sonnet", "haiku": "Haiku", "fable": "Fable"}


def friendly_model(model_id: str) -> str:
    """claude-opus-5-5 -> Opus 5.5; claude-haiku-4-5-20251001 -> Haiku 4.5; unknown ids stay raw."""
    match = re.fullmatch(r"claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?", model_id or "")
    if not match or match.group(1) not in MODEL_FAMILIES:
        return model_id
    version = match.group(2) + (f".{match.group(3)}" if match.group(3) else "")
    return f"{MODEL_FAMILIES[match.group(1)]} {version}"


def config_dir_of(path: Path) -> str | None:
    """The Claude configuration folder (the account) a transcript lives under: <dir>/projects/..."""
    parts = path.resolve().parts
    if "projects" in parts:
        index = len(parts) - 1 - parts[::-1].index("projects")
        return str(Path(*parts[:index]))
    return None


def session_files(main: Path) -> list[Path]:
    """A session's main transcript plus its subagent transcripts in <session-id>/subagents/."""
    files = [main]
    sub = main.with_suffix("") / "subagents"
    if sub.is_dir():
        files += sorted(sub.rglob("*.jsonl"))
    return files


def find_session(session: str, config_dirs: list[str]) -> list[Path]:
    for base in config_dirs:
        root = Path(base).expanduser() / "projects"
        if root.is_dir():
            for main in sorted(root.glob(f"*/{session}.jsonl")):
                return session_files(main)
    return []


def read_messages(files: list[Path], since: dt.datetime | None, until: dt.datetime | None,
                  unattributed: Counter | None = None) -> list[dict]:
    """One entry per assistant message (streamed repeats merged), with its time and model. The
    benchmark counts the tokens Claude spent producing the library, by Claude model, so entries are
    kept when their model id starts with `claude-`; the rest are only counted, in `unattributed`."""
    messages: dict[str, dict] = {}
    for path in files:
        for entry in read_jsonl(path):
            if entry.get("type") != "assistant":
                continue
            when = parse_time(entry.get("timestamp"))
            if (since and (not when or when < since)) or (until and (not when or when > until)):
                continue
            message = message_of(entry)
            if message.get("model") in (None, "<synthetic>"):
                continue
            if not str(message["model"]).startswith("claude-"):
                if unattributed is not None:
                    unattributed[message.get("id") or entry.get("uuid") or len(unattributed)] += 1
                continue
            key = message.get("id") or entry.get("uuid") or f"{path}:{len(messages)}"
            kept = messages.setdefault(key, {"model": message.get("model"), "usage": {}, "tools": set(),
                                             "at": when, "session": entry.get("sessionId") or path.stem})
            if when and (kept["at"] is None or when < kept["at"]):
                kept["at"] = when
            usage = message.get("usage") if isinstance(message.get("usage"), dict) else {}
            for field in ("input_tokens", "output_tokens", "cache_creation_input_tokens",
                          "cache_read_input_tokens"):
                value = usage.get(field)
                if isinstance(value, int):   # streamed lines repeat one message's usage
                    kept["usage"][field] = max(kept["usage"].get(field, 0), value)
            for block in message.get("content") or []:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    kept["tools"].add(block.get("id") or f"{key}:{len(kept['tools'])}")
    return list(messages.values())


def by_model(messages: list[dict]) -> dict:
    rows: dict[str, dict] = {}
    for item in messages:
        row = rows.setdefault(item["model"], {
            "model": item["model"], "name": friendly_model(item["model"]), "input": 0, "output": 0,
            "cacheWrite": 0, "cacheRead": 0, "total": 0, "turns": 0, "toolCalls": 0})
        u = item["usage"]
        row["input"] += u.get("input_tokens", 0)
        row["output"] += u.get("output_tokens", 0)
        row["cacheWrite"] += u.get("cache_creation_input_tokens", 0)
        row["cacheRead"] += u.get("cache_read_input_tokens", 0)
        row["turns"] += 1
        row["toolCalls"] += len(item["tools"])
    for row in rows.values():
        row["total"] = row["input"] + row["output"] + row["cacheWrite"] + row["cacheRead"]
    ordered = sorted(rows.values(), key=lambda r: -r["total"])
    totals = {k: sum(r[k] for r in ordered) for k in ("input", "output", "cacheWrite", "cacheRead", "total")}
    return {"byModel": ordered, "tokens": totals, "turns": sum(r["turns"] for r in ordered),
            "toolCalls": sum(r["toolCalls"] for r in ordered)}


def transcript_usage(files: list[Path], since: dt.datetime | None, until: dt.datetime | None,
                     split_at: dt.datetime | None = None) -> dict:
    """Tokens by model; with split_at, also library production (before) and benchmark (after)."""
    unattributed: Counter = Counter()
    messages = read_messages(files, since, until, unattributed)
    times = [m["at"] for m in messages if m["at"]]
    whole = by_model(messages)
    result = {"files": len(files), "sessions": len({m["session"] for m in messages}),
              "assistantMessages": len(messages), "toolCalls": whole["toolCalls"],
              "byModel": whole["byModel"], "tokens": whole["tokens"],
              "models": {r["name"]: r["turns"] for r in whole["byModel"]},
              "configDirs": sorted({d for d in (config_dir_of(f) for f in files) if d}),
              "window": {"since": iso(since), "until": iso(until)},
              "firstMessage": iso(min(times)) if times else None,
              "lastMessage": iso(max(times)) if times else None,
              # For developers only, never rendered: entries not attributed to a Claude model.
              "developer": {"unattributedEntries": len(unattributed)}}
    if split_at:
        before = [m for m in messages if not m["at"] or m["at"] < split_at]
        after = [m for m in messages if m["at"] and m["at"] >= split_at]
        result["production"] = {"status": "measured", **by_model(before)}
        result["benchmark"] = {"status": "measured", "since": iso(split_at), **by_model(after)}
    else:
        result["production"] = {"status": "measured", **whole}
        result["benchmark"] = not_measured(
            "the benchmark step's start was not recorded, so its tokens cannot be told apart",
            "record it with workflow.py record --phase benchmark --status running before scoring")
    return result


# ---------------------------------------------------------------------------- working time

TIME_DEFINITION = (
    "Working time is when Claude or its tools were working, read from the session transcript: every "
    "span from a person's prompt or a tool result to the end of the assistant's response counts, and "
    "the main session's spans and its subagents' spans are merged, so overlapping time counts once. "
    "The rest of the time between the transcript's first and last events is waiting, of three kinds: "
    "waiting on the person, when the assistant had finished its turn and the next event is a person's "
    "prompt, or when a tool was waiting for the person's answer (a question, or approval of a plan); "
    "waiting on usage limits, after a record reporting a rate, session, usage or spend limit, until "
    "the limit resets; and waiting on the service, after a record reporting it overloaded or "
    "unavailable. Working time and the three kinds of waiting add up to the transcript's span. Wall "
    "time is a clock on the wall from workflow.py init to the end of the benchmark, which ends when "
    "its report is finished; the first scoring records that end in the run's phase log and later "
    "re-scores keep it. The Figma build time comes from the runner's log, with no model in the loop: "
    "each unbroken stretch of steps, from the first served to the last recorded, added up, where a "
    "pause of more than 15 minutes starts a new stretch.")


def message_of(entry: dict) -> dict:
    """A record's message, or an empty one when a damaged line holds something else."""
    message = entry.get("message")
    return message if isinstance(message, dict) else {}


def _text_of(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return " ".join(block["text"] for block in content
                    if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str))


def api_wait(entry: dict) -> tuple[str | None, dt.datetime | None]:
    """('limit' | 'service' | None, when a limit resets if the record says). Waiting on usage
    limits and waiting on the service are different problems, so they are told apart. Written from
    the shapes real Claude Code transcripts use (September 2026):

    - Usage, session and spend limits are a synthetic assistant message:
      {"type": "assistant", "isApiErrorMessage": true, "error": "rate_limit", "apiErrorStatus": 429,
       "message": {"content": [{"type": "text", "text": "You've hit your session limit · resets
       5:40pm (America/Chicago)"}]}, "quotaLimits": {"status": "rejected", "resetsAt": 1789771200,
       "rateLimitType": "five_hour", ...}}. The spend-limit variant reads "You've hit your individual
       spend limit · run /usage-credits to ask your admin for a higher limit", with
       quotaLimits.overageDisabledReason "org_spend_cap_reached" or "out_of_credits".
      A 429 retry record (the system shape below with status 429) is a limit too.
    - An overloaded or unavailable service is a retry record:
      {"type": "system", "subtype": "api_error", "level": "error", "error": {"status": 529,
       "formatted": "529 Overloaded", "message": "529 {... \"overloaded_error\" ...}"},
       "retryInMs": 536, "retryAttempt": 1}. A 503 variant carries the same overloaded_error type.

    Other retry records (connection reset, no response, offline) are neither; their gaps stay
    with whatever surrounds them. Only structured fields are read, never the text a tool printed,
    because transcripts also quote these very strings in prompts and tool output."""
    if entry.get("type") == "assistant" and entry.get("isApiErrorMessage") and (
            entry.get("error") == "rate_limit" or entry.get("apiErrorStatus") == 429):
        resets = (entry.get("quotaLimits") or {}).get("resetsAt")
        return "limit", (dt.datetime.fromtimestamp(resets, dt.timezone.utc)
                         if isinstance(resets, (int, float)) and resets > 0 else None)
    if entry.get("type") == "system" and entry.get("subtype") == "api_error":
        error = entry.get("error") if isinstance(entry.get("error"), dict) else {}
        if error.get("status") == 429:
            return "limit", None
        if error.get("status") == 529 or "overloaded_error" in str(error.get("message") or ""):
            return "service", None
    return None, None


def is_person_prompt(entry: dict) -> bool:
    """A prompt a person typed in the main session: not a tool result, not text the harness
    injected (isMeta, compaction summaries, command output, notifications, interruptions). A
    slash command a person typed (<command-name>) counts as a prompt."""
    if entry.get("type") != "user" or entry.get("isSidechain") or entry.get("isMeta") \
            or entry.get("isCompactSummary") or "toolUseResult" in entry:
        return False
    message = message_of(entry)
    content = message.get("content")
    if isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
        return False
    text = _text_of(message).lstrip()
    return bool(text) and not text.startswith((
        "<local-command-", "<task-notification>", "<system-reminder>", "[Request interrupted", "Caveat:",
        "This session is being continued from a previous conversation"))


# Tools that stop and wait for the person's answer. In real transcripts (September 2026) the call
# is an assistant record whose content holds {"type": "tool_use", "id": ..., "name": "AskUserQuestion",
# "input": {"questions": [...]}} (or "name": "ExitPlanMode", "input": {"plan": ..., "planFilePath":
# ...}, when a plan is put up for approval), and the answer is a later user record whose content
# holds {"type": "tool_result", "tool_use_id": <the same id>, ...}, with a record-level toolUseResult
# of {"answers", "questions"} or {"plan", "filePath", ...}; a refusal carries "is_error": true. Other
# records can fall between the two, so the wait runs from the call to its matching result.
ASKS_PERSON = ("AskUserQuestion", "ExitPlanMode")
# The permission mode a session ran in: "permissionMode" on user records and on
# {"type": "permission-mode", "permissionMode": "bypassPermissions"} records. Full access is
# bypassPermissions; in any other mode a tool span can include a wait for the person's approval.
FULL_ACCESS = "bypassPermissions"


def transcript_events(path: Path, since: dt.datetime | None, until: dt.datetime | None,
                      modes: Counter | None = None) -> tuple[list[tuple], list[tuple]]:
    """(events, asks) for one transcript. events: (time, kind, resets) in order, where kind is
    'prompt' (a person typed it), 'input' (a tool result or anything else fed to the model),
    'reply' (an assistant message that ends its turn), 'step' (an assistant message that calls a
    tool), 'ask' (one that calls a tool waiting for the person's answer), 'limit' or 'service'
    (resets: when a limit lifts, if recorded). asks: (call, result) spans of those tools. The
    permission modes seen are counted into `modes`. Content is never kept."""
    events, pending, asks = [], {}, []
    for entry in read_jsonl(path):
        if modes is not None and entry.get("permissionMode") and entry.get("type") in ("user", "permission-mode"):
            modes[entry["permissionMode"]] += 1
        when = parse_time(entry.get("timestamp"))
        if not when or (since and when < since) or (until and when > until):
            continue
        kind, resets = api_wait(entry)
        content = message_of(entry).get("content")
        blocks = [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []
        if kind:
            pass
        elif entry.get("type") == "assistant":
            calls = [b for b in blocks if b.get("type") == "tool_use"]
            asking = [b for b in calls if b.get("name") in ASKS_PERSON]
            for block in asking:
                pending[block.get("id")] = when
            kind = "ask" if asking else "step" if calls else "reply"
        elif entry.get("type") == "user":
            for block in blocks:
                if block.get("type") == "tool_result" and block.get("tool_use_id") in pending:
                    asks.append((pending.pop(block["tool_use_id"]), when))
            kind = "prompt" if is_person_prompt(entry) else "input"
        if kind:
            events.append((when, kind, resets))
    events.sort(key=lambda event: event[0])
    return events, asks


def classify_gaps(events: list[tuple]) -> dict:
    """Working, waiting-on-limits, waiting-on-service and waiting-on-person intervals between
    consecutive events. A limit's wait ends when the limit resets, if the record says when; any
    later gap is the person's. A tool that asks the person waits on the person until its result."""
    gaps = {"working": [], "limits": [], "service": [], "person": []}
    for (start, kind, resets), (end, following, _) in zip(events, events[1:]):
        if end <= start:
            continue
        if kind == "limit":
            lifted = min(end, resets) if resets and resets > start else end
            gaps["limits"].append((start, lifted))
            if lifted < end:
                gaps["person"].append((lifted, end))
        elif kind == "service":
            gaps["service"].append((start, end))
        elif kind == "ask" or (following == "prompt" and kind in ("reply", "prompt")):
            gaps["person"].append((start, end))
        else:
            gaps["working"].append((start, end))
    return gaps


def union(intervals: list) -> list:
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def subtract(intervals: list, cut: list) -> list:
    """intervals minus cut; both unions."""
    result = []
    for start, end in intervals:
        pieces = [(start, end)]
        for c_start, c_end in cut:
            pieces = [part for a, b in pieces for part in
                      (((a, min(b, c_start)),) if c_start > a else ()) + (((max(a, c_end), b),) if c_end < b else ())
                      if part[1] > part[0]]
        result += pieces
    return result


def clip(intervals: list, start: dt.datetime, end: dt.datetime) -> list:
    return [(max(a, start), min(b, end)) for a, b in intervals if min(b, end) > max(a, start)]


def total_seconds(intervals: list) -> int:
    return int(round(sum((b - a).total_seconds() for a, b in intervals)))


def working_time(files: list[Path], since: dt.datetime | None, until: dt.datetime | None,
                 split_at: dt.datetime | None = None) -> dict:
    """Working time and the two kinds of waiting, from a session's transcripts. Subagent spans
    overlap the main session's; intervals are merged, so no second is counted twice."""
    working, limits, service, first, last = [], [], [], None, None
    counts, modes = Counter(), Counter()
    for path in files:
        events, asks = transcript_events(path, since, until, modes)
        if not events:
            continue
        first = min(first or events[0][0], events[0][0])
        last = max(last or events[-1][0], events[-1][0])
        gaps = classify_gaps(events)
        # From a question tool's call to its answer this session waited on the person, whatever
        # records fell in between; another transcript working meanwhile still counts as working.
        working += subtract(union(gaps["working"]), union(asks))
        limits += gaps["limits"]
        service += gaps["service"]
        counts.update(kind for _, kind, _ in events if kind in ("limit", "service", "ask"))
    if first is None:
        return not_measured("the transcript has no timestamped messages")
    # Working wins over any wait (a subagent may work while the main session waits), then limits.
    working = union(working)
    limits = subtract(union(limits), working)
    service = subtract(subtract(union(service), working), limits)

    def part(start, end):
        span = int(round((end - start).total_seconds()))
        w = total_seconds(clip(working, start, end))
        l = total_seconds(clip(limits, start, end))
        v = total_seconds(clip(service, start, end))
        return {"start": iso(start), "end": iso(end), "spanSeconds": span, "workingSeconds": w,
                "waitingOnLimitsSeconds": l, "waitingOnServiceSeconds": v,
                "waitingOnPersonSeconds": span - w - l - v}
    result = {"status": "measured", **part(first, last), "limitEvents": counts["limit"],
              "serviceEvents": counts["service"], "questionsToPerson": counts["ask"],
              "fullAccess": (set(modes) == {FULL_ACCESS}) if modes else None,
              # For developers: the permission modes the transcripts recorded, with how often.
              "developer": {"permissionModes": dict(modes.most_common())},
              "definition": TIME_DEFINITION}
    how = "record it with workflow.py record --phase benchmark --status running before scoring"
    if split_at is None:
        result["production"] = {"status": "measured", **part(first, last)}
        result["benchmark"] = not_measured("the benchmark step's start was not recorded, so its working "
                                           "time cannot be told apart", how)
    elif split_at <= first:
        result["production"] = not_measured("the transcript starts after the benchmark step began")
        result["benchmark"] = {"status": "measured", **part(first, last)}
    elif split_at >= last:
        result["production"] = {"status": "measured", **part(first, last)}
        result["benchmark"] = not_measured("the transcript ends before the benchmark step began")
    else:
        result["production"] = {"status": "measured", **part(first, split_at)}
        result["benchmark"] = {"status": "measured", **part(split_at, last)}
    return result


def preflight_go_ahead(run_dir: Path) -> tuple[dt.datetime | None, dict]:
    """When the person gave the run its go-ahead (workflow.py preflight), and what they chose."""
    project = read_json(run_dir / "project.json") or {}
    detail = ((project.get("phases") or {}).get("preflight") or {}).get("detail") or {}
    times = [parse_time(e.get("at")) for e in read_jsonl(run_dir / "phase-log.jsonl")
             if e.get("phase") == "preflight" and e.get("status") == "complete"]
    times = [t for t in times if t]
    return (max(times) if times else None), detail


def phase_at(log: list[dict], when: dt.datetime) -> dict:
    """The run's phase at a moment: the latest phase-log entry at or before it."""
    current = {"phase": "preflight", "status": "complete"}
    for entry in log:
        at = parse_time(entry.get("at"))
        if at and at <= when and entry.get("phase") not in (None, "init"):
            current = {"phase": entry["phase"], "status": entry.get("status")}
    return current


def unattended(files: list[Path], run_dir: Path, since: dt.datetime | None,
               until: dt.datetime | None) -> dict:
    """Whether the run stayed unattended after the preflight go-ahead, until the benchmark began:
    every question tool it called, and every turn that ended and waited for a person's prompt,
    counts as an interruption, with the phase it happened in. Waits before the go-ahead are setup.
    A plan review the person asked for at preflight is a planned stop, not an interruption."""
    go, choices = preflight_go_ahead(run_dir)
    if not go:
        return not_measured("the run had no preflight go-ahead, so there is no point from which it was "
                            "left to run", "start runs with workflow.py preflight, as design-lab:run does")
    end = benchmark_start(run_dir)
    log = read_jsonl(run_dir / "phase-log.jsonl")
    found = []
    for path in files:
        if "subagents" in path.parts:
            continue
        events, _ = transcript_events(path, since, until)
        for (at, kind, _), (following_at, following, _) in zip(events, events[1:] + [(None, None, None)]):
            if at < go or (end and at >= end):
                continue
            if kind == "ask":
                found.append({"at": iso(at), "kind": "question", **phase_at(log, at)})
            elif kind == "reply" and following == "prompt" and (not end or following_at < end):
                found.append({"at": iso(at), "kind": "turn ended and waited for a prompt", **phase_at(log, at)})
    # A run that stopped for the person (the runner was absent) is an interruption too.
    for entry in log:
        at = parse_time(entry.get("at"))
        if entry.get("status") == "stopped" and at and at >= go and not (end and at >= end):
            found.append({"at": iso(at), "kind": f"stopped: {entry.get('reason') or 'waiting for the person'}",
                          "phase": entry.get("phase") or "unknown", "status": "stopped"})
    found.sort(key=lambda item: item["at"])
    for item in found:
        item["planned"] = (choices.get("planApproval") == "review" and item["phase"] == "plan"
                           and item["status"] == "awaiting-approval")
    counted = [item for item in found if not item["planned"]]
    return {"status": "measured", "goAheadAt": iso(go), "until": iso(end) if end else None,
            "interruptions": found, "count": len(counted), "ranUnattended": not counted}


def unattended_phrase(section: dict) -> str:
    if section.get("status") != "measured":
        return f"not measured, because {section.get('reason')}"
    if section["ranUnattended"]:
        return "yes"
    items = [item for item in section["interruptions"] if not item["planned"]]
    return (f"no, {len(items)} interruption{'s' if len(items) != 1 else ''}: "
            + "; ".join(f"{'a question' if i['kind'] == 'question' else 'a stop, ' + i['kind'][9:] if i['kind'].startswith('stopped: ') else 'a turn that waited for a prompt'} "
                        f"during {i['phase']}" for i in items))


def evidence_window(run_dir: Path, project: dict | None,
                    runner: dict | None) -> tuple[dt.datetime | None, dt.datetime | None]:
    project = project or {}
    start = parse_time((project.get("run") or {}).get("startedAt") or project.get("createdAt"))
    times = [parse_time((phase or {}).get("updatedAt")) for phase in (project.get("phases") or {}).values()]
    times += [parse_time(entry.get("at")) for entry in read_jsonl(run_dir / "phase-log.jsonl")]
    if runner:
        times += [parse_time(row["end"]) for row in runner["sessions"]]
    times = [t for t in times if t]
    end = max(times) + dt.timedelta(minutes=5) if times else None
    return start, end


def benchmark_marks(run_dir: Path, status: str) -> list[dt.datetime]:
    marks = [parse_time(e.get("at")) for e in read_jsonl(run_dir / "phase-log.jsonl")
             if e.get("phase") == "benchmark" and e.get("status") == status]
    return sorted(t for t in marks if t)


def benchmark_start(run_dir: Path) -> dt.datetime | None:
    """The benchmark's start. Once a completion is recorded, the benchmark is the first
    start-and-completion pair: a later start (a re-score that marked one) never moves it."""
    starts, ends = benchmark_marks(run_dir, "running"), benchmark_marks(run_dir, "complete")
    if ends:
        before = [t for t in starts if t <= ends[0]]
        return before[-1] if before else None
    return starts[-1] if starts else None


def benchmark_end(run_dir: Path, start: dt.datetime | None) -> dt.datetime | None:
    ends = [t for t in benchmark_marks(run_dir, "complete") if start and t >= start]
    return ends[0] if ends else None


def scored_before(run_dir: Path) -> bool:
    """A scorecard already in the run's own benchmark folder means the run was scored before."""
    return (run_dir / BENCHMARK_DIR / "scorecard.json").is_file()


def wall_clock(run_dir: Path, project: dict | None,
               scorer: tuple[dt.datetime, dt.datetime]) -> dict:
    """Wall time, a clock on the wall from workflow.py init to the end of the benchmark. The
    benchmark ends when its report is finished: the first scoring of a run takes the end of its
    own scoring as that end, and main() records it in the phase log, where every later re-score
    reads it and never moves it. A run with a recorded start but no recorded end that was already
    scored (before the scorer recorded ends) shows no wall time."""
    project = project or {}
    start = parse_time((project.get("run") or {}).get("startedAt") or project.get("createdAt"))
    bench = benchmark_start(run_dir)
    scorer_start, scorer_end = scorer
    end, source = benchmark_end(run_dir, bench), "phase log"
    if bench and end is None and not scored_before(run_dir) and scorer_end >= bench:
        end, source = scorer_end, "this scoring"
    seconds = lambda a, b: int((b - a).total_seconds()) if a and b else None
    wall = seconds(start, end) if start and bench and end else None
    reason = (None if wall is not None else
              "the run's start was not recorded by workflow.py init" if not start else
              "the benchmark step's start was not recorded" if not bench else
              "the benchmark step's end was not recorded when it was first scored")
    return {
        "runStart": iso(start), "benchmarkStart": iso(bench),
        "benchmarkEnd": iso(end) if end and bench else None,
        "benchmarkEndSource": source if end and bench else None,
        "wallSeconds": wall,
        "libraryWallSeconds": seconds(start, bench) if wall is not None else None,
        "benchmarkWallSeconds": seconds(bench, end) if wall is not None else None,
        "scorerSeconds": round((scorer_end - scorer_start).total_seconds(), 1),
        **({"notShownBecause": reason} if reason else {}),
    }


def finish_clock(clock: dict, end: dt.datetime) -> None:
    """Move the end this scoring fixed to when its report is finished, and recompute what depends
    on it."""
    clock["benchmarkEnd"] = iso(end)
    start, bench = parse_time(clock.get("runStart")), parse_time(clock.get("benchmarkStart"))
    if start and bench:
        clock["wallSeconds"] = int((end - start).total_seconds())
        clock["benchmarkWallSeconds"] = int((end - bench).total_seconds())


def record_benchmark_end(run_dir: Path, clock: dict) -> bool:
    """Record the benchmark's end in the run's phase log, as workflow.py record --phase benchmark
    --status complete does, when this scoring fixed it. Nothing else in the run is written."""
    if clock.get("benchmarkEndSource") != "this scoring":
        return False
    import workflow
    path, project = workflow.load_project(run_dir)
    workflow.set_phase(path, project, "benchmark", "complete", {"recordedBy": "score_run.py"},
                       at=clock["benchmarkEnd"])
    return True


def current_session(folder: str | None, since: dt.datetime | None = None) -> tuple[str | None, str | None]:
    """The most recently written main transcript in the run's recorded transcript folder, and a
    warning when other sessions in that folder were also written during the run, because the
    newest one may then not be the one that ran the build."""
    if not folder or not Path(folder).is_dir():
        return None, None
    mains = sorted(Path(folder).glob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    if not mains:
        return None, None
    active = [m for m in mains if since and dt.datetime.fromtimestamp(m.stat().st_mtime, dt.timezone.utc) >= since]
    warning = None
    if len(active) > 1:
        warning = (f"--session current chose {mains[-1].stem}, the newest of {len(active)} sessions written in "
                   f"{folder} during this run ({', '.join(m.stem for m in active)}); if another Claude session "
                   "was open in the same folder, re-score with --session <id> for the one that ran the build")
    return mains[-1].stem, warning


def score_cost(run_dir: Path, project: dict | None, transcripts: list | None,
               since: str | None, until: str | None, session=None,
               scorer: tuple[dt.datetime, dt.datetime] | None = None) -> dict:
    runner = runner_steps(run_dir / "figma" / "runner.log")
    timings = phase_timings(run_dir, project)
    claude = ((project or {}).get("run") or {}).get("claude") or {}
    sessions = [session] if isinstance(session, str) else list(session or [])
    session_warning = None
    if "current" in sessions:
        run_start = parse_time(((project or {}).get("run") or {}).get("startedAt") or (project or {}).get("createdAt"))
        chosen, session_warning = current_session(claude.get("transcripts"), run_start)
        sessions = [chosen if s == "current" else s for s in sessions]
        if session_warning:
            print(f"warning: {session_warning}", file=sys.stderr)
    sessions = [s for s in sessions if s]
    if transcripts or sessions:
        explicit, folders = [], []
        for item in transcripts or []:
            item = Path(item)
            if item.is_dir():
                folders.append(item)
            elif item.is_file():
                explicit += session_files(item)
        candidates = [claude.get("configDir"), os.environ.get("CLAUDE_CONFIG_DIR"), "~/.claude", "~/.claude-work"]
        for sid in sessions:
            explicit += find_session(sid, [c for c in dict.fromkeys(candidates) if c])
        # Named sessions or files are taken whole; a folder is cut to the run's time window.
        start = end = None
        if folders:
            start, end = evidence_window(run_dir, project, runner)
            explicit += [f for folder in folders for f in sorted(folder.rglob("*.jsonl"))]
        start = parse_time(since) or start
        end = parse_time(until) or end
        files = list(dict.fromkeys(explicit))
        usage = transcript_usage(files, start, end, benchmark_start(run_dir))
        working = working_time(files, start, end, benchmark_start(run_dir))
        attended = unattended(files, run_dir, start, end)
        what = (("session " + ", ".join(sessions)) if sessions else ", ".join(str(t) for t in transcripts or []))
        model = ({"status": "measured", "source": what, **usage} if usage["assistantMessages"] else
                 not_measured(f"no assistant messages found in {what}" +
                              (f" between {iso(start)} and {iso(end)}" if start or end else ""),
                              "pass --session <id> for the session that ran the build"))
        if usage["assistantMessages"] and folders:
            model["caveat"] = ("Counts every session in the folder inside the run's time window; "
                               "unrelated work in the same window is included. Use --session to "
                               "name the run's session instead.")
        if usage["assistantMessages"] and usage["benchmark"].get("status") == "measured":
            model["benchmarkNote"] = (
                "The scorer is a plain script with no model in the loop, so the benchmark's tokens are "
                "only the orchestration turns around it. The completion message written after the "
                "report is not included, because it did not exist yet.")
        if working["status"] == "measured" and folders:
            working["caveat"] = model.get("caveat")
    else:
        hint = claude.get("transcripts")
        how = ("re-run with --session <session-id>, or --transcripts <file.jsonl>"
               + (f" (sessions for this run are under {hint})" if hint else ""))
        model = not_measured("no session or transcript was given", how)
        working = not_measured("no session transcript was given, so working time was not measured "
                               "for this run", how)
        attended = not_measured("no session transcript was given, so interruptions after preflight "
                                "were not counted", how)
    now_ = dt.datetime.now(dt.timezone.utc)
    clock = wall_clock(run_dir, project, scorer or (now_, now_))
    parts = [runner is not None, timings is not None, model["status"] == "measured",
             working["status"] == "measured"]
    status = "measured" if all(parts) else "partial" if any(parts) else "not-measured"
    section = {"status": status, "definition": TIME_DEFINITION, "clock": clock, "working": working,
               "unattended": attended,
               "runner": runner or not_measured("figma/runner.log is missing"),
               "timings": timings or not_measured("project.json has no phase times"),
               "model": model}
    if session_warning:
        section["developer"] = {"sessionWarning": session_warning}
    if status == "not-measured":
        section["reason"] = "no timing, runner or transcript evidence"
    return section


# ---------------------------------------------------------------------------- library contents

def score_library(run_dir: Path, project: dict | None) -> dict:
    components = read_json(run_dir / "components.json") or {}
    plan = read_json(run_dir / "plan.json") or {}
    index = read_json(run_dir / "index.json") or {}
    foundation = read_json(run_dir / "foundation.json") or {}
    variables = read_json(run_dir / "figma" / "results" / "variables.json") or {}
    variable_plan = read_json(run_dir / "variable-plan.json") or {}
    if not (components or plan or index):
        return not_measured("no components.json, plan.json or index.json in the run")
    plans = plan.get("plans") or []
    build = [p for p in plans if p.get("verdict") == "build"]
    totals = index.get("totals") or {}
    dump_dir = run_dir / "figma" / "dump"
    pages = sorted(path.stem for path in dump_dir.glob("*.json")) if dump_dir.is_dir() else []
    nodes = 0
    for path in dump_dir.glob("*.json") if dump_dir.is_dir() else []:
        nodes += len((read_json(path) or {}).get("nodes") or [])
    collections = foundation.get("collections") or variables.get("collections") or {}
    variable_count = sum(int((c or {}).get("variables") or 0) for c in collections.values()
                         if isinstance(c, dict))
    if not variable_count:
        planned = variable_plan.get("collections") or {}
        planned = planned.values() if isinstance(planned, dict) else planned
        variable_count = sum(len((c or {}).get("variables") or []) for c in planned)
    counted = library_counts.counts(run_dir)
    tiers = [{"tier": row["tier"], "components": row["found"], "built": row["built"]}
             for row in (counted or {}).get("byTier") or []]
    shots = run_dir / "capture" / "shots"
    phase = ((project or {}).get("phases") or {}).get("components", {}).get("detail") or {}
    # Built means the build recorded it (library_counts), never merely planned.
    built = counted["built"] if counted and counted["builtKnown"] else phase.get("built")
    return {
        "status": "measured",
        "summary": f"{built if built is not None else 'No'} components built from {len(components.get('components') or []) or totals.get('components')} found in the source.",
        "components": {"found": len(components.get("components") or []) or totals.get("components"),
                       "planned": len(build), "built": built,
                       "notBuilt": totals.get("notBuilt"),
                       # From library_counts, so it matches the coverage strip: refused by the plan,
                       # not retirement candidates or schema-only entries, which are not counted.
                       "refused": (counted["gap"]["refused"] if counted
                                   else sum(1 for p in plans if p.get("verdict") == "refuse"))},
        "variants": sum(int(p.get("variants") or 0) for p in build) or None,
        "properties": sum(len(p.get("properties") or []) for p in build) or None,
        "variables": variable_count or None,
        "collections": len(collections) or None,
        "pages": len(pages) or len(foundation.get("pages") or {}) or None,
        "pageNames": pages or sorted((foundation.get("pages") or {}).keys()),
        "nodes": nodes or None,
        "captures": len(list(shots.glob("*.png"))) if shots.is_dir() else None,
        "tiers": tiers,
        "tierTable": library_counts.tier_table(counted) if counted and counted["tiered"] else [],
        "voicePage": (run_dir / "voice.json").is_file(),
        "examplesPage": (run_dir / "compositions.json").is_file(),
        "notBuiltReasons": [{"id": item.get("id"), "label": item.get("label"),
                             "reason": item.get("reason")} for item in index.get("notBuilt") or []],
    }


# ---------------------------------------------------------------------------- coverage

def score_coverage(run_dir: Path) -> dict:
    """Built out of what the run could have built; every number from library_counts.py, the
    module the Figma Cover and Getting Started page are drawn from."""
    c = library_counts.counts(run_dir)
    if c is None:
        return not_measured("no components.json, so nothing says what the source holds")
    if not c["builtKnown"]:
        return not_measured("no Figma build state, index or build records, so nothing says what was built",
                            "let the build write its receipts (figma_build.py receipts)")
    section = {"status": "measured", "found": c["found"], "eligible": c["eligible"], "built": c["built"],
               "ratio": c["ratio"], "gap": c["gap"], "excluded": c["excluded"],
               "reasonLabels": c["reasonLabels"], "summary": library_counts.coverage_sentence(c),
               "items": [{"id": r["id"], "label": r["label"], "reason": r["status"], "detail": r["detail"]}
                         for r in c["notBuilt"]],
               "byTier": c["byTier"], "coverBreakdown": c["coverBreakdown"],
               "outsideInventory": c["outsideInventory"]}
    p = c["placements"]
    if p["total"]:
        section["usageWeighted"] = {"placements": p["total"], "covered": p["covered"], "ratio": p["ratio"],
                                    "structuralRefs": c["structural"]["total"],
                                    "structuralCovered": c["structural"]["covered"]}
    else:
        section["usageWeighted"] = not_measured("no usage placements were recorded for this run")
    return section


# ---------------------------------------------------------------------------- conformance

def score_conformance(run_dir: Path, project: dict | None) -> dict:
    report_path = None
    for artifact in ((project or {}).get("artifacts") or {}).values():
        if artifact.get("kind") == "verify-report":
            report_path = (run_dir / artifact["path"]).resolve()
    report_path = report_path or run_dir / "verify-report.json"
    report = read_json(report_path)
    if not report:
        status = (((project or {}).get("phases") or {}).get("verify") or {}).get("status")
        return not_measured(f"no verification report; the verify phase is {status or 'unrecorded'}",
                            "run design-lab:verify and register verify-report.json")
    open_items = report.get("open") or []
    severities = Counter(item.get("severity") or "unrated" for item in open_items)
    return {"status": "measured",
            "summary": f"{len(open_items)} open finding(s), {len(report.get('waived') or [])} waived.",
            "open": {s: severities.get(s, 0) for s in ("blocker", "major", "minor")},
            "openOther": sum(v for k, v in severities.items() if k not in ("blocker", "major", "minor")),
            "waived": len(report.get("waived") or []),
            "passed": len(report.get("passed") or []),
            "inapplicable": len(report.get("inapplicable") or []),
            "completeness": report.get("completeness") or {},
            "findings": [{"severity": item.get("severity"), "check": item.get("check") or item.get("id"),
                          "message": item.get("message") or item.get("detail")}
                         for item in open_items[:40]]}


# ---------------------------------------------------------------------------- accuracy

def breakpoint_of(label: str, index: int, count: int) -> str:
    match = re.search(r"(desktop|tablet|mobile)", label or "", re.I)
    if match:
        return match.group(1).lower()
    return ("mobile", "tablet", "desktop")[index] if count == 3 else f"width-{index}"


def accuracy_pairs(run_dir: Path) -> list[dict]:
    import figma_compare
    labels = {c.get("id"): c.get("label") for c in
              (read_json(run_dir / "components.json") or {}).get("components") or []}
    pairs = []
    for block in sorted((run_dir / "figma" / "results").glob("block_*.json")):
        component = block.stem[len("block_"):]
        specimen = run_dir / "figma" / "compare" / f"{component}.png"
        geometry = (read_json(block) or {}).get("geometry") or {}
        if not specimen.is_file() or not geometry.get("variants"):
            continue
        original = figma_compare.compare(specimen, geometry)
        corrected = figma_compare.compare(specimen, geometry, corrected=True)
        captures = geometry.get("captures") or []
        variants = geometry.get("variants") or []
        for index, (old, new) in enumerate(zip(original["pairs"], corrected["pairs"])):
            capture = captures[index] if index < len(captures) else {}
            variant = variants[index] if index < len(variants) else {}
            pairs.append({
                "component": component, "label": labels.get(component) or component,
                "breakpoint": breakpoint_of(capture.get("label", ""), index, len(captures)),
                "width": round(capture.get("width") or new["width"]),
                "original": {"ratio": old["ratio"], "pass": old["pass"]},
                "corrected": {"ratio": new["ratio"], "pass": new["pass"]},
                "heightDelta": new["heightDelta"], "widthDelta": new["widthDelta"],
                "figmaHeight": variant.get("height"), "liveHeight": capture.get("height"),
                "evidence": {"specimen": str(specimen.relative_to(run_dir)),
                             "geometry": str(block.relative_to(run_dir)), "index": index},
            })
    return pairs


def recorded_pairs(run_dir: Path) -> list[dict]:
    """Fallback: the original-metric results already stored in build records."""
    pairs = []
    for record in sorted((run_dir / "builds").glob("*.json")):
        data = read_json(record) or {}
        metrics = ((data.get("visualEvidence") or {}).get("comparison") or {}).get("metrics") or {}
        items = metrics.get("pairs") or []
        for index, pair in enumerate(items):
            pairs.append({"component": data.get("id") or record.stem, "label": data.get("id") or record.stem,
                          "breakpoint": breakpoint_of(pair.get("label", ""), index, len(items)),
                          "width": pair.get("width"),
                          "original": {"ratio": pair.get("ratio"), "pass": pair.get("pass")},
                          "corrected": None, "heightDelta": pair.get("heightDelta"),
                          "widthDelta": None, "evidence": None})
    return pairs


def summarise(pairs: list[dict], metric: str) -> dict:
    rows = [p for p in pairs if p.get(metric)]
    ratios = [p[metric]["ratio"] for p in rows]
    return {"pass": sum(1 for p in rows if p[metric]["pass"]), "total": len(rows),
            "medianRatio": median(ratios), "p75Ratio": quantile(ratios, 0.75),
            "maxRatio": max(ratios) if ratios else None}


def score_accuracy(run_dir: Path) -> dict:
    import figma_compare
    pairs, source = [], "recomputed from specimen screenshots"
    try:
        pairs = accuracy_pairs(run_dir)
    except ImportError as error:           # Pillow missing
        source = f"recorded results only ({error})"
    if not pairs:
        pairs = recorded_pairs(run_dir)
        source = "original metric as recorded in build records"
    if not pairs:
        return not_measured("no specimen screenshots (figma/compare) or comparison results",
                            "let the runner finish its compare steps, which save both")
    by_breakpoint = {}
    names = [b for b in BREAKPOINTS if any(p["breakpoint"] == b for p in pairs)]
    names += sorted({p["breakpoint"] for p in pairs} - set(names))
    for name in names:
        subset = [p for p in pairs if p["breakpoint"] == name]
        heights = [p["heightDelta"] for p in subset if p.get("heightDelta") is not None]
        by_breakpoint[name] = {
            "original": summarise(subset, "original"),
            "corrected": summarise(subset, "corrected") if subset[0].get("corrected") else None,
            "heightDelta": {"median": median(heights), "max": max(heights) if heights else None,
                            "over10px": sum(1 for h in heights if h > 10)},
        }
    components = defaultdict(dict)
    for pair in pairs:
        components[pair["component"]][pair["breakpoint"]] = pair
    corrected = pairs[0].get("corrected") is not None
    section = {
        "status": "measured" if corrected else "partial",
        "source": source,
        "threshold": figma_compare.THRESHOLD, "tolerance": figma_compare.TOLERANCE,
        "metrics": {
            "original": "Shared top-left area only; greyscale difference over the tolerance. "
                        "Kept so earlier results stay comparable.",
            "corrected": "Larger of the two boxes; area only one side covers counts as changed; "
                         "tolerance applied per colour channel.",
        },
        "overall": {"original": summarise(pairs, "original"),
                    "corrected": summarise(pairs, "corrected") if corrected else None},
        "byBreakpoint": by_breakpoint,
        "components": len(components),
        "pairs": pairs,
    }
    if not corrected:
        section["reason"] = "specimen screenshots are missing, so only the original metric is available"
    return section


# ---------------------------------------------------------------------------- repeatability

def incidental(change: dict, swaps: list[tuple[str, str]]) -> bool:
    """A difference that only reflects when or where a run happened, not what it built."""
    # Timestamps, and ids Figma assigns afresh in every new file.
    if re.search(r"(At|_at|Time|timestamp|^id|Id)$", change.get("path", "").rsplit("/", 1)[-1]):
        return True
    a, b = change.get("a"), change.get("b")
    if not (isinstance(a, str) and isinstance(b, str)):
        return False
    # A link into the run's own Figma file carries that file's key and node ids.
    figma = re.compile(r"https://www\.figma\.com/design/[A-Za-z0-9]+(\?node-id=[0-9-]+)?")
    a, b = figma.sub("<figma>", a), figma.sub("<figma>", b)
    for left, right in swaps:
        if left and right:
            a, b = a.replace(left, "<run>"), b.replace(right, "<run>")
    return a == b


def file_key(run: Path) -> str | None:
    return ((read_json(run / "project.json") or {}).get("target") or {}).get("figmaFileKey")


def score_repeatability(run_dir: Path, others: list[Path], accuracy: dict) -> dict:
    if not others:
        return not_measured("no other runs were given to compare against",
                            "score with --compare <other-run-dir> after a second run")
    import compare_runs
    comparisons = []
    for other in others:
        row = {"run": other.name, "path": str(other)}
        try:
            report = compare_runs.compare(run_dir, other)
            summary = report["summary"]
            swaps = [(str(run_dir), str(other)), (file_key(run_dir), file_key(other))]
            same_inputs = [name for name, item in report["artifacts"].items() if any(item["present"])
                           and all(incidental(change, swaps) for change in item["differences"])]
            address_only = 0
            for page in report["page_differences"].values():
                for categories in page["changes"].values():
                    if all(incidental(change, swaps) for changes in categories.values()
                           for change in changes):
                        address_only += 1
            row.update({"score": summary["score"], "totalNodes": summary["total_nodes"],
                        "identicalNodes": summary["identical_nodes"],
                        "identicalApartFromAddresses": summary["identical_nodes"] + address_only,
                        "matchedNodes": summary["matched_nodes"],
                        "categoryCounts": summary["category_counts"],
                        "artifactsEqual": [name for name, item in report["artifacts"].items()
                                           if item["normalized_equal"] and any(item["present"])],
                        "artifactsDiffer": [name for name, item in report["artifacts"].items()
                                            if not item["normalized_equal"]],
                        "artifactsEquivalent": same_inputs,
                        "artifactDifferences": [
                            {"artifact": name, "path": change["path"]}
                            for name, item in report["artifacts"].items()
                            for change in item["differences"] if not incidental(change, swaps)][:20],
                        "pageOrderEqual": report["pages"]["order_equal"]})
        except (OSError, ValueError, KeyError) as error:
            row["error"] = str(error)
        if accuracy.get("status") in ("measured", "partial"):
            try:
                theirs = {(p["component"], p["breakpoint"]): p for p in accuracy_pairs(other)}
            except Exception:  # noqa: BLE001 - accuracy agreement is a bonus, never fatal
                theirs = {}
            ours = {(p["component"], p["breakpoint"]): p for p in accuracy["pairs"]}
            shared = ours.keys() & theirs.keys()
            if shared:
                metric = "corrected" if accuracy["pairs"][0].get("corrected") else "original"
                deltas = [abs(ours[k][metric]["ratio"] - theirs[k][metric]["ratio"]) for k in shared]
                row["accuracyAgreement"] = {
                    "metric": metric, "pairs": len(shared),
                    "sameVerdict": sum(1 for k in shared
                                       if ours[k][metric]["pass"] == theirs[k][metric]["pass"]),
                    "maxRatioDifference": round(max(deltas), 4)}
        comparisons.append(row)
    scored = [row for row in comparisons if "score" in row]
    upstream = ("components.json", "tokens.json", "plan.json")
    shared_inputs = bool(scored) and all(all(name in row["artifactsEquivalent"] for name in upstream)
                                         for row in scored)
    return {
        "status": "measured" if scored else "partial",
        "level": "build" if shared_inputs else "pipeline",
        "levelNote": ("The compared runs hold identical extracted artifacts apart from timestamps "
                      "and folder paths, so this measures the Figma build. Whole-pipeline "
                      "repeatability needs two runs that each start from an empty workspace."
                      if shared_inputs else
                      "The compared runs hold artifacts that differ beyond timestamps and folder "
                      "paths, so differences can come from any phase, not only the Figma build."),
        "comparisons": comparisons,
        "minScore": min((row["score"] for row in scored), default=None),
    }


# ---------------------------------------------------------------------------- schema churn

def score_schema_churn(run_dir: Path, project: dict | None) -> dict:
    churn = ((project or {}).get("run") or {}).get("schemaChurn")
    if isinstance(churn, dict) and churn.get("changed") is True:
        changes = churn.get("changes") or []
        return {"status": "measured", "changed": True, "changes": changes,
                "summary": f"{len(changes) or 'A'} schema change(s) or workaround(s) were needed."}
    if isinstance(churn, dict) and churn.get("changed") is False:
        return {"status": "measured", "changed": False, "changes": [],
                "summary": "No schema change or workaround was needed."}
    return not_measured("not recorded for this run",
                        "record it with workflow.py identity --schema-change \"<what>\", or confirm "
                        "none with workflow.py identity --no-schema-change")


# ---------------------------------------------------------------------------- headline

def headline(sections: dict) -> dict:
    library, accuracy = sections["library"], sections["accuracy"]
    cost, repeat = sections["cost"], sections["repeatability"]
    highlights = []
    if library.get("status") == "measured":
        comp = library["components"]
        if comp.get("planned") and comp.get("built") == comp.get("planned"):
            highlights.append(f"Every planned component was built: {comp['built']} of {comp['planned']}.")
        elif comp.get("planned") and comp.get("built") is None:
            highlights.append(f"{comp['planned']} components were planned; no build receipts were recorded.")
        elif comp.get("planned"):
            highlights.append(f"{comp['built']} of {comp['planned']} planned components were built.")
    if accuracy.get("status") in ("measured", "partial"):
        metric = "corrected" if accuracy["overall"].get("corrected") else "original"
        ranked = sorted(((name, value[metric]) for name, value in accuracy["byBreakpoint"].items()
                         if value.get(metric)), key=lambda item: -item[1]["pass"] / max(1, item[1]["total"]))
        if ranked:
            best, worst = ranked[0], ranked[-1]
            highlights.append(f"{best[0].capitalize()} is the closest match: {best[1]['pass']} of "
                              f"{best[1]['total']} components within tolerance.")
            if worst[0] != best[0]:
                highlights.append(f"{worst[0].capitalize()} needs the most work: {worst[1]['pass']} of "
                                  f"{worst[1]['total']} match, median {worst[1]['medianRatio'] * 100:.0f}% "
                                  f"of pixels differ.")
    if repeat.get("status") == "measured":
        scored = [row for row in repeat["comparisons"] if "score" in row]
        identical = min(row["identicalApartFromAddresses"] for row in scored)
        total = max(row["totalNodes"] for row in scored)
        highlights.append(f"Rebuilding gives the same file: {identical:,} of {total:,} nodes "
                          f"identical across {len(scored) + 1} runs, apart from each file's own "
                          f"links.")
    runner = cost.get("runner") or {}
    if runner.get("steps"):
        highlights.append(f"The Figma build ran without a model in the loop: {runner['steps']} steps "
                          f"in {human_duration(runner['activeSeconds'])}.")
    if accuracy.get("pairs"):
        worst = max(accuracy["pairs"], key=lambda p: p.get("heightDelta") or 0)
        if (worst.get("heightDelta") or 0) > 10:
            figma, live = worst.get("figmaHeight"), worst.get("liveHeight")
            direction = ("shorter" if figma < live else "taller") if figma is not None and live is not None else "off"
            highlights.append(f"Biggest single gap: {worst['label']} at {worst['breakpoint']} is "
                              f"{worst['heightDelta']:g} px {direction} in Figma than on the live site.")
    model = cost.get("model") or {}
    working = cost.get("working") or {}
    production = working.get("production") or {}
    coverage = sections.get("coverage") or {}
    return {
        "coverage": ({k: coverage.get(k) for k in ("built", "eligible", "ratio", "gap", "excluded")}
                     | {"placements": (coverage.get("usageWeighted") or {}).get("ratio")}
                     if coverage.get("status") == "measured" else None),
        "built": {"components": (library.get("components") or {}).get("built"),
                  "variants": library.get("variants"), "pages": library.get("pages"),
                  "variables": library.get("variables"), "nodes": library.get("nodes")},
        "accuracy": {"original": (accuracy.get("overall") or {}).get("original"),
                     "corrected": (accuracy.get("overall") or {}).get("corrected")},
        "effort": {"workingSeconds": production.get("workingSeconds"),
                   "waitingOnPersonSeconds": production.get("waitingOnPersonSeconds"),
                   "waitingOnLimitsSeconds": production.get("waitingOnLimitsSeconds"),
                   "waitingOnServiceSeconds": production.get("waitingOnServiceSeconds"),
                   "benchmarkWorkingSeconds": (working.get("benchmark") or {}).get("workingSeconds"),
                   "wallSeconds": (cost.get("clock") or {}).get("wallSeconds"),
                   "buildSeconds": runner.get("activeSeconds"),
                   "buildSteps": runner.get("steps"),
                   "tokens": (model.get("tokens") or {}).get("total"),
                   "tokensByModel": [{"name": r["name"], "total": r["total"]}
                                     for r in model.get("byModel") or []],
                   "libraryTokensByModel": [{"name": r["name"], "total": r["total"]} for r in
                                            (model.get("production") or {}).get("byModel") or []],
                   "benchmarkTokensByModel": ([{"name": r["name"], "total": r["total"]} for r in
                                               (model.get("benchmark") or {}).get("byModel") or []]
                                              if (model.get("benchmark") or {}).get("status") == "measured"
                                              else None),
                   "toolCalls": model.get("toolCalls")},
        "highlights": highlights,
    }


# ---------------------------------------------------------------------------- schema check

def check_schema(value, schema: dict, path: str = "$") -> list[str]:
    """Validate the subset of JSON Schema the scorecard schema uses; no dependency needed."""
    errors = []
    types = schema.get("type")
    if types:
        allowed = types if isinstance(types, list) else [types]
        kinds = {"object": dict, "array": list, "string": str, "boolean": bool, "null": type(None)}
        ok = False
        for kind in allowed:
            if kind == "integer":
                ok |= isinstance(value, int) and not isinstance(value, bool)
            elif kind == "number":
                ok |= isinstance(value, (int, float)) and not isinstance(value, bool)
            else:
                ok |= isinstance(value, kinds[kind])
        if not ok:
            return [f"{path}: expected {'/'.join(allowed)}"]
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} is not one of {schema['enum']}")
    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: must be {schema['const']!r}")
    if isinstance(value, dict):
        for key in schema.get("required") or []:
            if key not in value:
                errors.append(f"{path}: missing `{key}`")
        properties = schema.get("properties") or {}
        for key, item in value.items():
            if key in properties:
                errors += check_schema(item, properties[key], f"{path}.{key}")
            elif isinstance(schema.get("additionalProperties"), dict):
                errors += check_schema(item, schema["additionalProperties"], f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}: unexpected `{key}`")
        for condition in schema.get("allOf") or []:
            trigger = condition.get("if")
            if trigger and not check_schema(value, trigger, path):
                errors += check_schema(value, condition.get("then") or {}, path)
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        for index, item in enumerate(value):
            errors += check_schema(item, schema["items"], f"{path}[{index}]")
    return errors


def validate_scorecard(scorecard: dict) -> list[str]:
    schema = read_json(PLUGIN_DIR / "schemas" / "scorecard.schema.json")
    if not schema:
        return ["schemas/scorecard.schema.json is missing or unreadable"]
    return check_schema(scorecard, schema)


# ---------------------------------------------------------------------------- entry points

def human_duration(seconds) -> str | None:
    if seconds is None:
        return None
    seconds = int(round(seconds))
    if seconds < 90:
        return f"{seconds} seconds"
    hours, rest = divmod(seconds, 3600)
    if hours:
        return f"{hours} h {round(rest / 60)} min"
    return f"{rest // 60} min {rest % 60} s" if rest % 60 else f"{rest // 60} min"


def token_list(rows) -> str:
    return ", ".join(f"{r['total']:,} {r['name']}" for r in rows or []) or "none"


def working_phrase(working: dict) -> str:
    """The completion message's working time: library production, then the benchmark's own."""
    production, bench = working.get("production") or {}, working.get("benchmark") or {}
    if working.get("status") != "measured" or production.get("status") != "measured":
        return ("working time was not measured for this run (score it with --session <id> to measure "
                "when Claude or its tools were working)")
    waits = [f"{human_duration(production[k])} waiting on {what}" for k, what in
             (("waitingOnPersonSeconds", "the person"), ("waitingOnLimitsSeconds", "usage limits"),
              ("waitingOnServiceSeconds", "the service")) if production.get(k)]
    return (f"design-lab took {human_duration(production['workingSeconds'])} of working time to produce the library"
            + (f" ({', '.join(waits)} not counted)" if waits else "")
            + (f", and the benchmark {human_duration(bench['workingSeconds'])} more"
               if bench.get("status") == "measured" else ""))


def completion_message(card: dict, report: Path) -> str:
    """Fill references/completion-message.md, the fixed reply design-lab:run ends with."""
    text = COMPLETION_TEMPLATE.read_text(encoding="utf-8")
    template = text.split("```text\n", 1)[1].split("\n```", 1)[0]
    s = card["sections"]
    ident = s["identity"].get("fields") or {}
    cov, acc, cost = s["coverage"], s["accuracy"], s["cost"]
    clock, model = cost.get("clock") or {}, cost.get("model") or {}
    runner = cost.get("runner") or {}
    missing = [name for name, sec in (("conformance", s["conformance"]), ("schema churn", s["schemaChurn"]),
                                      ("repeatability", s["repeatability"]), ("accuracy", acc))
               if sec.get("status") == "not-measured"]
    if model.get("status") != "measured":
        missing.append("model tokens")
    elif (model.get("benchmark") or {}).get("status") != "measured":
        missing.append("benchmark tokens (step start not recorded)")
    working = cost.get("working") or {}
    if working.get("status") != "measured":
        missing.append("working time (no session transcript)")
    if clock.get("wallSeconds") is None:
        missing.append(f"wall time ({clock.get('notShownBecause') or 'not recorded'})")
    missing += ["foundations and voice rubric (scored later)", "blinded visual judgement (scored later)"]
    usage = cov.get("usageWeighted") or {}
    corrected = (acc.get("overall") or {}).get("corrected")
    original = (acc.get("overall") or {}).get("original")
    values = {
        "site": s["identity"].get("fields", {}).get("siteLabel") or card["run"]["siteLabel"],
        "figma_url": ident.get("figmaUrl") or "not recorded",
        "coverage": (f"built {cov['built']} of {cov['eligible']} buildable components "
                     f"({cov['ratio'] * 100:.0f}%)" if cov.get("status") == "measured" else "not measured"),
        "placements": (f"{usage['ratio'] * 100:.0f}% of placements on the site ({usage['covered']:,} of "
                       f"{usage['placements']:,})" if usage.get("placements") else
                       "an unmeasured share of placements (no usage data)"),
        "report_url": report.resolve().as_uri(),
        "accuracy": (f"{corrected['pass']} of {corrected['total']} widths within tolerance (corrected measure); "
                     f"{original['pass']} of {original['total']} on the original measure" if corrected else
                     f"{original['pass']} of {original['total']} widths within tolerance (original measure)"
                     if original else "not measured"),
        "working_time": working_phrase(working),
        "unattended": unattended_phrase(cost.get("unattended") or {}),
        "wall_time": (f"wall time {human_duration(clock['wallSeconds'])} from the start of the run to the end "
                      f"of the benchmark" if clock.get("wallSeconds") is not None else
                      f"no wall time, because {clock.get('notShownBecause') or 'its ends were not recorded'}"),
        "figma_build_time": (f"{human_duration(runner['activeSeconds'])} over {runner['steps']} steps"
                             if runner.get("steps") else "not measured"),
        "library_tokens": (token_list((model.get("production") or {}).get("byModel"))
                           if model.get("status") == "measured" else "not measured"),
        "benchmark_tokens": (token_list((model.get("benchmark") or {}).get("byModel"))
                             if (model.get("benchmark") or {}).get("status") == "measured" else "not measured"),
        "not_measured": "; ".join(missing),
        # The same split and wording as the report's coverage strip and "What the run built".
        "gaps": (("not built: " + ("; ".join(f"{n} {cov['reasonLabels'][k]}" for k, n in cov["gap"].items() if n)
                                   or "none"))
                 + ("; not counted: " + "; ".join(f"{n} {cov['reasonLabels'][k]}{'s' if n != 1 and k == 'retirement' else ''}"
                                                 for k, n in cov["excluded"].items() if n)
                    if any(cov["excluded"].values()) else "")
                 if cov.get("status") == "measured" else "not measured"),
    }
    for key, value in values.items():
        template = template.replace("{" + key + "}", str(value))
    return template + "\n"


def score(run_dir: Path, compare: list[Path] | None = None, transcripts=None,
          since: str | None = None, until: str | None = None,
          site_label: str | None = None, session=None) -> dict:
    scorer_start = dt.datetime.now(dt.timezone.utc)
    run_dir = Path(run_dir).resolve()
    project = read_json(run_dir / "project.json")
    sections = {"identity": score_identity(run_dir, project, site_label),
                "cost": None,
                "library": score_library(run_dir, project),
                "coverage": score_coverage(run_dir),
                "conformance": score_conformance(run_dir, project)}
    sections["accuracy"] = score_accuracy(run_dir)
    sections["repeatability"] = score_repeatability(
        run_dir, [Path(p).resolve() for p in compare or []], sections["accuracy"])
    sections["schemaChurn"] = score_schema_churn(run_dir, project)
    sections["foundationsVoice"] = {
        "status": "scored-later",
        "reason": "Scored by a person against the foundations-and-voice rubric after the run.",
        "rubric": None, "scores": [], "scorers": []}
    # Cost last, so the scorer's own running time is inside the benchmark step it reports.
    sections["cost"] = score_cost(run_dir, project,
                                  [transcripts] if isinstance(transcripts, (str, Path)) else transcripts,
                                  since, until, session, (scorer_start, dt.datetime.now(dt.timezone.utc)))
    sections["blindedJudgement"] = {
        "status": "scored-later",
        "reason": "Scored 1 to 5 by people who do not know which run or version produced the file.",
        "scale": {"min": 1, "max": 5},
        "criteria": [{"id": key, "label": label} for key, label in BLINDED_CRITERIA],
        "scores": [], "scorers": []}
    return {"scorecardVersion": SCORECARD_VERSION, "generatedAt": now(),
            "generator": f"design-lab {plugin_version()}",
            "run": {"directory": str(run_dir), "name": run_dir.name,
                    "siteLabel": (sections["identity"].get("fields") or {}).get("siteLabel")
                    or run_dir.name},
            "headline": headline(sections), "sections": sections}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("run", type=Path, help="run workspace holding project.json")
    parser.add_argument("--compare", type=Path, nargs="+", default=[],
                        help="other run workspaces of the same site, for repeatability")
    parser.add_argument("--session", nargs="+", help="Claude session id(s) that ran the build, or "
                        "`current` for the newest session in the run's recorded transcript folder; "
                        "subagent transcripts are included and nothing else is counted")
    parser.add_argument("--transcripts", type=Path, nargs="+",
                        help="transcript files (each with its subagents) or a folder, which is "
                        "cut to the run's time window")
    parser.add_argument("--since", help="start of the transcript window (default: run start)")
    parser.add_argument("--until", help="end of the transcript window (default: last evidence)")
    parser.add_argument("--site-label", help="override the site label shown in the report")
    parser.add_argument("--out", type=Path, help="output folder: outside the run, or the run's own "
                        "benchmark/ folder (the default)")
    parser.add_argument("--no-html", action="store_true", help="write scorecard.json only")
    args = parser.parse_args(argv)
    if not args.run.is_dir():
        parser.error(f"run directory not found: {args.run}")
    run = args.run.resolve()
    out = (args.out or run / BENCHMARK_DIR).resolve()
    if (out == run or run in out.parents) and out != run / BENCHMARK_DIR:
        parser.error(f"--out must be outside the run, or the run's own {BENCHMARK_DIR}/ folder; "
                     "apart from recording the benchmark's end in the phase log, scoring never writes "
                     "anywhere else in a run")
    scorecard = score(args.run, args.compare, args.transcripts, args.since, args.until,
                      args.site_label, args.session)
    errors = validate_scorecard(scorecard)
    if errors:
        print("scorecard does not match schemas/scorecard.schema.json:\n  " + "\n  ".join(errors[:20]),
              file=sys.stderr)
        return 2
    # The benchmark ends when its report is finished, rendering included. When this scoring fixes
    # the end, the report is rendered once to time it, the end is set to when a second render of the
    # same length will finish, and that second render is written; the first scoring records the
    # end, so re-scores keep it.
    clock = scorecard["sections"]["cost"]["clock"]
    html = None
    if not args.no_html:
        import score_report
        html = score_report.render(scorecard, run)
        if clock.get("benchmarkEndSource") == "this scoring":
            began = time.monotonic()
            score_report.render(scorecard, run)
            took = dt.timedelta(seconds=time.monotonic() - began)
            finish_clock(clock, dt.datetime.now(dt.timezone.utc) + took)
            html = score_report.render(scorecard, run)
    elif clock.get("benchmarkEndSource") == "this scoring":
        finish_clock(clock, dt.datetime.now(dt.timezone.utc))
    finished = record_benchmark_end(run, clock)
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / "scorecard.json", scorecard)
    written = [str(out / "scorecard.json")]
    if html is not None:
        (out / "report.html").write_text(html, encoding="utf-8")
        written.append(str(out / "report.html"))
        message = completion_message(scorecard, out / "report.html")
        (out / "completion.md").write_text(message, encoding="utf-8")
        written.append(str(out / "completion.md"))
        print(message)
    if finished:
        # The benchmark is the run's last step: stop its runner server, so the next run's
        # preflight does not find it still active.
        import figma_runner
        stopped = figma_runner.stop_server(run)
        if stopped["stopped"]:
            written.append(f"stopped the runner server (process {stopped['pid']})")
    print(json.dumps({"written": written}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
