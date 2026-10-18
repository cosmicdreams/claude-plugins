#!/usr/bin/env python3
"""Triage manual test cases into the ingest skill's buckets with Jev.

One Choice per case over the bucket table in skills/ingest/SKILL.md. A
confident answer is a verdict; anything else is handed back for the agent
to classify exactly as it did before Jev existed. When Jev is unavailable
every case comes back as fallback and the agent classifies them all.

Input (stdin): a JSON array of cases, or {"cases": [...], "scope": "..."}.
  case: {"id": str, "title": str, "steps"?: str, "expected"?: str,
         "preconditions"?: str, "section"?: str}
  scope: one or two sentences describing the system under test; it is
         what makes "out of scope" answerable.

Output (stdout): {
  "ok": bool, "reason": str|null, "model": str|null,
  "threshold": float,
  "verdicts": {id: {"bucket": str|null, "source": "jev"|"fallback", ...}},
  "counts": {"jev": n, "fallback": n}
}

  python3 "${CLAUDE_PLUGIN_ROOT}/scripts/triage_cases.py" < cases.json
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

# Starting point. Raise it if confident answers turn out wrong on a real
# corpus; lower it if too many clear cases fall through to the agent.
BUCKET_CONFIDENCE_THRESHOLD = 0.8

# The bucket table from skills/ingest/SKILL.md, verbatim.
BUCKETS = {
    "anonymous front end": "public paths, display and responsiveness assertions",
    "needs authentication": 'administrative paths, "log in", authoring language',
    "form submission": "submits, sends email, captcha",
    "human judgement": '"looks correct", visual comparison, design match',
    "out of scope": "belongs to a subsystem not under test",
}


def bucket_question(scope: str | None) -> dict:
    instructions = {
        "question": (
            "Which triage bucket does this manual test case belong to? Judge "
            "from its title, preconditions, steps, and expected results."
        ),
        "system_under_test": scope or "the website whose test corpus this case belongs to",
    }
    return {"type": "choice", "instructions": instructions, "criteria": dict(BUCKETS)}


def _case_state(case: dict) -> dict:
    state = {"title": str(case.get("title") or "")}
    for key in ("preconditions", "steps", "expected", "section"):
        value = case.get(key)
        if value:
            state[key] = str(value)[:4000]
    return state


def triage(cases: list[dict], scope: str | None = None, **ask_kwargs) -> dict:
    items = {str(c.get("id") or n): _case_state(c) for n, c in enumerate(cases)}
    response = jev.ask_items(items, {"bucket": bucket_question(scope)}, **ask_kwargs)
    verdicts: dict[str, dict] = {}
    counts = {"jev": 0, "fallback": 0}
    for case_id, result in response["results"].items():
        if not result["ok"]:
            record = jev.fallback(result["reason"])
        else:
            record = jev.choice_verdict(
                result["answers"]["bucket"],
                threshold=BUCKET_CONFIDENCE_THRESHOLD, model=response["model"],
            )
            if record["source"] == "jev" and not record["confident"]:
                record = {**record, "source": "fallback", "reason": "low_confidence"}
        record["bucket"] = record.get("choice") if record["source"] == "jev" else None
        counts[record["source"]] += 1
        verdicts[case_id] = record
    return {
        "ok": response["ok"],
        "reason": response["reason"],
        "model": response["model"],
        "threshold": BUCKET_CONFIDENCE_THRESHOLD,
        "verdicts": verdicts,
        "counts": counts,
    }


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError as e:
        print(json.dumps({"ok": False, "reason": "invalid_input", "detail": str(e)}))
        return 2
    if isinstance(payload, list):
        cases, scope = payload, None
    elif isinstance(payload, dict) and isinstance(payload.get("cases"), list):
        cases, scope = payload["cases"], payload.get("scope")
    else:
        print(json.dumps({"ok": False, "reason": "invalid_input",
                          "detail": "expected a list of cases or {cases, scope}"}))
        return 2
    print(json.dumps(triage(cases, scope)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
