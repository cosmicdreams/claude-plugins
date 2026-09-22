#!/usr/bin/env python3
"""Jev judgments for workshop:scout step 3 — dedup against the vault
baseline and the Keep / Watch / Skip verdict against the interest profile.

Per fetched item, one request carries: a Choice per baseline candidate
(duplicate / augment / net-new), the Keep / Watch / Skip Choice with the
interest profile in the question, and the three lens Nouls (pragmatist,
trends, builder). Candidates come from token overlap in code first.

Confident answers are verdicts. Anything else, and every item when Jev is
unavailable, is marked `fallback` and the agent scores it as before.
Feedback weights and mutes stay deterministic and are applied by the agent
before this script runs; a muted source never reaches Jev.

Input (stdin): {
  "interests": [...], "anti_interests": [...],
  "baseline": [{"title": str, "summary"?: str}],
  "items": [{"id": str, "title": str, "summary"?: str, "source"?: str}]
}
Output (stdout): {"ok", "reason", "model", "thresholds", "items": [...],
                  "counts": {"jev": n, "fallback": n}}
"""
from __future__ import annotations

import importlib.util
import json
import math
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("jev_client", _HERE / "jev_client.py")
jev = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(jev)

# Starting points to tune against real scout runs.
VERDICT_CONFIDENCE_THRESHOLD = 0.7
DEDUP_CONFIDENCE_THRESHOLD = 0.8
LENS_YES_AT = 0.85          # "one lens strongly yes" promotes Watch to Keep
LENS_NO_AT = 0.2
MAX_CANDIDATES = 3
MIN_SHARED_TOKENS = 2
MAX_WORKERS = 6             # concurrent requests; the endpoint rate-limits above roughly eight

VERDICT_CRITERIA = {
    "Keep": "Clearly serves at least one interest and touches no anti-interest; worth storing in the vault",
    "Watch": "Directionally relevant to the interests but nothing to do with it yet",
    "Skip": "Matches an anti-interest, or serves none of the interests",
}
DEDUP_CRITERIA = {
    "duplicate": "The same tool, announcement, or concept `candidate` already records; nothing new",
    "augment": "The same subject as `candidate`, adding detail worth updating that entry with",
    "net-new": "A different subject from `candidate`",
}
LENSES = {
    "pragmatist": "Is `item` actionable in Chris's workflow today?",
    "trends": "Does `item` signal where the AI-tooling ecosystem is heading?",
    "builder": "Would Chris build something differently because of `item`?",
}
_ORDER = {"Keep": 0, "Watch": 1, "Skip": 2}
_STOPWORDS = set("a an and are as at be by for from has have in into is it its of on or that the this to with you your not but can how what when why via new".split())


def tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9][a-z0-9+.#-]{2,}", text.lower()) if t not in _STOPWORDS}


def find_candidates(item: dict, baseline: list[dict], limit: int = MAX_CANDIDATES) -> list[dict]:
    item_tokens = tokens(f"{item.get('title', '')} {item.get('summary', '')}")
    scored = []
    for entry in baseline:
        entry_tokens = tokens(f"{entry.get('title', '')} {entry.get('summary', '')}")
        shared = item_tokens & entry_tokens
        if len(shared) >= MIN_SHARED_TOKENS:
            scored.append((len(shared) / math.sqrt(max(len(entry_tokens), 1)), entry))
    scored.sort(key=lambda s: s[0], reverse=True)
    return [{"title": e.get("title", ""), "summary": e.get("summary", "")} for _, e in scored[:limit]]


def build_questions(profile: dict, candidates: list[dict]) -> dict:
    questions = {
        "verdict": {
            "type": "choice",
            "instructions": {
                "interests": profile.get("interests", []),
                "anti_interests": profile.get("anti_interests", []),
                "question": "Given this interest profile, what should the knowledge radar do with `item`?",
            },
            "criteria": dict(VERDICT_CRITERIA),
        },
    }
    for name, question in LENSES.items():
        questions[name] = {"type": "noul", "instructions": question}
    for n, candidate in enumerate(candidates):
        questions[f"dedup_{n}"] = {
            "type": "choice",
            "instructions": {"candidate": candidate,
                             "question": "How does `item` relate to the existing vault entry `candidate`?"},
            "criteria": dict(DEDUP_CRITERIA),
        }
    return questions


def _resolve_dedup(candidates: list[dict], answers: dict, model: str) -> dict:
    records = []
    for n, candidate in enumerate(candidates):
        record = jev.choice_verdict(answers.get(f"dedup_{n}"), threshold=DEDUP_CONFIDENCE_THRESHOLD, model=model)
        record["candidate"] = candidate["title"]
        records.append(record)
    if not candidates:
        return {"verdict": "net-new", "match": None, "source": "code", "reason": "no_candidates", "candidates": []}
    confident = [r for r in records if r["source"] == "jev" and r["confident"]]
    for verdict in ("duplicate", "augment"):
        hits = sorted((r for r in confident if r["choice"] == verdict), key=lambda r: r["confidence"], reverse=True)
        if hits:
            return {"verdict": verdict, "match": hits[0]["candidate"], "source": "jev", "model": model,
                    "confidence": hits[0]["confidence"], "threshold": DEDUP_CONFIDENCE_THRESHOLD,
                    "candidates": records}
    if len(confident) == len(records):
        return {"verdict": "net-new", "match": None, "source": "jev", "model": model,
                "confidence": min(r["confidence"] for r in confident),
                "threshold": DEDUP_CONFIDENCE_THRESHOLD, "candidates": records}
    return {"verdict": None, "match": None, **jev.fallback("low_confidence"), "candidates": records}


def judge_item(item: dict, profile: dict, baseline: list[dict], **ask_kwargs) -> dict:
    candidates = find_candidates(item, baseline)
    state = {"item": {k: v for k, v in item.items() if k in ("title", "summary", "source") and v}}
    response = jev.ask(state, build_questions(profile, candidates), **ask_kwargs)
    out = {"id": item.get("id"), "title": item.get("title")}
    if not response["ok"]:
        out.update(jev.fallback(response["reason"]))
        out.update({"verdict": None, "lenses": {},
                    "dedup": {"verdict": None, "match": None, **jev.fallback(response["reason"]), "candidates": []}})
        return out
    model = response["model"]
    answers = response["answers"]
    lenses = {name: jev.noul_verdict(answers.get(name), yes_at=LENS_YES_AT, no_at=LENS_NO_AT, model=model)
              for name in LENSES}
    verdict = jev.choice_verdict(answers.get("verdict"), threshold=VERDICT_CONFIDENCE_THRESHOLD, model=model)
    strong_lens = any(l.get("verdict") == "yes" for l in lenses.values())
    if verdict["source"] == "jev" and verdict["confident"]:
        final = verdict["choice"]
        if final == "Watch" and strong_lens:
            final = "Keep"   # today's rule: one lens strongly yes is enough to keep
        out.update({"source": "jev", "model": model, "verdict": final, "jev_verdict": verdict})
    else:
        out.update(jev.fallback("low_confidence"))
        out.update({"verdict": None, "jev_verdict": verdict})
    out["lenses"] = lenses
    out["dedup"] = _resolve_dedup(candidates, answers, model)
    return out


def run(payload: dict, **ask_kwargs) -> dict:
    profile = {"interests": payload.get("interests") or [], "anti_interests": payload.get("anti_interests") or []}
    baseline = payload.get("baseline") or []
    items = payload.get("items") or []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        judged = list(pool.map(lambda it: judge_item(it, profile, baseline, **ask_kwargs), items))
    jev_items = [r for r in judged if r["source"] == "jev"]
    model = next((r["model"] for r in jev_items), None)
    reason = next((r.get("reason") for r in judged if r["source"] != "jev"), None)
    return {
        "ok": bool(jev_items),
        "reason": None if jev_items else reason,
        "model": model,
        "thresholds": {"verdict_confidence": VERDICT_CONFIDENCE_THRESHOLD,
                       "dedup_confidence": DEDUP_CONFIDENCE_THRESHOLD,
                       "lens_yes_at": LENS_YES_AT},
        "items": judged,
        "counts": {"jev": len(jev_items), "fallback": len(judged) - len(jev_items)},
    }


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError as e:
        print(json.dumps({"ok": False, "reason": "invalid_input", "detail": str(e)}))
        return 2
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        print(json.dumps({"ok": False, "reason": "invalid_input", "detail": "expected {items: [...]}"}))
        return 2
    print(json.dumps(run(payload)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
