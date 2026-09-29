#!/usr/bin/env python3
"""Shared client for TypeSafe's System One model, Jev. Standard library only.

This file is copied verbatim into every plugin that asks Jev for a judgment
(drover, ideas-funnel, test-lab, workshop). Plugins install and cache
separately, so a cross-plugin import would break; identical copies do not.
`admin/scripts/check-jev-client-copies.sh` fails when the copies diverge.
Edit one copy, then copy it over the others.

Contract, so callers can stay simple:

  * Jev is used only when TYPESAFE_API_KEY is set and JEV_DISABLED is not
    "1". Otherwise every call reports `unavailable` and callers fall back
    to whatever they did before Jev existed.
  * Nothing here raises into a caller. Timeouts, network errors, non-200
    responses, and malformed bodies all come back as {"ok": False,
    "reason": ...}. 429 and 529 are retried, honoring Retry-After, up to
    MAX_ATTEMPTS.
  * Many independent questions over one state go in one request. Many
    items with the same questions are packed ITEMS_PER_REQUEST at a time
    into one state and asked with per-item questions (see ask_items).
  * Every verdict helper returns a record that says where the answer came
    from: {"source": "jev", "model": ..., "confidence": ..., "threshold":
    ...} or {"source": "fallback", "reason": ...}.

Command line: read one JSON request on stdin, write one JSON result on
stdout, exit 0 even when Jev is unavailable (the caller branches on "ok").

  python3 jev_client.py --check
  python3 jev_client.py < request.json          # {"state", "questions"}
  python3 jev_client.py < items-request.json    # {"items", "questions"}

API reference: https://docs.typesafe.ai/api.md
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Callable

ENDPOINT = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"
API_KEY_ENV = "TYPESAFE_API_KEY"
DISABLE_ENV = "JEV_DISABLED"

# Starting points, not tuned values. Adjust once real request timings and
# rate-limit behavior have been observed.
DEFAULT_TIMEOUT_SECONDS = 20.0
MAX_ATTEMPTS = 3                 # total tries per request, including the first
DEFAULT_BACKOFF_SECONDS = 1.0    # when a retryable status has no Retry-After
RETRY_AFTER_CAP_SECONDS = 10.0   # never sleep longer than this per retry
RETRYABLE_STATUSES = (429, 503, 529)

# Packing many items into one request. Each item becomes `items.<key>` in
# the state and every question is copied once per item. The API allows
# 32k tokens for state plus the longest question; MAX_STATE_CHARS keeps a
# packed state well under that (roughly four characters per token).
ITEMS_PER_REQUEST = 8
MAX_STATE_CHARS = 60_000

QUESTION_TYPES = ("choice", "noul", "score")

Transport = Callable[[dict, float], tuple[int, dict, bytes]]


# --- Availability ---------------------------------------------------------

def availability(env: dict | None = None) -> tuple[bool, str | None]:
    """Return (available, reason). reason is None when available."""
    env = os.environ if env is None else env
    if str(env.get(DISABLE_ENV, "")).strip() == "1":
        return False, "disabled"
    if not str(env.get(API_KEY_ENV, "")).strip():
        return False, "no_api_key"
    return True, None


# --- Transport ------------------------------------------------------------

def _urllib_transport(request: dict, timeout: float) -> tuple[int, dict, bytes]:
    """POST one request. Returns (status, headers, body); HTTP errors are
    returned as a status, not raised. Timeouts and socket errors raise so
    ask() can label them."""
    body = json.dumps(request).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {os.environ.get(API_KEY_ENV, '')}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read() if hasattr(e, "read") else b""


def _retry_after_seconds(headers: dict) -> float:
    for key, value in (headers or {}).items():
        if str(key).lower() == "retry-after":
            try:
                return min(max(float(value), 0.0), RETRY_AFTER_CAP_SECONDS)
            except (TypeError, ValueError):
                break  # an HTTP-date form; fall through to the default
    return DEFAULT_BACKOFF_SECONDS


# --- Core call ------------------------------------------------------------

def _validate_answers(payload: Any) -> dict | None:
    """Return the answers map when the response body has the documented
    shape, otherwise None."""
    if not isinstance(payload, dict):
        return None
    answers = payload.get("answers")
    if not isinstance(answers, dict) or not isinstance(payload.get("model"), str):
        return None
    for answer in answers.values():
        if not isinstance(answer, dict) or answer.get("type") not in QUESTION_TYPES:
            return None
    return answers


def ask(
    state: Any,
    questions: dict[str, dict],
    *,
    model: str = MODEL,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    max_attempts: int = MAX_ATTEMPTS,
    transport: Transport | None = None,
    sleep: Callable[[float], None] = time.sleep,
    env: dict | None = None,
) -> dict:
    """Evaluate `questions` against one `state`. Never raises.

    Success: {"ok": True, "model": "jev-1.13.0", "answers": {...},
              "usage": {...}, "attempts": n}
    Failure: {"ok": False, "reason": <token>, "detail": <str>, "attempts": n}

    reason tokens: disabled, no_api_key, empty_questions, timeout,
    network_error, rate_limited, unauthorized, http_<status>,
    malformed_response.
    """
    ok, reason = availability(env)
    if not ok:
        return {"ok": False, "reason": reason, "detail": "", "attempts": 0}
    if not questions:
        return {"ok": False, "reason": "empty_questions", "detail": "", "attempts": 0}

    send = transport or _urllib_transport
    request = {"state": state, "model": model, "questions": questions}
    attempts = 0
    last_detail = ""
    while attempts < max(1, max_attempts):
        attempts += 1
        try:
            status, headers, body = send(request, timeout)
        except (socket.timeout, TimeoutError) as e:
            return {"ok": False, "reason": "timeout", "detail": str(e), "attempts": attempts}
        except urllib.error.URLError as e:
            if isinstance(getattr(e, "reason", None), (socket.timeout, TimeoutError)):
                return {"ok": False, "reason": "timeout", "detail": str(e), "attempts": attempts}
            return {"ok": False, "reason": "network_error", "detail": str(e), "attempts": attempts}
        except (OSError, ValueError) as e:
            return {"ok": False, "reason": "network_error", "detail": str(e), "attempts": attempts}

        if status in RETRYABLE_STATUSES:
            last_detail = f"http {status}"
            if attempts < max_attempts:
                sleep(_retry_after_seconds(headers))
                continue
            return {"ok": False, "reason": "rate_limited", "detail": last_detail, "attempts": attempts}
        if status == 401:
            return {"ok": False, "reason": "unauthorized", "detail": "http 401", "attempts": attempts}
        if status != 200:
            snippet = body[:200].decode("utf-8", "replace") if isinstance(body, bytes) else str(body)[:200]
            return {"ok": False, "reason": f"http_{status}", "detail": snippet, "attempts": attempts}

        try:
            payload = json.loads(body.decode("utf-8") if isinstance(body, bytes) else body)
        except (ValueError, UnicodeDecodeError) as e:
            return {"ok": False, "reason": "malformed_response", "detail": str(e), "attempts": attempts}
        answers = _validate_answers(payload)
        if answers is None:
            return {"ok": False, "reason": "malformed_response", "detail": "unexpected body shape", "attempts": attempts}
        return {
            "ok": True,
            "model": payload["model"],
            "answers": answers,
            "usage": payload.get("usage") or {},
            "attempts": attempts,
        }

    return {"ok": False, "reason": "rate_limited", "detail": last_detail, "attempts": attempts}


# --- Many items, same questions -------------------------------------------

def _scoped_question(question: dict, path: str) -> dict:
    """Copy a question so it judges only the record at `path` in a packed
    state. Instructions become a structured object naming the subject."""
    original = question.get("instructions")
    scoped = {
        "subject": f"`{path}`",
        "scope": (
            f"Answer only about the record at `{path}`. The other records "
            "under `items` are separate cases and must not influence this answer."
        ),
    }
    if isinstance(original, dict):
        scoped.update({k: v for k, v in original.items() if k not in scoped})
        scoped["question"] = original.get("question", original)
    else:
        scoped["question"] = original
    out = dict(question)
    out["instructions"] = scoped
    return out


def ask_items(
    items: dict[str, Any],
    questions: dict[str, dict],
    *,
    items_per_request: int = ITEMS_PER_REQUEST,
    max_state_chars: int = MAX_STATE_CHARS,
    **ask_kwargs: Any,
) -> dict:
    """Ask the same `questions` about each item, packing several items per
    request. Returns {"ok", "reason", "model", "requests", "results":
    {item_id: {"ok": True, "answers": {...}} | {"ok": False, "reason"}}}.

    ok is True when at least one request succeeded. An item too large for
    one request is reported as state_too_large and never sent.
    """
    ok, reason = availability(ask_kwargs.get("env"))
    results: dict[str, dict] = {}
    if not ok:
        for item_id in items:
            results[item_id] = {"ok": False, "reason": reason}
        return {"ok": False, "reason": reason, "model": None, "requests": 0, "results": results}

    # Chunk by count and by serialized size.
    chunks: list[list[tuple[str, Any, int]]] = []
    current: list[tuple[str, Any, int]] = []
    current_chars = 0
    for item_id, item in items.items():
        size = len(json.dumps(item, default=str))
        if size > max_state_chars:
            results[item_id] = {"ok": False, "reason": "state_too_large"}
            continue
        if current and (len(current) >= items_per_request or current_chars + size > max_state_chars):
            chunks.append(current)
            current, current_chars = [], 0
        current.append((item_id, item, size))
        current_chars += size
    if current:
        chunks.append(current)

    model = None
    any_ok = False
    last_reason = reason
    for chunk in chunks:
        keys = {f"i{n}": item_id for n, item_id in enumerate(k for k, _, _ in chunk)}
        state = {"items": {key: item for key, (_, item, _) in zip(keys, chunk)}}
        packed: dict[str, dict] = {}
        for key in keys:
            for qid, question in questions.items():
                packed[f"{key}__{qid}"] = _scoped_question(question, f"items.{key}")
        response = ask(state, packed, **ask_kwargs)
        if not response["ok"]:
            last_reason = response["reason"]
            for item_id in keys.values():
                results[item_id] = {"ok": False, "reason": response["reason"]}
            continue
        any_ok = True
        model = response["model"]
        for key, item_id in keys.items():
            answers = {}
            for qid in questions:
                answer = response["answers"].get(f"{key}__{qid}")
                if answer is not None:
                    answers[qid] = answer
            if len(answers) == len(questions):
                results[item_id] = {"ok": True, "answers": answers}
            else:
                results[item_id] = {"ok": False, "reason": "malformed_response"}

    return {
        "ok": any_ok,
        "reason": None if any_ok else last_reason,
        "model": model,
        "requests": len(chunks),
        "results": results,
    }


# --- Verdict records ------------------------------------------------------

def fallback(reason: str) -> dict:
    """The record every caller stores when Jev did not decide."""
    return {"source": "fallback", "reason": reason}


def choice_verdict(answer: Any, *, threshold: float, model: str | None) -> dict:
    """Record for a Choice answer. `confident` is confidence >= threshold;
    a malformed answer becomes a fallback record."""
    if (
        not isinstance(answer, dict) or answer.get("type") != "choice"
        or not isinstance(answer.get("choice"), str)
        or not isinstance(answer.get("confidence"), (int, float))
    ):
        return fallback("malformed_answer")
    confidence = float(answer["confidence"])
    return {
        "source": "jev",
        "model": model,
        "choice": answer["choice"],
        "confidence": round(confidence, 4),
        "probabilities": answer.get("probabilities") or {},
        "threshold": threshold,
        "confident": confidence >= threshold,
    }


def score_verdict(answer: Any, *, threshold: float, model: str | None) -> dict:
    """Record for a Score answer. `level` is the nearest level index."""
    if (
        not isinstance(answer, dict) or answer.get("type") != "score"
        or not isinstance(answer.get("score"), (int, float))
        or not isinstance(answer.get("confidence"), (int, float))
    ):
        return fallback("malformed_answer")
    confidence = float(answer["confidence"])
    score = float(answer["score"])
    return {
        "source": "jev",
        "model": model,
        "score": round(score, 4),
        "level": int(score + 0.5),
        "confidence": round(confidence, 4),
        "probabilities": answer.get("probabilities") or {},
        "threshold": threshold,
        "confident": confidence >= threshold,
    }


def noul_verdict(answer: Any, *, yes_at: float, no_at: float, model: str | None) -> dict:
    """Record for a Noul answer. verdict is yes (>= yes_at), no (<= no_at)
    or uncertain. Noul answers carry no separate confidence."""
    if not isinstance(answer, dict) or answer.get("type") != "noul" \
            or not isinstance(answer.get("noul"), (int, float)):
        return fallback("malformed_answer")
    p = float(answer["noul"])
    verdict = "yes" if p >= yes_at else "no" if p <= no_at else "uncertain"
    return {
        "source": "jev",
        "model": model,
        "noul": round(p, 4),
        "yes_at": yes_at,
        "no_at": no_at,
        "verdict": verdict,
        "confident": verdict != "uncertain",
    }


# --- Command line ---------------------------------------------------------

def _cli(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="jev_client",
        description="Ask TypeSafe's Jev model typed questions. JSON in, JSON out.",
    )
    p.add_argument("--check", action="store_true",
                   help="print availability and exit")
    p.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    p.add_argument("--items-per-request", type=int, default=ITEMS_PER_REQUEST)
    p.add_argument("--model", default=MODEL)
    args = p.parse_args(argv)

    if args.check:
        ok, reason = availability()
        print(json.dumps({"available": ok, "reason": reason}))
        return 0

    try:
        request = json.load(sys.stdin)
    except ValueError as e:
        print(json.dumps({"ok": False, "reason": "invalid_input", "detail": str(e)}))
        return 2
    if not isinstance(request, dict) or not isinstance(request.get("questions"), dict):
        print(json.dumps({"ok": False, "reason": "invalid_input",
                          "detail": "expected {state|items, questions}"}))
        return 2

    if isinstance(request.get("items"), dict):
        result = ask_items(
            request["items"], request["questions"],
            items_per_request=args.items_per_request,
            model=args.model, timeout=args.timeout,
        )
    else:
        result = ask(
            request.get("state"), request["questions"],
            model=args.model, timeout=args.timeout,
        )
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
