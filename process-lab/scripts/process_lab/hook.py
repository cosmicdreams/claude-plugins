"""Claude Code hook handlers. All output is optional context."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from . import detect, gates, ledger, manifest, status


def output(event, context=None, decision=None, reason=None):
    if not context and not decision:
        return None
    specific = {"hookEventName": event}
    if context:
        specific["additionalContext"] = context[:1199]
    if decision:
        specific["permissionDecision"] = decision
        specific["permissionDecisionReason"] = reason or context or "Process check failed"
    return {"hookSpecificOutput": specific}


def _resolve(base, value):
    if not value or "$" in value or "`" in value or value.startswith("~"):
        return None
    path = (Path(base) / value).resolve()
    return path if path.is_dir() else None


def _open_obligations(data, gate, ticket, branch, stream=None, entries=None):
    if ticket is None:
        return
    if stream is None:
        with ledger.locked() as stream:
            if stream is not None:
                _open_obligations(data, gate, ticket, branch, stream, ledger.read_locked(stream))
        return
    existing = status.obligation_state(entries, data["jira"]["project"], ticket)
    for obligation in gate["obligations"]:
        key = (gate["id"], obligation["id"])
        if key not in existing:
            entry = ledger.write(stream, data["jira"]["project"], ticket, branch, "obligation_opened", gate=gate["id"], obligation=obligation["id"], text=obligation["text"])
            entries.append(entry)
            existing[key] = {"state": "open", "text": obligation["text"]}


def run(kind, payload):
    cwd = Path(payload.get("cwd") or os.getcwd()).resolve()
    data, repo = manifest.load_manifest(cwd)
    if data is None:
        return None
    event_name = {"pre": "PreToolUse", "post": "PostToolUse", "session": "SessionStart"}[kind]
    cache = gates.load_cache(repo, data["confluence"]["pages"]["process"])
    project = data["jira"]["project"]
    if kind == "session":
        branch = detect.current_branch(cwd)
        ticket = detect.ticket_from(branch, project)
        lines = ["process-lab mode: " + data["mode"], *data.get("warnings", [])]
        if cache is None:
            lines.append("Process cache missing or for a different page; run process-lab:initialize.")
            return output(event_name, "\n".join(lines))
        synced = datetime.fromisoformat(cache["synced_at"].replace("Z", "+00:00"))
        if (datetime.now(timezone.utc) - synced).days >= 14:
            lines.append("Process cache is older than 14 days; run process-lab:initialize.")
        if ticket:
            outstanding = status.summarize(project, ticket)["outstanding"]
            items = [(gate, item) for gate, values in outstanding.items() for item in values]
            for gate, item in items[:5]:
                lines.append(gate + ": " + item["text"])
            if len(items) > 5:
                lines.append("More outstanding obligations: run process-lab:lint.")
        else:
            lines.append("No ticket key found on the branch.")
        return output(event_name, "\n".join(lines))
    command = payload.get("tool_input", {}).get("command", "")
    if not isinstance(command, str):
        return None
    response = payload.get("tool_response")
    if kind == "post" and isinstance(response, dict) and (response.get("isError") is True or response.get("exit_code", response.get("exitCode", 0)) != 0):
        return None
    matches = detect.detect(command, data["conventions"]["test_commands"])
    contexts = []
    effective = cwd
    branch_override = None
    # One lock protects the whole post-hook read, existence check, and append.
    if kind == "post":
        with ledger.locked() as stream:
            if stream is None:
                return None
            entries = ledger.read_locked(stream)
            return _process(matches, kind, effective, branch_override, stream, entries, contexts, event_name)
    return _process(matches, kind, effective, branch_override, None, None, contexts, event_name)


def _process(matches, kind, effective, branch_override, stream, entries, contexts, event_name):
    for match in matches:
        if match["detected_by"] == "cd":
            effective = _resolve(effective, match.get("path")) if match["certain"] else None
            branch_override = None
            continue
        if effective is None:
            continue
        segment_dir = _resolve(effective, match["git_dir"]) if match.get("git_dir") else effective
        if segment_dir is None:
            continue
        data, repo = manifest.load_manifest(segment_dir)
        if data is None:
            continue
        cache = gates.load_cache(repo, data["confluence"]["pages"]["process"])
        if cache is None:
            continue
        project = data["jira"]["project"]
        branch = match.get("branch") or branch_override or detect.current_branch(segment_dir)
        ticket = detect.ticket_from(branch, project)
        if kind == "post" and not match["certain"]:
            continue
        for gate in cache.get("gates", []):
            if gate["detected_by"] != match["detected_by"]:
                continue
            if kind == "pre":
                check, detail = None, None
                if match["detected_by"] == "branch-created":
                    pattern = manifest.branch_pattern(data)
                    if pattern and not manifest.bounded_fullmatch(pattern, branch or ""):
                        check, detail = "branch_pattern", "Branch must match " + data["conventions"]["branch_pattern"]
                elif match["detected_by"] == "commit" and match["message"] is not None and ticket and ticket not in match["message"]:
                    check, detail = "commit_message", "Commit message must contain " + ticket
                if check:
                    ledger.append(project, ticket, branch, "check_failed", gate=gate["id"], check=check, detail=detail)
                    if data["mode"] == "enforce":
                        return output(event_name, detail, "deny", detail)
                    contexts.append(detail)
            else:
                entry = ledger.write(stream, project, ticket, branch, "gate_crossed", gate=gate["id"], detected_by=match["detected_by"])
                entries.append(entry)
                _open_obligations(data, gate, ticket, branch, stream, entries)
                if ticket:
                    state = status.obligation_state(entries, project, ticket)
                    items = [o["text"] for o in gate["obligations"] if state.get((gate["id"], o["id"]), {}).get("state") == "open"]
                    if items:
                        contexts.append(gate["label"] + " (" + ticket + "): " + "; ".join(items) + ". Discharge with process-lab:advance or waive with a reason.")
                else:
                    contexts.append(gate["label"] + ": no ticket key was found on the branch; no ticket obligations opened.")
        if match.get("switches") and match["certain"]:
            branch_override = branch
    return output(event_name, "\n".join(contexts))


def hook_main(kind):
    try:
        payload = json.load(__import__("sys").stdin)
        if not isinstance(payload, dict):
            return 0
        try:
            result = run(kind, payload)
        except manifest.ManifestError as exc:
            result = output({"pre": "PreToolUse", "post": "PostToolUse", "session": "SessionStart"}[kind], "process-lab: invalid project manifest (" + str(exc)[:120] + ").")
        if result:
            print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        ledger.log_error(exc)
    return 0
