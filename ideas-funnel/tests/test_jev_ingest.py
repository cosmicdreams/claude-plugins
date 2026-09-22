"""Offline tests for ideas-funnel's Jev ranking and dedup script. No network."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("jev_ingest", ROOT / "scripts/jev_ingest.py")
ingest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingest)

ENV = {"TYPESAFE_API_KEY": "k"}
INDEX = """# Index
## Concepts
- [[Domains/AI-Workflows/MCP|Model Context Protocol]] — open protocol connecting models to tools
- [[Domains/Drupal/Recipes|Drupal Recipes]] — composable install configuration
## Sources
- [[Sources/2026-09-01-mcp-registry|Anthropic launches MCP registry]] — registry of MCP servers announced
"""


def _transport(answer):
    def send(request, timeout):
        return 200, {}, json.dumps({"model": "jev-1.13.0", "answers": answer(request), "usage": {}}).encode()
    return send


def score(value, confidence):
    return {"type": "score", "score": value, "confidence": confidence, "probabilities": {}, "legend": {}}


def choice(option, confidence):
    probs = {o: (confidence if o == option else (1 - confidence) / 2) for o in ingest.DEDUP_CRITERIA}
    return {"type": "choice", "choice": option, "confidence": confidence, "probabilities": probs}


class IngestTests(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        root = Path(self.td.name)
        self.index = root / "index.md"
        self.index.write_text(INDEX)
        self.mcp = root / "mcp.md"
        self.mcp.write_text("---\ntitle: \"MCP registry adds verification badges\"\norigin: https://x\n---\n"
                            "The Model Context Protocol registry of MCP servers now shows verification badges.\n")
        self.other = root / "other.md"
        self.other.write_text("# Rust 1.90 released\nCompiler release notes.\n")

    def tearDown(self):
        self.td.cleanup()

    def test_index_and_candidates(self):
        pages = ingest.read_index(self.index)
        self.assertEqual([p["page"] for p in pages],
                         ["Domains/AI-Workflows/MCP", "Domains/Drupal/Recipes", "Sources/2026-09-01-mcp-registry"])
        item = ingest.read_item(self.mcp)
        self.assertEqual(item["title"], "MCP registry adds verification badges")
        self.assertEqual(item["origin"], "https://x")
        candidates = ingest.find_candidates(item, pages)
        self.assertTrue(candidates)
        self.assertTrue(all("MCP" in c["title"] or "Model Context" in c["title"] for c in candidates))
        self.assertEqual(ingest.find_candidates(ingest.read_item(self.other), pages), [])

    def test_unavailable_marks_everything_fallback(self):
        out = ingest.run([self.mcp, self.other], self.index, env={})
        self.assertFalse(out["ok"])
        self.assertEqual(out["reason"], "no_api_key")
        self.assertEqual(out["counts"], {"jev": 0, "fallback": 2})
        self.assertTrue(all(i["source"] == "fallback" and i["rank_score"] is None for i in out["items"]))
        self.assertEqual(out["items"][0]["dedup"]["source"], "fallback")

    def test_confident_scores_rank_and_dedup_resolves(self):
        def answer(request):
            answers = {}
            for key, q in request["questions"].items():
                if q["type"] == "score":
                    answers[key] = score(2.5 if "MCP" in request["state"]["item"]["title"] else 1.0, 0.9)
                else:
                    page = q["instructions"]["candidate"]["page"]
                    answers[key] = choice("augment" if page.endswith("MCP") else "new", 0.95)
            return answers
        out = ingest.run([self.other, self.mcp], self.index, env=ENV, transport=_transport(answer))
        self.assertTrue(out["ok"])
        self.assertEqual(out["counts"], {"jev": 2, "fallback": 0})
        first, second = out["items"]
        self.assertEqual(first["title"], "MCP registry adds verification badges")   # ranked first
        self.assertAlmostEqual(first["rank_score"], 2.5)
        self.assertEqual(first["dedup"]["verdict"], "augment")
        self.assertEqual(first["dedup"]["page"], "Domains/AI-Workflows/MCP")
        self.assertEqual(first["scores"]["novelty"]["threshold"], ingest.SCORE_CONFIDENCE_THRESHOLD)
        self.assertEqual(second["dedup"], {"verdict": None, "page": None, "source": "fallback",
                                           "reason": "no_candidates", "candidates": []})

    def test_unconfident_score_sends_item_to_fallback(self):
        def answer(request):
            return {key: (score(2.0, 0.3) if q["type"] == "score" else choice("new", 0.95))
                    for key, q in request["questions"].items()}
        out = ingest.run([self.mcp], self.index, env=ENV, transport=_transport(answer))
        item = out["items"][0]
        self.assertEqual((item["source"], item["reason"], item["rank_score"]), ("fallback", "low_confidence", None))
        self.assertEqual(item["dedup"]["verdict"], "new")       # dedup still confident, still usable
        self.assertEqual(out["counts"], {"jev": 0, "fallback": 1})

    def test_command_line_without_key(self):
        proc = subprocess.run([sys.executable, str(ROOT / "scripts/jev_ingest.py"), "--index", str(self.index),
                               str(self.mcp)], capture_output=True, text=True, env={"PATH": "/usr/bin:/bin"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["reason"], "no_api_key")


if __name__ == "__main__":
    unittest.main()
