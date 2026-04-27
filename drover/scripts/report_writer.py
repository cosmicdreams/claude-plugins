"""Helpers for invoking and validating the report-writer agent.

The agent itself is defined in drover/agents/report-writer.md and is
spawned via Claude Code's Task tool from inside /drover:report.
This module handles the deterministic parts:
  - Building the structured input the agent expects.
  - Validating the JSON the agent emits before splicing it into a
    template.
  - Computing coverage metadata (expected_days, present_days, etc.)
    from a coverage ledger and a date range.

No LLM call happens here — `synthesize_section` delegates the actual
agent invocation to a `runner` callable so unit tests can mock it
and the report skill can wire it to whatever Task-based mechanism
Claude Code currently uses.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Callable, Optional


# --- Section catalogue -----------------------------------------------------

@dataclass
class SectionSpec:
    id: str
    template: str
    audience: str           # "stakeholder" | "dev"
    max_words: int
    tone: str = "professional, direct, plain-language"
    extra: dict = field(default_factory=dict)


KNOWN_SECTIONS: dict[str, SectionSpec] = {
    "executive_summary": SectionSpec(
        id="executive_summary",
        template="monthly-client",
        audience="stakeholder",
        max_words=120,
    ),
    "top_issues": SectionSpec(
        id="top_issues",
        template="monthly-client",
        audience="stakeholder",
        max_words=400,
        extra={"top_n": 5},
    ),
    "trend_narrative": SectionSpec(
        id="trend_narrative",
        template="monthly-client",
        audience="stakeholder",
        max_words=150,
    ),
    "coverage_caveat": SectionSpec(
        id="coverage_caveat",
        template="monthly-client",
        audience="stakeholder",
        max_words=80,
    ),
    "triage_brief": SectionSpec(
        id="triage_brief",
        template="triage-brief",
        audience="dev",
        max_words=600,
        extra={"top_n": 20, "include_samples": True},
    ),
}


# --- Coverage summary ------------------------------------------------------

def coverage_summary(
    coverage: dict,
    *,
    env: str,
    types: list[str],
    from_date: date,
    to_date: date,
) -> dict:
    """Reduce the coverage ledger to a per-section input.

    Returns:
      {
        "expected_days": N,
        "present_days": N,
        "missing_or_failed": [{date, log_type, env, state, reason?}]
      }

    `expected_days` is the number of (date, type) pairs we asked for,
    weighted by len(types). A 30-day window with 3 types expects 90
    pairs; "present_days" is the count of `state=present` entries.
    """
    expected = 0
    present = 0
    missing: list[dict] = []
    cur = from_date
    while cur <= to_date:
        di = cur.isoformat()
        day = coverage.get(di, {})
        for log_type in types:
            expected += 1
            entry = day.get(f"{env}.{log_type}")
            if entry is None:
                missing.append({
                    "date": di,
                    "log_type": log_type,
                    "env": env,
                    "state": "pending",
                    "reason": "no ledger entry",
                })
                continue
            state = entry.get("state")
            if state == "present":
                present += 1
            else:
                missing.append({
                    "date": di,
                    "log_type": log_type,
                    "env": env,
                    "state": state,
                    "reason": entry.get("reason"),
                })
        cur += timedelta(days=1)
    return {
        "expected_days": expected,
        "present_days": present,
        "missing_or_failed": missing,
    }


# --- Input builder ---------------------------------------------------------

def build_section_input(
    section: SectionSpec,
    *,
    project: str,
    env: str,
    month_label: str,
    from_date: date,
    to_date: date,
    aggregation: dict,
    coverage: dict,
) -> dict:
    """Produce the JSON input the report-writer agent receives.

    Trims `aggregation.groups` to the first N for sections that don't
    need every fingerprint (e.g. executive_summary doesn't read past
    the top few). Keeps the by_severity / by_channel / by_day rollups
    intact so the agent can cite totals.
    """
    top_n = section.extra.get("top_n", 10)
    trimmed_groups = aggregation.get("groups", [])[:top_n]
    payload: dict = {
        "section": {
            "id": section.id,
            "template": section.template,
            "audience": section.audience,
            "max_words": section.max_words,
            "tone": section.tone,
            **section.extra,
        },
        "context": {
            "project": project,
            "env": env,
            "month_label": month_label,
            "from": from_date.isoformat(),
            "to": to_date.isoformat(),
        },
        "aggregation": {
            "events_total": aggregation.get("events_total", 0),
            "groups": trimmed_groups,
            "by_severity": aggregation.get("by_severity", {}),
            "by_channel": aggregation.get("by_channel", {}),
            "by_day": aggregation.get("by_day", {}),
            "disappeared_from_prior": aggregation.get(
                "disappeared_from_prior", [],
            ),
        },
        "coverage": coverage,
    }
    return payload


# --- Output validator -----------------------------------------------------

REQUIRED_KEYS_BY_SECTION: dict[str, set[str]] = {
    "executive_summary": {"summary", "highlights"},
    "top_issues": {"intro", "items"},
    "trend_narrative": {"narrative", "movers"},
    "coverage_caveat": {"statement", "affected"},
    "triage_brief": {"items"},
}


class AgentOutputError(Exception):
    """Raised when the agent's JSON output is malformed or off-contract."""


def validate_agent_output(section_id: str, raw: str | dict) -> dict:
    """Validate the agent's response. `raw` may be the JSON text or
    an already-parsed dict (callers that strip code fences first)."""
    if isinstance(raw, str):
        text = raw.strip()
        if text.startswith("```"):
            # Strip ```json and trailing ``` if the agent added a fence
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:].lstrip()
            text = text.rstrip()
            if text.endswith("```"):
                text = text[:-3].rstrip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as e:
            raise AgentOutputError(
                f"agent did not return valid JSON: {e}"
            ) from e
    else:
        parsed = raw

    if not isinstance(parsed, dict):
        raise AgentOutputError(
            f"agent JSON must be an object, got {type(parsed).__name__}"
        )
    if "error" in parsed:
        # Agent self-reported a failure; pass it through.
        return parsed
    required = REQUIRED_KEYS_BY_SECTION.get(section_id)
    if required:
        missing = required - set(parsed)
        if missing:
            raise AgentOutputError(
                f"agent output missing required keys: {sorted(missing)}"
            )
    return parsed


# --- Agent runner contract -------------------------------------------------

# The runner is whatever calls Claude with the agent definition. Inside
# the report skill it'll be a Task tool wrapper. In tests it's a stub.
AgentRunner = Callable[[str, dict], str]   # (agent_name, payload) -> raw_text


def synthesize_section(
    section_id: str,
    section_input: dict,
    *,
    runner: AgentRunner,
    agent_name: str = "drover:report-writer",
) -> dict:
    """Invoke the agent and validate the result.

    The runner is responsible for the actual subprocess / Task call;
    this helper just centralizes input-building, error wrapping, and
    output validation so every caller is consistent.
    """
    raw = runner(agent_name, section_input)
    return validate_agent_output(section_id, raw)


# --- Convenience for the report skill -------------------------------------

def all_sections_for_template(template: str) -> list[SectionSpec]:
    return [s for s in KNOWN_SECTIONS.values() if s.template == template]
