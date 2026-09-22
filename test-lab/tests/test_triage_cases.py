"""Offline tests for test-lab's Jev triage script. No network."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("triage_cases", ROOT / "scripts/triage_cases.py")
triage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(triage)

ENV = {"TYPESAFE_API_KEY": "k"}
BUCKETS = list(triage.BUCKETS)
CASES = [
    {"id": "C1", "title": "Footer links", "steps": "Open home page", "expected": "links work"},
    {"id": "C2", "title": "Admin creates article", "steps": "Log in as admin", "expected": "saved"},
    {"id": "C3", "title": "Banner matches design", "expected": "looks correct"},
]


def _transport(pick):
    def send(request, timeout):
        answers = {}
        for key, q in request["questions"].items():
            item_key = key.split("__")[0]
            option, confidence = pick(request["state"]["items"][item_key])
            probs = {o: (confidence if o == option else (1 - confidence) / 4) for o in BUCKETS}
            answers[key] = {"type": "choice", "choice": option, "confidence": confidence,
                            "probabilities": probs}
        return 200, {}, json.dumps({"model": "jev-1.13.0", "answers": answers, "usage": {}}).encode()
    return send


class TriageTests(unittest.TestCase):
    def test_bucket_table_matches_skill(self):
        self.assertEqual(BUCKETS, ["anonymous front end", "needs authentication", "form submission",
                                   "human judgement", "out of scope"])

    def test_unavailable_returns_all_fallback(self):
        out = triage.triage(CASES, env={})
        self.assertFalse(out["ok"])
        self.assertEqual(out["counts"], {"jev": 0, "fallback": 3})
        self.assertEqual(out["verdicts"]["C1"], {"source": "fallback", "reason": "no_api_key", "bucket": None})

    def test_confident_and_uncertain_routing(self):
        def pick(item):
            if "Admin" in item["title"]:
                return "needs authentication", 0.97
            if "Banner" in item["title"]:
                return "human judgement", 0.55       # below threshold -> agent decides
            return "anonymous front end", 0.9
        out = triage.triage(CASES, scope="A marketing site", env=ENV, transport=_transport(pick))
        self.assertTrue(out["ok"])
        self.assertEqual(out["model"], "jev-1.13.0")
        self.assertEqual(out["counts"], {"jev": 2, "fallback": 1})
        v = out["verdicts"]
        self.assertEqual((v["C1"]["source"], v["C1"]["bucket"]), ("jev", "anonymous front end"))
        self.assertEqual((v["C2"]["source"], v["C2"]["bucket"]), ("jev", "needs authentication"))
        self.assertEqual(v["C2"]["threshold"], triage.BUCKET_CONFIDENCE_THRESHOLD)
        self.assertEqual((v["C3"]["source"], v["C3"]["reason"], v["C3"]["bucket"]),
                         ("fallback", "low_confidence", None))
        self.assertEqual(v["C3"]["choice"], "human judgement")   # still visible for the agent

    def test_scope_travels_in_the_question(self):
        seen = {}
        def send(request, timeout):
            seen["q"] = next(iter(request["questions"].values()))
            return 500, {}, b""
        triage.triage(CASES[:1], scope="Only the public site", env=ENV, transport=send)
        self.assertEqual(seen["q"]["instructions"]["system_under_test"], "Only the public site")
        self.assertEqual(seen["q"]["criteria"], triage.BUCKETS)

    def test_command_line_without_key(self):
        proc = subprocess.run([sys.executable, str(ROOT / "scripts/triage_cases.py")],
                              input=json.dumps(CASES), capture_output=True, text=True,
                              env={"PATH": "/usr/bin:/bin"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["reason"], "no_api_key")


if __name__ == "__main__":
    unittest.main()
