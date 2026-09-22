#!/usr/bin/env python3
"""Jev judgments for ideas-funnel:ingest — ranking signals and
duplicate / augment / new against existing wiki pages.

Per raw item, one request carries three Scores (source quality, novelty,
actionability) and one Choice per candidate page. Candidate pages are
found by code first — token overlap between the item and index.md
entries — so Jev only compares against a few plausible pages, the way
the TypeSafe entity-alignment cookbook narrows pairs before judging.

Confident answers are verdicts. Anything else, and every item when Jev is
unavailable, is marked `fallback` and the worker agent judges it exactly
as it did before.

  python3 "${CLAUDE_PLUGIN_ROOT}/scripts/jev_ingest.py" \
      --index ~/Vaults/Neurons/index.md Raw/Inbox/<domain>/*.md

Output (stdout):
  {"ok", "reason", "model", "thresholds": {...},
   "items": [{"path", "title", "source": "jev"|"fallback", "reason"?,
              "scores": {...}, "rank_score": float|null,
              "dedup": {"verdict": "duplicate"|"augment"|"new"|null,
                        "page": str|null, "source": ..., "candidates": [...]}}],
   "counts": {"jev": n, "fallback": n}}
Items with rank_score are listed first, highest first; fallback items follow
in input order.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import re
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("jev_client", _HERE / "jev_client.py")
jev = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(jev)

# Starting points to tune against real inbox items.
SCORE_CONFIDENCE_THRESHOLD = 0.5   # below this a Score does not rank the item
DEDUP_CONFIDENCE_THRESHOLD = 0.8   # below this the agent decides duplicate/augment/new
MAX_CANDIDATES = 3                 # existing pages compared per item
MIN_SHARED_TOKENS = 2              # a page needs this much overlap to be a candidate
MAX_BODY_CHARS = 6000              # item text sent to Jev
RANK_WEIGHTS = {"source_quality": 0.4, "novelty": 0.35, "actionability": 0.25}

SOURCE_QUALITY_LEVELS = [
    "Marketing copy, a listicle, or a bare link with no substance of its own",
    "Secondhand: summarizes or reacts to something else without primary detail",
    "Substantive: first-hand detail, data, code, or a primary announcement",
    "Authoritative and deep: a primary source a practitioner could act on directly",
]
NOVELTY_LEVELS = [
    "Restates what an existing page in `candidates` already says",
    "Familiar topic; adds only minor specifics to what `candidates` already cover",
    "A new angle or development on a topic the wiki already tracks",
    "An idea, tool, or development not represented in the wiki at all",
]
ACTIONABILITY_LEVELS = [
    "Nothing to act on; background reading only",
    "Worth noting, but no concrete experiment follows from it",
    "A concrete experiment could be run within a week",
    "Directly applicable now, with an obvious first step",
]
DEDUP_CRITERIA = {
    "duplicate": "The same source, announcement, or idea `candidate` already captures; nothing new to add",
    "augment": "The same topic as `candidate`, with new detail worth merging into that page",
    "new": "Not about `candidate`'s topic; deserves its own page",
}

_STOPWORDS = set("""
a an and are as at be by for from has have in into is it its of on or that the
this to was were will with you your not but can how what when why via new
""".split())
_INDEX_LINE = re.compile(r"^\s*-\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*(?:[—-]+\s*(.*))?$")
_FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n?", re.S)


# --- Reading input --------------------------------------------------------

def tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9][a-z0-9+.#-]{2,}", text.lower()) if t not in _STOPWORDS}


def read_index(path: Path) -> list[dict]:
    """Every `- [[Path/Page|Display]] — summary` line in index.md."""
    pages = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = _INDEX_LINE.match(line)
        if not m:
            continue
        page, display, summary = m.group(1).strip(), (m.group(2) or "").strip(), (m.group(3) or "").strip()
        title = display or page.rsplit("/", 1)[-1]
        pages.append({"page": page, "title": title, "summary": summary,
                      "tokens": tokens(f"{title} {summary}")})
    return pages


def read_item(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    title, origin = None, None
    m = _FRONTMATTER.match(text)
    if m:
        for line in m.group(1).splitlines():
            key, _, value = line.partition(":")
            if key.strip() == "title":
                title = value.strip().strip('"\'')
            elif key.strip() in ("origin", "url", "source"):
                origin = origin or value.strip().strip('"\'')
        text = text[m.end():]
    if not title:
        heading = re.search(r"^#\s+(.+)$", text, re.M)
        title = heading.group(1).strip() if heading else path.stem
    body = text.strip()[:MAX_BODY_CHARS]
    return {"path": str(path), "title": title, "origin": origin, "body": body}


def find_candidates(item: dict, pages: list[dict], limit: int = MAX_CANDIDATES) -> list[dict]:
    """Cheap first pass: pages sharing the most tokens with the item."""
    item_tokens = tokens(f"{item['title']} {item['title']} {item['body'][:1500]}")
    scored = []
    for page in pages:
        shared = item_tokens & page["tokens"]
        if len(shared) >= MIN_SHARED_TOKENS:
            score = len(shared) / math.sqrt(max(len(page["tokens"]), 1))
            scored.append((score, page))
    scored.sort(key=lambda s: s[0], reverse=True)
    return [{"page": p["page"], "title": p["title"], "summary": p["summary"]} for _, p in scored[:limit]]


# --- Questions ------------------------------------------------------------

def build_questions(candidates: list[dict]) -> dict:
    if candidates:
        novelty_note = "`candidates` lists the existing wiki pages most similar to `item`."
    else:
        novelty_note = "No existing wiki page resembles `item`; `candidates` is empty."
    questions = {
        "source_quality": {
            "type": "score",
            "instructions": "How much substance does the source behind `item` carry?",
            "criteria": SOURCE_QUALITY_LEVELS,
        },
        "novelty": {
            "type": "score",
            "instructions": {"question": "How new is `item` relative to the wiki?", "note": novelty_note},
            "criteria": NOVELTY_LEVELS,
        },
        "actionability": {
            "type": "score",
            "instructions": "Could Chris, a senior Drupal and Claude Code engineer, act on `item`?",
            "criteria": ACTIONABILITY_LEVELS,
        },
    }
    for n, candidate in enumerate(candidates):
        questions[f"dedup_{n}"] = {
            "type": "choice",
            "instructions": {
                "candidate": candidate,
                "question": "How does `item` relate to the existing wiki page `candidate`?",
            },
            "criteria": dict(DEDUP_CRITERIA),
        }
    return questions


# --- Judging --------------------------------------------------------------

def _resolve_dedup(candidates: list[dict], answers: dict, model: str) -> dict:
    records = []
    for n, candidate in enumerate(candidates):
        record = jev.choice_verdict(answers.get(f"dedup_{n}"),
                                    threshold=DEDUP_CONFIDENCE_THRESHOLD, model=model)
        record["page"] = candidate["page"]
        records.append(record)
    if not candidates:
        return {"verdict": None, "page": None, **jev.fallback("no_candidates"), "candidates": []}
    confident = [r for r in records if r["source"] == "jev" and r["confident"]]
    for verdict in ("duplicate", "augment"):
        hits = sorted((r for r in confident if r["choice"] == verdict),
                      key=lambda r: r["confidence"], reverse=True)
        if hits:
            return {"verdict": verdict, "page": hits[0]["page"], "source": "jev",
                    "model": model, "confidence": hits[0]["confidence"],
                    "threshold": DEDUP_CONFIDENCE_THRESHOLD, "candidates": records}
    if len(confident) == len(records) and all(r["choice"] == "new" for r in confident):
        return {"verdict": "new", "page": None, "source": "jev", "model": model,
                "confidence": min(r["confidence"] for r in confident),
                "threshold": DEDUP_CONFIDENCE_THRESHOLD, "candidates": records}
    return {"verdict": None, "page": None, **jev.fallback("low_confidence"), "candidates": records}


def judge_item(item: dict, candidates: list[dict], **ask_kwargs) -> dict:
    state = {
        "item": {k: v for k, v in item.items() if k in ("title", "origin", "body") and v},
        "candidates": candidates,
    }
    response = jev.ask(state, build_questions(candidates), **ask_kwargs)
    out = {"path": item["path"], "title": item["title"]}
    if not response["ok"]:
        out.update(jev.fallback(response["reason"]))
        out.update({"scores": {}, "rank_score": None,
                    "dedup": {"verdict": None, "page": None, **jev.fallback(response["reason"]),
                              "candidates": []}})
        return out
    model = response["model"]
    scores = {
        name: jev.score_verdict(response["answers"].get(name),
                                threshold=SCORE_CONFIDENCE_THRESHOLD, model=model)
        for name in RANK_WEIGHTS
    }
    if all(s["source"] == "jev" and s["confident"] for s in scores.values()):
        rank = sum(RANK_WEIGHTS[name] * scores[name]["score"] for name in RANK_WEIGHTS)
        out.update({"source": "jev", "model": model, "scores": scores, "rank_score": round(rank, 4)})
    else:
        out.update(jev.fallback("low_confidence"))
        out.update({"scores": scores, "rank_score": None})
    out["dedup"] = _resolve_dedup(candidates, response["answers"], model)
    return out


def run(paths: list[Path], index: Path | None, **ask_kwargs) -> dict:
    pages = read_index(index) if index and index.exists() else []
    judged = []
    model = None
    ok = False
    reason = None
    for path in paths:
        item = read_item(path)
        result = judge_item(item, find_candidates(item, pages), **ask_kwargs)
        if result["source"] == "jev" or result["dedup"]["source"] == "jev":
            ok = True
            model = result.get("model") or result["dedup"].get("model") or model
        elif reason is None:
            reason = result.get("reason")
        judged.append(result)
    ranked = sorted((r for r in judged if r["rank_score"] is not None),
                    key=lambda r: r["rank_score"], reverse=True)
    unranked = [r for r in judged if r["rank_score"] is None]
    counts = {"jev": len(ranked), "fallback": len(unranked)}
    return {
        "ok": ok,
        "reason": None if ok else reason,
        "model": model,
        "thresholds": {"score_confidence": SCORE_CONFIDENCE_THRESHOLD,
                       "dedup_confidence": DEDUP_CONFIDENCE_THRESHOLD},
        "items": ranked + unranked,
        "counts": counts,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Jev ranking and dedup verdicts for raw inbox items.")
    p.add_argument("--index", type=Path, default=Path.home() / "Vaults/Neurons/index.md")
    p.add_argument("paths", nargs="+", type=Path)
    args = p.parse_args(argv)
    print(json.dumps(run(args.paths, args.index)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
