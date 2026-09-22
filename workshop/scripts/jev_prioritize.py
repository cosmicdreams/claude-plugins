#!/usr/bin/env python3
"""Jev action classification for workshop:prioritize steps 2 and 3.

One Choice per Slack or Jira candidate: RESPOND / REVIEW / FYI for Slack,
RESPOND / DUE / UNBLOCK / REVIEW / FYI for Jira. Items are packed several
per request. Deterministic facts stay deterministic: a due date at or
before today, a Blocked status or Blocker priority, and a direct mention
of the user each set a floor the Jev answer cannot lower. A confident Jev
answer above the floor wins; an unconfident one leaves the item to the
subagent, which classifies it exactly as before. When Jev is unavailable
every item is fallback.

Input (stdin): {
  "source": "slack" | "jira",
  "today": "YYYY-MM-DD",                       # jira only, user's local date
  "user": {"user_id"?: str, "keywords"?: [...]},
  "items": [{"id": str, "summary": str, "excerpt"?: str, "detail"?: str,
             "stale"?: bool, "mentions_user"?: bool, "unanswered"?: bool,
             "due_date"?: "YYYY-MM-DD", "overdue"?: bool, "status"?: str,
             "priority"?: str, "blocked"?: bool, "last_comment_by_other"?: bool}]
}
Output (stdout): {"ok", "reason", "model", "threshold", "items": [
  {"id", "action": str|null, "action_source": "jev"|"rule"|"fallback",
   "floor": str|null, "jev": {...}}], "counts": {"jev": n, "rule": n, "fallback": n}}
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("jev_client", _HERE / "jev_client.py")
jev = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(jev)

# Starting point to tune against real prioritize runs.
ACTION_CONFIDENCE_THRESHOLD = 0.7

# Same ordering as prioritize/scripts/output.py BASE: higher wins on merge.
RANK = {"RESPOND": 5, "DUE": 4, "UNBLOCK": 3, "REVIEW": 2, "FYI": 1}

SLACK_CRITERIA = {
    "RESPOND": "Someone asked the user something directly, mentioned them, or an urgent or unanswered request needs their reply",
    "REVIEW": "Shares a link, deploy, pull request, or keyword-matched topic that the user should look at but not necessarily answer",
    "FYI": "General activity worth knowing about; no reply or review expected from the user",
}
JIRA_CRITERIA = {
    "RESPOND": "The last comment asks the user something, or the user was just assigned and someone is waiting on them",
    "DUE": "An unfinished issue assigned to the user is due today or overdue",
    "UNBLOCK": "The issue is blocked, carries Blocker priority, or is flagged as blocking other work",
    "REVIEW": "The issue sits in a review-like status, has stalled in progress, or has new comments from others that may need the user's input",
    "FYI": "Updated, but nothing is expected from the user",
}


def action_question(source: str, user: dict) -> dict:
    criteria = JIRA_CRITERIA if source == "jira" else SLACK_CRITERIA
    return {
        "type": "choice",
        "instructions": {
            "question": f"What does this {source} item need from the user today?",
            "user": {"user_id": user.get("user_id"), "review_keywords": user.get("keywords") or []},
        },
        "criteria": dict(criteria),
    }


def rule_floor(source: str, item: dict, today: str | None) -> str | None:
    """The deterministic part of today's classification rules."""
    floors = []
    if item.get("mentions_user"):
        floors.append("RESPOND")
    if source == "jira":
        due = item.get("due_date")
        if item.get("overdue") or (due and today and str(due) <= today):
            floors.append("DUE")
        status = str(item.get("status") or "").lower()
        priority = str(item.get("priority") or "").lower()
        if item.get("blocked") or "blocked" in status or priority == "blocker":
            floors.append("UNBLOCK")
    if not floors:
        return None
    return max(floors, key=RANK.__getitem__)


def _item_state(item: dict) -> dict:
    keep = ("summary", "excerpt", "detail", "stale", "mentions_user", "unanswered",
            "due_date", "overdue", "status", "priority", "blocked", "last_comment_by_other",
            "source", "scope")
    return {k: item[k] for k in keep if item.get(k) is not None}


def classify(payload: dict, **ask_kwargs) -> dict:
    source = payload.get("source") or "slack"
    user = payload.get("user") or {}
    today = payload.get("today")
    items = payload.get("items") or []
    keyed = {str(it.get("id") or n): _item_state(it) for n, it in enumerate(items)}
    response = jev.ask_items(keyed, {"action": action_question(source, user)}, **ask_kwargs)
    out_items = []
    counts = {"jev": 0, "rule": 0, "fallback": 0}
    for n, item in enumerate(items):
        key = str(item.get("id") or n)
        result = response["results"].get(key) or {"ok": False, "reason": response["reason"]}
        floor = rule_floor(source, item, today)
        if result["ok"]:
            record = jev.choice_verdict(result["answers"]["action"],
                                        threshold=ACTION_CONFIDENCE_THRESHOLD, model=response["model"])
        else:
            record = jev.fallback(result["reason"])
        if record["source"] == "jev" and record["confident"]:
            action = record["choice"]
            if floor and RANK[floor] > RANK[action]:
                action, action_source = floor, "rule"
            else:
                action_source = "jev"
        elif floor:
            action, action_source = floor, "rule"
            if record["source"] == "jev":
                record = {**record, "source": "fallback", "reason": "low_confidence"}
        else:
            action, action_source = None, "fallback"
            if record["source"] == "jev":
                record = {**record, "source": "fallback", "reason": "low_confidence"}
        counts[action_source] += 1
        out_items.append({"id": item.get("id"), "action": action, "action_source": action_source,
                          "floor": floor, "jev": record})
    return {
        "ok": response["ok"],
        "reason": response["reason"],
        "model": response["model"],
        "threshold": ACTION_CONFIDENCE_THRESHOLD,
        "items": out_items,
        "counts": counts,
    }


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError as e:
        print(json.dumps({"ok": False, "reason": "invalid_input", "detail": str(e)}))
        return 2
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list) \
            or payload.get("source") not in ("slack", "jira"):
        print(json.dumps({"ok": False, "reason": "invalid_input",
                          "detail": "expected {source: slack|jira, items: [...]}"}))
        return 2
    print(json.dumps(classify(payload)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
