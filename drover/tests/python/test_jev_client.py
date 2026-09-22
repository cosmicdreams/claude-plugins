"""Unit tests for the shared Jev client (drover/scripts/jev_client.py).

The HTTP layer is replaced with a fake transport; nothing here contacts
TypeSafe except LiveSmokeTests, which is skipped without TYPESAFE_API_KEY.
The last test asserts that every plugin's copy of the client is identical.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import pathlib
import socket
import subprocess
import sys
import unittest
import urllib.error

HERE = pathlib.Path(__file__).resolve()
SCRIPTS = HERE.parents[2] / "scripts"
REPO = HERE.parents[3]

spec = importlib.util.spec_from_file_location(
    "drover_jev_client", SCRIPTS / "jev_client.py",
)
jev = importlib.util.module_from_spec(spec)
sys.modules["drover_jev_client"] = jev
spec.loader.exec_module(jev)

ENV_OK = {"TYPESAFE_API_KEY": "test-key"}

CHOICE_Q = {
    "bucket": {
        "type": "choice",
        "instructions": "Which bucket?",
        "criteria": {"a": "first", "b": "second"},
    },
}


def _ok_body(answers: dict, model: str = "jev-1.13.0") -> bytes:
    return json.dumps({
        "model": model, "answers": answers,
        "usage": {"input_tokens": 1, "output_tokens": 1},
    }).encode()


def _choice(choice: str, confidence: float) -> dict:
    other = "b" if choice == "a" else "a"
    return {
        "type": "choice", "choice": choice, "confidence": confidence,
        "probabilities": {choice: confidence, other: 1 - confidence},
    }


class ScriptedTransport:
    """Returns scripted (status, headers, body) tuples or raises scripted
    exceptions, one per call, and records every request."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests: list[dict] = []

    def __call__(self, request, timeout):
        self.requests.append(request)
        item = self.responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


class AvailabilityTests(unittest.TestCase):
    def test_missing_key_is_unavailable(self):
        self.assertEqual(jev.availability({}), (False, "no_api_key"))
        self.assertEqual(jev.availability({"TYPESAFE_API_KEY": "  "}), (False, "no_api_key"))

    def test_opt_out_wins_over_key(self):
        env = {"TYPESAFE_API_KEY": "k", "JEV_DISABLED": "1"}
        self.assertEqual(jev.availability(env), (False, "disabled"))

    def test_key_present(self):
        self.assertEqual(jev.availability(ENV_OK), (True, None))


class AskTests(unittest.TestCase):
    def test_no_key_never_calls_transport(self):
        transport = ScriptedTransport()
        result = jev.ask("s", CHOICE_Q, transport=transport, env={})
        self.assertEqual(result["reason"], "no_api_key")
        self.assertFalse(result["ok"])
        self.assertEqual(transport.requests, [])

    def test_disabled_never_calls_transport(self):
        transport = ScriptedTransport()
        result = jev.ask("s", CHOICE_Q, transport=transport,
                         env={"TYPESAFE_API_KEY": "k", "JEV_DISABLED": "1"})
        self.assertEqual(result["reason"], "disabled")
        self.assertEqual(transport.requests, [])

    def test_empty_questions(self):
        result = jev.ask("s", {}, transport=ScriptedTransport(), env=ENV_OK)
        self.assertEqual(result["reason"], "empty_questions")

    def test_timeout_is_reported_not_raised(self):
        transport = ScriptedTransport(socket.timeout("slow"))
        result = jev.ask("s", CHOICE_Q, transport=transport, env=ENV_OK)
        self.assertEqual(result, {"ok": False, "reason": "timeout",
                                  "detail": "slow", "attempts": 1})

    def test_urlerror_wrapping_timeout_is_timeout(self):
        transport = ScriptedTransport(urllib.error.URLError(socket.timeout("t")))
        result = jev.ask("s", CHOICE_Q, transport=transport, env=ENV_OK)
        self.assertEqual(result["reason"], "timeout")

    def test_network_error(self):
        transport = ScriptedTransport(urllib.error.URLError("dns failed"))
        result = jev.ask("s", CHOICE_Q, transport=transport, env=ENV_OK)
        self.assertEqual(result["reason"], "network_error")
        self.assertIn("dns failed", result["detail"])

    def test_429_then_success_honors_retry_after(self):
        sleeps: list[float] = []
        transport = ScriptedTransport(
            (429, {"Retry-After": "2"}, b""),
            (200, {}, _ok_body({"bucket": _choice("a", 0.95)})),
        )
        result = jev.ask("s", CHOICE_Q, transport=transport, env=ENV_OK,
                         sleep=sleeps.append)
        self.assertTrue(result["ok"])
        self.assertEqual(result["attempts"], 2)
        self.assertEqual(sleeps, [2.0])
        self.assertEqual(result["model"], "jev-1.13.0")
        self.assertEqual(result["answers"]["bucket"]["choice"], "a")

    def test_retry_after_is_capped(self):
        sleeps: list[float] = []
        transport = ScriptedTransport(
            (429, {"retry-after": "600"}, b""),
            (200, {}, _ok_body({"bucket": _choice("a", 0.95)})),
        )
        jev.ask("s", CHOICE_Q, transport=transport, env=ENV_OK, sleep=sleeps.append)
        self.assertEqual(sleeps, [jev.RETRY_AFTER_CAP_SECONDS])

    def test_429_exhausted(self):
        sleeps: list[float] = []
        transport = ScriptedTransport(*[(429, {}, b"")] * jev.MAX_ATTEMPTS)
        result = jev.ask("s", CHOICE_Q, transport=transport, env=ENV_OK,
                         sleep=sleeps.append)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "rate_limited")
        self.assertEqual(result["attempts"], jev.MAX_ATTEMPTS)
        # One sleep between each attempt, default backoff when no header.
        self.assertEqual(sleeps, [jev.DEFAULT_BACKOFF_SECONDS] * (jev.MAX_ATTEMPTS - 1))

    def test_529_overloaded_is_retried(self):
        transport = ScriptedTransport(
            (529, {}, b""),
            (200, {}, _ok_body({"bucket": _choice("b", 0.7)})),
        )
        result = jev.ask("s", CHOICE_Q, transport=transport, env=ENV_OK, sleep=lambda s: None)
        self.assertTrue(result["ok"])

    def test_401_unauthorized(self):
        transport = ScriptedTransport((401, {}, b'{"error":"bad key"}'))
        result = jev.ask("s", CHOICE_Q, transport=transport, env=ENV_OK)
        self.assertEqual(result["reason"], "unauthorized")

    def test_422_non_200(self):
        transport = ScriptedTransport((422, {}, b'{"error":"bad question"}'))
        result = jev.ask("s", CHOICE_Q, transport=transport, env=ENV_OK)
        self.assertEqual(result["reason"], "http_422")
        self.assertIn("bad question", result["detail"])

    def test_malformed_json(self):
        transport = ScriptedTransport((200, {}, b"<html>not json"))
        result = jev.ask("s", CHOICE_Q, transport=transport, env=ENV_OK)
        self.assertEqual(result["reason"], "malformed_response")

    def test_malformed_shape(self):
        transport = ScriptedTransport((200, {}, b'{"answers": []}'))
        result = jev.ask("s", CHOICE_Q, transport=transport, env=ENV_OK)
        self.assertEqual(result["reason"], "malformed_response")
        transport = ScriptedTransport(
            (200, {}, json.dumps({"model": "m", "answers": {"bucket": {"type": "poem"}}}).encode()),
        )
        result = jev.ask("s", CHOICE_Q, transport=transport, env=ENV_OK)
        self.assertEqual(result["reason"], "malformed_response")

    def test_request_shape_matches_api(self):
        transport = ScriptedTransport((200, {}, _ok_body({"bucket": _choice("a", 1.0)})))
        jev.ask({"case": "x"}, CHOICE_Q, transport=transport, env=ENV_OK)
        self.assertEqual(transport.requests[0], {
            "state": {"case": "x"}, "model": jev.MODEL, "questions": CHOICE_Q,
        })


class VerdictTests(unittest.TestCase):
    def test_confident_choice(self):
        v = jev.choice_verdict(_choice("a", 0.93), threshold=0.8, model="jev-1.13.0")
        self.assertEqual(v["source"], "jev")
        self.assertTrue(v["confident"])
        self.assertEqual(v["choice"], "a")
        self.assertEqual(v["threshold"], 0.8)
        self.assertEqual(v["model"], "jev-1.13.0")

    def test_uncertain_choice_is_marked_not_confident(self):
        v = jev.choice_verdict(_choice("a", 0.55), threshold=0.8, model="m")
        self.assertEqual(v["source"], "jev")
        self.assertFalse(v["confident"])

    def test_malformed_answer_becomes_fallback(self):
        self.assertEqual(jev.choice_verdict({"type": "choice"}, threshold=0.8, model="m"),
                         {"source": "fallback", "reason": "malformed_answer"})
        self.assertEqual(jev.score_verdict(None, threshold=0.8, model="m")["source"], "fallback")
        self.assertEqual(jev.noul_verdict({"type": "noul"}, yes_at=0.8, no_at=0.2, model="m")["source"],
                         "fallback")

    def test_score_level_rounds_to_nearest(self):
        v = jev.score_verdict({"type": "score", "score": 1.6, "confidence": 0.9,
                               "probabilities": {}}, threshold=0.7, model="m")
        self.assertEqual(v["level"], 2)
        self.assertTrue(v["confident"])

    def test_noul_bands(self):
        mk = lambda p: {"type": "noul", "noul": p}
        self.assertEqual(jev.noul_verdict(mk(0.9), yes_at=0.8, no_at=0.2, model="m")["verdict"], "yes")
        self.assertEqual(jev.noul_verdict(mk(0.1), yes_at=0.8, no_at=0.2, model="m")["verdict"], "no")
        u = jev.noul_verdict(mk(0.5), yes_at=0.8, no_at=0.2, model="m")
        self.assertEqual(u["verdict"], "uncertain")
        self.assertFalse(u["confident"])

    def test_fallback_record(self):
        self.assertEqual(jev.fallback("no_api_key"), {"source": "fallback", "reason": "no_api_key"})


class AskItemsTests(unittest.TestCase):
    def test_unavailable_marks_every_item(self):
        out = jev.ask_items({"x": 1, "y": 2}, CHOICE_Q, env={}, transport=ScriptedTransport())
        self.assertFalse(out["ok"])
        self.assertEqual(out["requests"], 0)
        self.assertEqual(out["results"]["x"], {"ok": False, "reason": "no_api_key"})
        self.assertEqual(out["results"]["y"], {"ok": False, "reason": "no_api_key"})

    def test_packs_items_and_unpacks_answers(self):
        body = _ok_body({
            "i0__bucket": _choice("a", 0.9),
            "i1__bucket": _choice("b", 0.6),
        })
        transport = ScriptedTransport((200, {}, body))
        out = jev.ask_items({"first": {"t": 1}, "second": {"t": 2}}, CHOICE_Q,
                            transport=transport, env=ENV_OK, items_per_request=8)
        self.assertTrue(out["ok"])
        self.assertEqual(out["requests"], 1)
        self.assertEqual(out["results"]["first"]["answers"]["bucket"]["choice"], "a")
        self.assertEqual(out["results"]["second"]["answers"]["bucket"]["choice"], "b")
        sent = transport.requests[0]
        self.assertEqual(sent["state"], {"items": {"i0": {"t": 1}, "i1": {"t": 2}}})
        self.assertEqual(set(sent["questions"]), {"i0__bucket", "i1__bucket"})
        instructions = sent["questions"]["i1__bucket"]["instructions"]
        self.assertEqual(instructions["subject"], "`items.i1`")
        self.assertEqual(instructions["question"], "Which bucket?")
        self.assertEqual(sent["questions"]["i1__bucket"]["criteria"], CHOICE_Q["bucket"]["criteria"])

    def test_chunks_by_count(self):
        transport = ScriptedTransport(
            (200, {}, _ok_body({"i0__bucket": _choice("a", 1), "i1__bucket": _choice("a", 1)})),
            (200, {}, _ok_body({"i0__bucket": _choice("b", 1)})),
        )
        out = jev.ask_items({"a": 1, "b": 2, "c": 3}, CHOICE_Q, transport=transport,
                            env=ENV_OK, items_per_request=2)
        self.assertEqual(out["requests"], 2)
        self.assertEqual(out["results"]["c"]["answers"]["bucket"]["choice"], "b")

    def test_oversized_item_is_never_sent(self):
        transport = ScriptedTransport((200, {}, _ok_body({"i0__bucket": _choice("a", 1)})))
        out = jev.ask_items({"big": "x" * 100, "small": "y"}, CHOICE_Q, transport=transport,
                            env=ENV_OK, max_state_chars=50)
        self.assertEqual(out["results"]["big"], {"ok": False, "reason": "state_too_large"})
        self.assertTrue(out["results"]["small"]["ok"])
        self.assertEqual(list(transport.requests[0]["state"]["items"]), ["i0"])

    def test_failed_chunk_marks_its_items_only(self):
        transport = ScriptedTransport(
            socket.timeout("t"),
            (200, {}, _ok_body({"i0__bucket": _choice("a", 1)})),
        )
        out = jev.ask_items({"a": 1, "b": 2}, CHOICE_Q, transport=transport,
                            env=ENV_OK, items_per_request=1)
        self.assertTrue(out["ok"])
        self.assertEqual(out["results"]["a"], {"ok": False, "reason": "timeout"})
        self.assertTrue(out["results"]["b"]["ok"])

    def test_missing_answer_for_item_is_malformed(self):
        transport = ScriptedTransport((200, {}, _ok_body({"i0__bucket": _choice("a", 1)})))
        out = jev.ask_items({"a": 1, "b": 2}, CHOICE_Q, transport=transport,
                            env=ENV_OK, items_per_request=8)
        self.assertEqual(out["results"]["b"], {"ok": False, "reason": "malformed_response"})


class CommandLineTests(unittest.TestCase):
    def _run(self, payload, env, *extra):
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "jev_client.py"), *extra],
            input=json.dumps(payload) if payload is not None else "",
            capture_output=True, text=True, env=env,
        )
        return proc.returncode, proc.stdout

    def test_check_reports_unavailable_without_key(self):
        env = {k: v for k, v in os.environ.items() if k != "TYPESAFE_API_KEY"}
        rc, out = self._run(None, env, "--check")
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), {"available": False, "reason": "no_api_key"})

    def test_request_without_key_is_unavailable_json(self):
        env = {k: v for k, v in os.environ.items() if k != "TYPESAFE_API_KEY"}
        rc, out = self._run({"state": "s", "questions": CHOICE_Q}, env)
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out)["reason"], "no_api_key")

    def test_disabled_items_request(self):
        env = dict(os.environ, TYPESAFE_API_KEY="k", JEV_DISABLED="1")
        rc, out = self._run({"items": {"a": 1}, "questions": CHOICE_Q}, env)
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out)["results"]["a"]["reason"], "disabled")

    def test_invalid_input(self):
        rc, out = self._run({"nope": 1}, dict(os.environ))
        self.assertEqual(rc, 2)
        self.assertEqual(json.loads(out)["reason"], "invalid_input")


class CopiesIdenticalTests(unittest.TestCase):
    COPIES = (
        "drover/scripts/jev_client.py",
        "ideas-funnel/scripts/jev_client.py",
        "test-lab/scripts/jev_client.py",
        "workshop/scripts/jev_client.py",
    )

    def test_every_plugin_copy_is_byte_identical(self):
        hashes = {}
        for rel in self.COPIES:
            path = REPO / rel
            self.assertTrue(path.exists(), f"missing copy: {rel}")
            hashes[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.assertEqual(len(set(hashes.values())), 1, f"copies diverged: {hashes}")


@unittest.skipUnless(os.environ.get("TYPESAFE_API_KEY") and os.environ.get("JEV_DISABLED") != "1",
                     "TYPESAFE_API_KEY not set")
class LiveSmokeTests(unittest.TestCase):
    """One real request. Costs a fraction of a cent."""

    def test_live_choice_and_noul(self):
        result = jev.ask(
            {"message": "Help! Payouts have been failing for three days."},
            {
                "urgent": {"type": "noul", "instructions": "Does this convey urgency?"},
                "topic": {"type": "choice", "instructions": "What is the message about?",
                          "criteria": {"billing": "Money, payouts, charges",
                                       "weather": "Forecasts and climate"}},
            },
        )
        self.assertTrue(result["ok"], result)
        self.assertTrue(result["model"].startswith("jev-"))
        self.assertGreater(result["answers"]["urgent"]["noul"], 0.5)
        verdict = jev.choice_verdict(result["answers"]["topic"], threshold=0.8, model=result["model"])
        self.assertEqual(verdict["choice"], "billing")
        self.assertTrue(verdict["confident"])


if __name__ == "__main__":
    unittest.main()
