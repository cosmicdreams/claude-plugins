#!/usr/bin/env python3
"""drover.create_tickets — turn a sidecar JSON into JIRA tickets.

Reads:
  - <project>/.drover/manifest.json (jira: {project_key, board_id,
    default_sprint_id, default_issue_type})
  - The sidecar JSON emitted by /drover:report
    (reports/<month>-<template>.md.tickets.json)

Creates one JIRA issue per spec. Each created issue carries:
  - Title, description, labels, priority from the spec
  - Issue type from manifest.jira.default_issue_type
  - Project from manifest.jira.project_key
  - Sprint assignment to manifest.jira.default_sprint_id (or override)
  - Optional parent issue link via --parent <KEY>

Three execution paths (drover stays agnostic about the mechanism):

  --dry-run            print what would be created, no side effects
  --plan PATH          write a structured plan JSON to PATH; do not call
                       any API. The plan is the handoff contract for an
                       executor — direct REST, jira-cli, Atlassian MCP,
                       or manual paste — whichever the operator prefers.
  --all                use drover's built-in REST executor; create
                       everything without per-ticket prompts.
  --interactive        same REST executor; prompt before each ticket.
                       (default)

Other flags:
  --filter PATTERN     only process specs whose title matches the regex
  --priority NAME      override every ticket's priority
  --type NAME          override every ticket's issue type
  --sprint ID          override the manifest's default sprint id
                       (use 'none' to skip sprint assignment)
  --parent KEY         link every created issue to <KEY> with 'Relates'

CLI:
  python3 create_tickets.py [--project ROOT] [--sidecar PATH] ...
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# Sibling import — same pattern report.py uses.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import jira_api  # noqa: E402


DEFAULT_LINK_TYPE = "Relates"


# --- Manifest + sidecar helpers ------------------------------------------

def load_manifest(project_root: Path) -> dict:
    p = project_root / ".drover" / "manifest.json"
    if not p.exists():
        raise FileNotFoundError(
            f"No manifest at {p}. Run /drover:init first."
        )
    return json.loads(p.read_text())


def load_sidecar(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(
            f"No sidecar at {path}. "
            "Run /drover:report --template root-cause-summary first."
        )
    data = json.loads(path.read_text())
    if not isinstance(data, list):
        raise ValueError(
            f"Expected a JSON list of ticket specs in {path}; got "
            f"{type(data).__name__}"
        )
    return data


def find_default_sidecar(project_root: Path) -> Path | None:
    """Return the most recently-modified .tickets.json under reports/."""
    reports_dir = project_root / "reports"
    if not reports_dir.is_dir():
        return None
    candidates = sorted(
        reports_dir.glob("*.tickets.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


# --- Spec → JIRA fields mapping ------------------------------------------

def jira_priority_from_drover(p: str) -> str | None:
    """drover emits P0/P1/P2/P3 priorities; JIRA Cloud's defaults are
    Highest/High/Medium/Low/Lowest. Map them. Some tenants have custom
    priority schemes — when in doubt, return None and let JIRA pick the
    project default."""
    return {
        "P0": "Highest",
        "P1": "High",
        "P2": "Medium",
        "P3": "Low",
        "P4": "Lowest",
    }.get(p.upper() if p else "")


# --- Plan: what we'd do per spec -----------------------------------------

def plan_for_spec(
    spec: dict,
    *,
    project_key: str,
    issue_type: str,
    priority_override: str | None,
) -> dict:
    """Build the JIRA-create payload preview for one spec."""
    pri = priority_override or jira_priority_from_drover(
        spec.get("priority", "")
    )
    return {
        "fingerprint": spec.get("fingerprint"),
        "title": spec.get("title", ""),
        "issue_type": issue_type,
        "priority": pri,
        "labels": list(spec.get("labels") or []),
        "description_chars": len(spec.get("description", "") or ""),
    }


# --- Structured plan (executor-agnostic handoff) -------------------------

def build_plan(
    specs: list[dict],
    *,
    project_key: str,
    issue_type: str,
    sprint_id: int | None,
    sprint_name: str | None,
    parent_key: str | None,
    priority_override: str | None,
    server: str | None = None,
) -> dict:
    """Return an executor-agnostic plan describing the work to be done.

    The plan is the contract drover hands to whatever JIRA mechanism the
    operator prefers: drover's built-in REST executor, the Atlassian MCP
    server, jira-cli, a future paste-into-web-UI helper. Each `tickets`
    entry has a self-contained `issue` block plus optional `sprint` and
    `parent` directives.

    Stable schema — additive evolution only. Fields downstream consumers
    rely on:

      instance.server                           Atlassian instance URL
      tickets[].spec_fingerprint                drover-side identity
      tickets[].issue.{project_key, type,
                       summary, description,
                       priority, labels}        creation payload
      tickets[].sprint.{id, name}               sprint assignment (optional)
      tickets[].parent.{key, link_type}         parent linking (optional)
    """
    tickets: list[dict] = []
    for spec in specs:
        pri = priority_override or jira_priority_from_drover(
            spec.get("priority", "")
        )
        ticket = {
            "spec_fingerprint": spec.get("fingerprint", ""),
            "issue": {
                "project_key": project_key,
                "type": issue_type,
                "summary": spec.get("title", ""),
                "description": spec.get("description", "") or "",
                "priority": pri,
                "labels": list(spec.get("labels") or []),
            },
        }
        if sprint_id:
            ticket["sprint"] = {"id": sprint_id}
            if sprint_name:
                ticket["sprint"]["name"] = sprint_name
        if parent_key:
            ticket["parent"] = {
                "key": parent_key,
                "link_type": DEFAULT_LINK_TYPE,
            }
        tickets.append(ticket)

    return {
        "drover_plan_version": 1,
        "instance": {"server": server} if server else {},
        "context": {
            "project_key": project_key,
            "default_issue_type": issue_type,
            "default_sprint_id": sprint_id,
            "default_sprint_name": sprint_name,
            "default_parent_key": parent_key,
        },
        "tickets": tickets,
    }


# --- Orchestrator --------------------------------------------------------

class Outcome:
    """One result row per spec."""

    __slots__ = ("fingerprint", "title", "key", "url", "status", "reason")

    def __init__(self, fingerprint: str, title: str):
        self.fingerprint = fingerprint
        self.title = title
        self.key: str | None = None
        self.url: str | None = None
        self.status: str = "pending"
        self.reason: str | None = None

    def to_dict(self) -> dict:
        return {
            "fingerprint": self.fingerprint,
            "title": self.title,
            "key": self.key,
            "url": self.url,
            "status": self.status,
            "reason": self.reason,
        }


def create_one(
    client: jira_api.JiraClient,
    spec: dict,
    *,
    project_key: str,
    issue_type: str,
    sprint_id: int | None,
    parent_key: str | None,
    priority_override: str | None,
) -> Outcome:
    title = spec.get("title", "")
    out = Outcome(spec.get("fingerprint", ""), title)

    pri = priority_override or jira_priority_from_drover(
        spec.get("priority", "")
    )

    try:
        created = client.create_issue(
            project_key=project_key,
            issue_type=issue_type,
            summary=title,
            description=spec.get("description") or "",
            labels=list(spec.get("labels") or []),
            priority=pri,
        )
    except jira_api.JiraAPIError as e:
        out.status = "create-failed"
        out.reason = f"HTTP {e.status}: {e.body[:300]}"
        return out
    except Exception as e:  # noqa: BLE001
        out.status = "create-failed"
        out.reason = f"{type(e).__name__}: {e}"
        return out

    out.key = created.get("key", "")
    out.url = f"{client.server}/browse/{out.key}" if out.key else None

    # Sprint assignment (best-effort — failure is logged, not fatal)
    if sprint_id:
        try:
            client.assign_sprint([out.key], sprint_id)
        except Exception as e:  # noqa: BLE001
            out.reason = (
                f"created OK but sprint-assign failed: "
                f"{type(e).__name__}: {e}"
            )

    # Parent-link (best-effort)
    if parent_key:
        try:
            client.link_issues(
                from_key=out.key, to_key=parent_key,
                link_type=DEFAULT_LINK_TYPE,
            )
        except Exception as e:  # noqa: BLE001
            prior = out.reason or ""
            out.reason = (
                f"{prior + '; ' if prior else ''}"
                f"created OK but parent-link to {parent_key} "
                f"failed: {type(e).__name__}: {e}"
            )

    out.status = "created"
    return out


def filter_specs(
    specs: list[dict], pattern: str | None,
) -> list[dict]:
    if not pattern:
        return specs
    rx = re.compile(pattern, re.IGNORECASE)
    return [s for s in specs if rx.search(s.get("title", ""))]


# --- Interactive prompt --------------------------------------------------

def _prompt_yes_no(question: str, *, default: bool = True) -> bool:
    suffix = " [Y/n] " if default else " [y/N] "
    try:
        ans = input(question + suffix).strip().lower()
    except EOFError:
        return default
    if not ans:
        return default
    return ans.startswith("y")


# --- CLI -----------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="drover-create-tickets",
        description="Create JIRA tickets from a drover sidecar JSON.",
    )
    p.add_argument(
        "--project", type=Path, default=Path.cwd(),
        help="project root (default: cwd; reads .drover/manifest.json)",
    )
    p.add_argument(
        "--sidecar", type=Path, default=None,
        help="path to <report>.tickets.json (default: most recent under "
             "reports/)",
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="show what would be created, do not call JIRA",
    )
    p.add_argument(
        "--plan", type=Path, default=None,
        help="emit a structured plan JSON to PATH; do not call any "
             "API. Use when an external executor (Atlassian MCP, "
             "jira-cli, custom tooling) will perform the writes.",
    )
    p.add_argument(
        "--all", action="store_true",
        help="create every eligible spec without prompting (uses "
             "drover's built-in REST executor)",
    )
    p.add_argument(
        "--filter", default=None,
        help="regex against spec title; only matching specs are processed",
    )
    p.add_argument(
        "--priority", default=None,
        help="JIRA priority name (Highest/High/Medium/Low/Lowest) — "
             "overrides drover-suggested priority for every spec",
    )
    p.add_argument(
        "--type", dest="issue_type", default=None,
        help="JIRA issue type name — overrides manifest default",
    )
    p.add_argument(
        "--sprint", default=None,
        help="sprint id to assign to (or 'none' to skip); default "
             "from manifest.jira.default_sprint_id",
    )
    p.add_argument(
        "--parent", default=None,
        help="link each created issue to this issue key with 'Relates'",
    )
    return p.parse_args(argv)


def cli_main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    project_root = args.project.resolve()

    try:
        manifest = load_manifest(project_root)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    jira_cfg = manifest.get("jira") or {}
    project_key = jira_cfg.get("project_key")
    if not project_key:
        print(
            "ERROR: manifest.jira.project_key not set. Edit "
            f"{project_root / '.drover' / 'manifest.json'} or run "
            f"/drover:init.",
            file=sys.stderr,
        )
        return 2

    issue_type = (
        args.issue_type
        or jira_cfg.get("default_issue_type")
        or "Task"
    )

    if args.sprint == "none":
        sprint_id: int | None = None
    elif args.sprint:
        try:
            sprint_id = int(args.sprint)
        except ValueError:
            print(f"ERROR: --sprint must be an integer or 'none'.",
                  file=sys.stderr)
            return 2
    else:
        sprint_id = jira_cfg.get("default_sprint_id")

    sidecar_path = args.sidecar or find_default_sidecar(project_root)
    if not sidecar_path:
        print(
            "ERROR: no sidecar JSON found. Pass --sidecar PATH or run "
            "/drover:report --template root-cause-summary first.",
            file=sys.stderr,
        )
        return 2

    try:
        specs = load_sidecar(sidecar_path)
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    specs = filter_specs(specs, args.filter)

    if not specs:
        print("No ticket specs to process.")
        return 0

    print(f"sidecar: {sidecar_path}")
    print(f"project: {project_key}  type: {issue_type}  "
          f"sprint: {sprint_id or '(none)'}  parent: {args.parent or '(none)'}")
    print(f"specs: {len(specs)}")
    print()

    # Build the plan — printable preview before any API call.
    plans = [
        plan_for_spec(
            s, project_key=project_key, issue_type=issue_type,
            priority_override=args.priority,
        )
        for s in specs
    ]
    for i, p in enumerate(plans, start=1):
        print(
            f"  {i}. [{p['priority'] or 'default'}] "
            f"({p['issue_type']}) {p['title']}"
        )
        if p["labels"]:
            print(f"       labels: {', '.join(p['labels'])}")
    print()

    if args.dry_run:
        print("[dry-run] not creating anything; exiting.")
        return 0

    if args.plan:
        # Resolve server (best-effort) so the plan tells the executor
        # which Atlassian instance to talk to. We don't hold creds.
        server = (jira_cfg.get("server") or "").rstrip("/")
        if not server:
            try:
                creds = jira_api.resolve_credentials(jira_cfg)
                server = creds["server"]
            except FileNotFoundError:
                server = None
        plan = build_plan(
            specs,
            project_key=project_key,
            issue_type=issue_type,
            sprint_id=sprint_id,
            sprint_name=jira_cfg.get("default_sprint_name"),
            parent_key=args.parent,
            priority_override=args.priority,
            server=server,
        )
        args.plan.parent.mkdir(parents=True, exist_ok=True)
        args.plan.write_text(json.dumps(plan, indent=2, sort_keys=True))
        print(f"[plan] wrote {args.plan}")
        print(
            f"[plan] {len(plan['tickets'])} ticket(s) ready for an "
            f"external executor (Atlassian MCP, jira-cli, custom)."
        )
        return 0

    # Resolve credentials; fail fast if anything's missing.
    try:
        client = jira_api.JiraClient(manifest_jira=jira_cfg)
        client.myself()  # smoke test
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    except jira_api.JiraAPIError as e:
        print(
            f"ERROR: JIRA auth failed (HTTP {e.status}). Check that "
            f"JIRA_API_TOKEN is the correct token for {client.server} "
            f"and that the email matches.",
            file=sys.stderr,
        )
        return 2

    if not args.all:
        if not _prompt_yes_no(
            f"Create {len(specs)} ticket(s) in {project_key}?",
        ):
            print("Aborted.")
            return 0

    outcomes: list[Outcome] = []
    for spec in specs:
        if not args.all:
            if not _prompt_yes_no(
                f"  Create '{spec.get('title', '')[:80]}'?",
            ):
                outcomes.append(Outcome(
                    spec.get("fingerprint", ""), spec.get("title", ""),
                ))
                outcomes[-1].status = "skipped"
                continue
        out = create_one(
            client, spec,
            project_key=project_key,
            issue_type=issue_type,
            sprint_id=sprint_id,
            parent_key=args.parent,
            priority_override=args.priority,
        )
        outcomes.append(out)
        marker = "+" if out.status == "created" else "!"
        print(f"  {marker} {out.status:>13}: {out.key or '-'}  "
              f"{(out.url or '-')}")
        if out.reason:
            print(f"      note: {out.reason}")

    # Summary
    counts: dict[str, int] = {}
    for o in outcomes:
        counts[o.status] = counts.get(o.status, 0) + 1
    print(f"\nDone. " + "  ".join(
        f"{k}={v}" for k, v in sorted(counts.items())
    ))

    # Write a results sidecar so the operator can audit later.
    if sidecar_path:
        results_path = sidecar_path.with_suffix(".created.json")
        results_path.write_text(json.dumps(
            [o.to_dict() for o in outcomes], indent=2,
        ))
        print(f"results: {results_path}")

    return 0 if all(o.status in ("created", "skipped") for o in outcomes) else 1


if __name__ == "__main__":
    sys.exit(cli_main())
