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


def _branch_and_ticket(cwd, project, detected=None):
    branch = detected.get("branch") if detected else None
    branch = branch or detect.current_branch(cwd)
    return branch, detect.ticket_from(branch, project)


def _open_obligations(data, gate, ticket, branch):
    if ticket is None:
        return
    existing = status.obligation_state(ledger.read(), data["jira"]["project"], ticket)
    for obligation in gate["obligations"]:
        key = (gate["id"], obligation["id"])
        if key not in existing:
            ledger.append(data["jira"]["project"], ticket, branch, "obligation_opened", gate=gate["id"], obligation=obligation["id"], text=obligation["text"])
            existing[key] = {"state": "open", "text": obligation["text"]}


def run(kind, payload):
    cwd = payload.get("cwd") or os.getcwd()
    data, repo = manifest.load_manifest(cwd)
    if data is None:
        return None
    event_name = {"pre": "PreToolUse", "post": "PostToolUse", "session": "SessionStart"}[kind]
    cache = gates.load_cache(repo)
    project = data["jira"]["project"]
    if kind == "session":
        branch, ticket = _branch_and_ticket(cwd, project)
        lines = ["process-lab mode: " + data["mode"]]
        if cache is None:
            lines.append("Process cache missing; run process-lab:initialize.")
        else:
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
    if cache is None:
        return None
    command = payload.get("tool_input", {}).get("command", "")
    if not isinstance(command, str):
        return None
    matches = detect.detect(command, data["conventions"]["test_commands"])
    by_detection = {}
    for gate in cache.get("gates", []):
        by_detection.setdefault(gate["detected_by"], []).append(gate)
    contexts = []
    for match in matches:
        branch, ticket = _branch_and_ticket(cwd, project, match)
        for gate in by_detection.get(match["detected_by"], []):
            if kind == "pre":
                check, detail = None, None
                if match["detected_by"] == "branch-created":
                    pattern = manifest.branch_pattern(data)
                    if pattern and not pattern.fullmatch(branch or ""):
                        check, detail = "branch_pattern", "Branch must match " + data["conventions"]["branch_pattern"]
                elif match["detected_by"] == "commit" and match["message"] is not None and ticket and ticket not in match["message"]:
                    check, detail = "commit_message", "Commit message must contain " + ticket
                if check:
                    ledger.append(project, ticket, branch, "check_failed", gate=gate["id"], check=check, detail=detail)
                    if data["mode"] == "enforce":
                        return output(event_name, detail, "deny", detail)
                    contexts.append(detail)
            elif kind == "post":
                ledger.append(project, ticket, branch, "gate_crossed", gate=gate["id"], detected_by=match["detected_by"])
                _open_obligations(data, gate, ticket, branch)
                if ticket:
                    state = status.obligation_state(ledger.read(), project, ticket)
                    items = [o["text"] for o in gate["obligations"] if state.get((gate["id"], o["id"]), {}).get("state") == "open"]
                    if items:
                        contexts.append(gate["label"] + " (" + ticket + "): " + "; ".join(items) + ". Discharge with process-lab:advance or waive with a reason.")
                else:
                    contexts.append(gate["label"] + ": no ticket key was found on the branch; no ticket obligations opened.")
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
