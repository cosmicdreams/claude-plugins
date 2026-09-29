"""Ticket recommendation contract for drover evidence."""
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("process_ticket_recs", ROOT / "scripts" / "ticket_recs.py")
recs = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = recs
SPEC.loader.exec_module(recs)
FIXTURE = ROOT / "tests" / "fixtures" / "drover-evidence.json"


class TicketRecsTests(unittest.TestCase):
    def setUp(self):
        self.evidence = json.loads(FIXTURE.read_text())

    def test_priority_thresholds(self):
        self.assertEqual(recs._suggest_priority("critical", 1, 100000), "P0")
        self.assertEqual(recs._suggest_priority("error", 10000, 100000), "P0")
        self.assertEqual(recs._suggest_priority("error", 100, 100000), "P1")
        self.assertEqual(recs._suggest_priority("warning", 10000, 100000), "P1")
        self.assertEqual(recs._suggest_priority("unknown", 30000, 100000), "P1")
        self.assertEqual(recs._suggest_priority("unknown", 10, 100000), "P3")

    def test_titles_cleaned(self):
        title = recs._suggest_title("user", 'Failed https://example.com/x request_id="abc"')
        self.assertEqual(title, "[user] Failed")
        self.assertTrue(recs._suggest_title("ch", "x" * 500).endswith("…"))
        self.assertEqual(recs._suggest_title(None, ""), "Application error")

    def test_fixture_groups_and_cause(self):
        specs = recs.from_evidence(self.evidence, jev=None)
        self.assertEqual(len(specs), 1)
        spec = specs[0]
        self.assertEqual(spec.priority, "P0")
        self.assertIn("2 fingerprints", spec.description)
        self.assertIn("solr-b", spec.description)
        self.assertIn("Solr flood limit", spec.description)
        self.assertIn("raw Solr flood line", spec.description)
        self.assertIn("suggested", spec.labels)
        self.assertIn("drover", spec.labels)
        self.assertIn("drover-channel-search-api", spec.labels)
        self.assertNotIn("request_id", spec.title)
        self.assertNotIn("jev_ticket_worthiness", json.loads(recs.to_json(specs))[0])
        self.assertIn("**P0**", recs.render_markdown(specs))

    def test_top_n_and_min_count_overrides(self):
        evidence = self.evidence
        evidence["groups"] = [dict(evidence["groups"][0], fingerprint=f"f{i}", count=100-i) for i in range(8)]
        strategy = recs.load_strategy()
        strategy.update(min_count=94, top_n=3)
        self.assertEqual(len(recs.from_evidence(evidence, strategy=strategy)), 3)
        strategy["min_count"] = 99
        self.assertEqual(len(recs.from_evidence(evidence, strategy=strategy)), 2)

    def test_project_strategy_override(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            (root / ".velir").mkdir()
            (root / ".velir" / "project.json").write_text(json.dumps({
                "jira_strategy": {"min_count": 10, "labels": ["suggested", "drover", "review"],
                                  "priority_thresholds": {"error_p0_share_pct": 25}}
            }))
            strategy = recs.load_strategy(root)
            specs = recs.from_evidence(self.evidence, strategy=strategy)
            self.assertEqual(len(specs), 2)
            self.assertEqual(specs[0].priority, "P1")
            self.assertIn("review", specs[0].labels)

    def test_jev_annotation_cannot_change_selection_or_priority(self):
        class FakeJev:
            def ask_items(self, items, question):
                self.items = items
                return {"results": {"0": {"ok": True, "answers": {"worth": {"score": 2.9}}}},
                        "model": "test", "reason": None}
            def score_verdict(self, answer, *, threshold, model):
                return {"source": "jev", "confident": True, "level": 3,
                        "confidence": 0.9, "model": model, "threshold": threshold}
        base = recs.from_evidence(self.evidence, jev=None)
        fake = FakeJev()
        specs = recs.from_evidence(self.evidence, jev=fake)
        self.assertEqual([s.fingerprint for s in specs], [s.fingerprint for s in base])
        self.assertEqual(specs[0].priority, base[0].priority)
        self.assertIn("Jev ticket-worthiness", specs[0].description)
        self.assertEqual(list(fake.items), ["0"])

    def test_cli_json(self):
        with mock.patch.object(recs, "resolve_jev", return_value=None):
            with mock.patch("sys.stdout") as stdout:
                self.assertEqual(recs.cli_main(["--evidence", str(FIXTURE), "--format", "json"]), 0)
                self.assertIn("solr-a", stdout.write.call_args_list[0].args[0])


if __name__ == "__main__":
    unittest.main()
