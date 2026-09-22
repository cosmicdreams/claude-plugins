"""Offline tests for workshop's Jev scripts (scout and prioritize).
No network: the client's transport is replaced or the key is absent."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


scout = _load("jev_scout", ROOT / "scripts/jev_scout.py")
prioritize = _load("jev_prioritize", ROOT / "scripts/jev_prioritize.py")
ENV = {"TYPESAFE_API_KEY": "k"}
MODEL = "jev-1.13.0"


def _transport(answer):
    """Fake HTTP transport: answer(request) -> answers map."""
    def send(request, timeout):
        body = json.dumps({"model": MODEL, "answers": answer(request), "usage": {}})
        return 200, {}, body.encode()
    return send


def choice(option, confidence, options):
    probs = {o: (confidence if o == option else (1 - confidence) / (len(options) - 1)) for o in options}
    return {"type": "choice", "choice": option, "confidence": confidence, "probabilities": probs}


class ScoutTests(unittest.TestCase):
    PAYLOAD = {
        "interests": ["MCP", "Claude Code"], "anti_interests": ["crypto"],
        "baseline": [{"title": "Anthropic launches MCP registry", "summary": "registry of MCP servers"}],
        "items": [
            {"id": "1", "title": "MCP registry adds verification badges", "summary": "registry of MCP servers gains badges"},
            {"id": "2", "title": "Rust 1.90 released", "summary": "compiler notes"},
        ],
    }

    def test_unavailable_marks_every_item_fallback(self):
        out = scout.run(self.PAYLOAD, env={})
        self.assertFalse(out["ok"])
        self.assertEqual(out["reason"], "no_api_key")
        self.assertEqual(out["counts"], {"jev": 0, "fallback": 2})
        self.assertTrue(all(i["source"] == "fallback" and i["verdict"] is None for i in out["items"]))

    def test_confident_verdicts_and_dedup(self):
        def answer(request):
            answers = {}
            for key, q in request["questions"].items():
                if key == "verdict":
                    is_mcp = "MCP" in request["state"]["item"]["title"]
                    answers[key] = choice("Keep" if is_mcp else "Watch", 0.9 if is_mcp else 0.5,
                                          list(q["criteria"]))
                elif key.startswith("dedup_"):
                    answers[key] = choice("augment", 0.92, list(q["criteria"]))
                else:
                    answers[key] = {"type": "noul", "noul": 0.3}
            return answers
        out = scout.run(self.PAYLOAD, env=ENV, transport=_transport(answer))
        self.assertTrue(out["ok"])
        self.assertEqual(out["counts"], {"jev": 1, "fallback": 1})
        mcp, rust = out["items"]
        self.assertEqual((mcp["source"], mcp["verdict"]), ("jev", "Keep"))
        self.assertEqual(mcp["dedup"]["verdict"], "augment")
        self.assertEqual(mcp["dedup"]["match"], "Anthropic launches MCP registry")
        self.assertEqual(mcp["jev_verdict"]["threshold"], scout.VERDICT_CONFIDENCE_THRESHOLD)
        self.assertEqual((rust["source"], rust["reason"], rust["verdict"]), ("fallback", "low_confidence", None))
        self.assertEqual(rust["dedup"], {"verdict": "net-new", "match": None, "source": "code",
                                         "reason": "no_candidates", "candidates": []})

    def test_strong_lens_promotes_watch_to_keep(self):
        def answer(request):
            answers = {}
            for key, q in request["questions"].items():
                if key == "verdict":
                    answers[key] = choice("Watch", 0.9, list(q["criteria"]))
                elif key.startswith("dedup_"):
                    answers[key] = choice("net-new", 0.9, list(q["criteria"]))
                else:
                    answers[key] = {"type": "noul", "noul": 0.95 if key == "builder" else 0.2}
            return answers
        out = scout.run(self.PAYLOAD, env=ENV, transport=_transport(answer))
        self.assertEqual(out["items"][1]["verdict"], "Keep")
        self.assertEqual(out["items"][1]["lenses"]["builder"]["verdict"], "yes")


class PrioritizeTests(unittest.TestCase):
    def test_unavailable_is_all_fallback(self):
        out = prioritize.classify({"source": "slack", "items": [{"id": "a", "summary": "x"}]}, env={})
        self.assertEqual(out["counts"], {"jev": 0, "rule": 0, "fallback": 1})
        self.assertEqual(out["items"][0]["action_source"], "fallback")
        self.assertIsNone(out["items"][0]["action"])

    def test_rules_floor_jev_answers(self):
        def answer(request):
            answers = {}
            for key, q in request["questions"].items():
                answers[key] = choice("FYI", 0.95, list(q["criteria"]))   # Jev says FYI for everything
            return answers
        payload = {
            "source": "jira", "today": "2026-09-21", "user": {"user_id": "U1"},
            "items": [
                {"id": "due", "summary": "s", "due_date": "2026-09-20", "overdue": True},
                {"id": "blocked", "summary": "s", "status": "Blocked"},
                {"id": "mention", "summary": "s", "mentions_user": True},
                {"id": "plain", "summary": "s"},
            ],
        }
        out = prioritize.classify(payload, env=ENV, transport=_transport(answer))
        by_id = {i["id"]: i for i in out["items"]}
        self.assertEqual((by_id["due"]["action"], by_id["due"]["action_source"]), ("DUE", "rule"))
        self.assertEqual((by_id["blocked"]["action"], by_id["blocked"]["action_source"]), ("UNBLOCK", "rule"))
        self.assertEqual((by_id["mention"]["action"], by_id["mention"]["action_source"]), ("RESPOND", "rule"))
        self.assertEqual((by_id["plain"]["action"], by_id["plain"]["action_source"]), ("FYI", "jev"))
        self.assertEqual(out["counts"], {"jev": 1, "rule": 3, "fallback": 0})

    def test_confident_jev_above_floor_wins_and_unconfident_falls_back(self):
        def answer(request):
            answers = {}
            for key, q in request["questions"].items():
                conf = 0.95 if key.startswith("i0") else 0.4
                answers[key] = choice("RESPOND", conf, list(q["criteria"]))
            return answers
        payload = {"source": "jira", "today": "2026-09-21",
                   "items": [{"id": "a", "summary": "s", "overdue": True},
                             {"id": "b", "summary": "s", "overdue": True},
                             {"id": "c", "summary": "s"}]}
        out = prioritize.classify(payload, env=ENV, transport=_transport(answer))
        a, b, c = out["items"]
        self.assertEqual((a["action"], a["action_source"]), ("RESPOND", "jev"))   # RESPOND outranks DUE
        self.assertEqual((b["action"], b["action_source"]), ("DUE", "rule"))       # unconfident -> floor
        self.assertEqual(b["jev"]["reason"], "low_confidence")
        self.assertEqual((c["action"], c["action_source"]), (None, "fallback"))    # unconfident, no floor

    def test_slack_choice_has_three_options(self):
        seen = {}
        def answer(request):
            for key, q in request["questions"].items():
                seen["criteria"] = list(q["criteria"])
                return {key: choice("REVIEW", 0.9, list(q["criteria"]))}
        prioritize.classify({"source": "slack", "items": [{"id": "a", "summary": "s"}]},
                            env=ENV, transport=_transport(answer))
        self.assertEqual(seen["criteria"], ["RESPOND", "REVIEW", "FYI"])


class CommandLineTests(unittest.TestCase):
    def test_scripts_report_unavailable_without_key(self):
        env = {"PATH": "/usr/bin:/bin"}
        for script, payload in (
            ("jev_scout.py", {"items": [{"id": "1", "title": "t"}]}),
            ("jev_prioritize.py", {"source": "slack", "items": [{"id": "1", "summary": "t"}]}),
        ):
            proc = subprocess.run([sys.executable, str(ROOT / "scripts" / script)],
                                  input=json.dumps(payload), capture_output=True, text=True, env=env)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(json.loads(proc.stdout)["reason"], "no_api_key")


if __name__ == "__main__":
    unittest.main()
