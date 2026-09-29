#!/usr/bin/env python3
"""CLI for the local process-lab runtime."""
import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

from process_lab import detect, gates, hook, ledger, manifest, status


def context(cwd):
    data, repo = manifest.load_manifest(cwd)
    if data is None:
        raise ValueError("no .velir/project.json found")
    return data, repo


def ticket_for(data, cwd, specified):
    ticket = specified or detect.ticket_from(detect.current_branch(cwd), data["jira"]["project"])
    if not ticket:
        raise ValueError("no ticket key found; pass --ticket")
    if not detect.ticket_from(ticket, data["jira"]["project"]) == ticket:
        raise ValueError("ticket does not match Jira project")
    return ticket


def emit(value, as_json=False):
    if as_json or isinstance(value, (dict, list)):
        print(json.dumps(value, ensure_ascii=False, indent=2))
    else:
        print(value)


def main(argv=None):
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    hook_parser = commands.add_parser("hook")
    hook_parser.add_argument("kind", choices=("pre", "post", "session"))
    sync = commands.add_parser("sync")
    sync.add_argument("--page-file", required=True)
    sync.add_argument("--page-id", type=int, required=True)
    sync.add_argument("--page-version", type=int, required=True)
    sync.add_argument("--cwd", default=os.getcwd())
    stat = commands.add_parser("status")
    stat.add_argument("--ticket")
    stat.add_argument("--cwd", default=os.getcwd())
    stat.add_argument("--json", action="store_true")
    for name in ("discharge", "waive"):
        action = commands.add_parser(name)
        action.add_argument("--gate", required=True)
        action.add_argument("--obligation", required=True)
        action.add_argument("--ticket")
        action.add_argument("--actor", choices=("agent", "human"), default="agent")
        action.add_argument("--evidence" if name == "discharge" else "--reason", required=True)
    declare = commands.add_parser("declare")
    declare.add_argument("--gate", required=True)
    declare.add_argument("--ticket")
    retro = commands.add_parser("report")
    retro.add_argument("--since", required=True)
    retro.add_argument("--until")
    retro.add_argument("--project")
    retro.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if args.command == "hook":
        return hook.hook_main(args.kind)
    if args.command == "report":
        date.fromisoformat(args.since)
        if args.until:
            date.fromisoformat(args.until)
        emit(status.report(args.since, args.until, args.project), args.json)
        return 0
    cwd = getattr(args, "cwd", os.getcwd())
    data, repo = context(cwd)
    project = data["jira"]["project"]
    if args.command == "sync":
        if args.page_id != data["confluence"]["pages"]["process"]:
            raise ValueError("page id does not match manifest")
        if args.page_version < 1:
            raise ValueError("page version must be positive")
        parsed, warnings = gates.parse_page(Path(args.page_file).read_text(encoding="utf-8"))
        cache = gates.save_cache(repo, args.page_id, args.page_version, parsed, warnings)
        emit({"gates": cache["gates"], "warnings": warnings}, True)
        return 0
    ticket = ticket_for(data, cwd, getattr(args, "ticket", None))
    if args.command == "status":
        summary = status.summarize(project, ticket)
        if args.json:
            emit(summary, True)
        else:
            lines = [ticket + ": " + str(summary["gates_crossed"]) + " gates crossed, " + str(summary["checks_failed"]) + " checks failed"]
            for gate, obligations in summary["outstanding"].items():
                lines.extend(gate + ": " + item["text"] for item in obligations)
            emit("\n".join(lines))
        return 0
    cache = gates.load_cache(repo)
    if cache is None:
        raise ValueError("process cache missing; run process-lab:initialize")
    gate = next((item for item in cache["gates"] if item["id"] == args.gate), None)
    if gate is None:
        raise ValueError("unknown gate: " + args.gate)
    branch = detect.current_branch(cwd)
    if args.command == "declare":
        if gate["detected_by"] != "declared":
            raise ValueError("gate is not declared")
        ledger.append(project, ticket, branch, "gate_declared", gate=gate["id"], actor="agent")
        hook._open_obligations(data, gate, ticket, branch)
        emit(status.summarize(project, ticket), True)
        return 0
    if not any(item["id"] == args.obligation for item in gate["obligations"]):
        raise ValueError("unknown obligation: " + args.obligation)
    value = args.evidence if args.command == "discharge" else args.reason
    if not value.strip():
        raise ValueError(("evidence" if args.command == "discharge" else "reason") + " must be non-empty")
    current = status.obligation_state(ledger.read(), project, ticket).get((gate["id"], args.obligation))
    if current is None or current["state"] != "open":
        raise ValueError("obligation is not open")
    field = "evidence" if args.command == "discharge" else "reason"
    ledger.append(project, ticket, branch, "obligation_discharged" if args.command == "discharge" else "obligation_waived", gate=gate["id"], obligation=args.obligation, actor=args.actor, **{field: value.strip()})
    emit(status.summarize(project, ticket), True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print("process-lab: " + str(exc), file=sys.stderr)
        sys.exit(1)
