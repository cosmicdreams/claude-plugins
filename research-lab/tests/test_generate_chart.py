import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "generate-chart.py"

class ChartTests(unittest.TestCase):
    def chart(self, records):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "results.jsonl"
            path.write_text("".join(json.dumps(r) + "\n" for r in records))
            return subprocess.check_output(["python3", str(SCRIPT), str(path), "--width", "9", "--height", "3"], text=True)

    def test_scripted_output_is_unchanged(self):
        records = [dict(iteration=1, metric_before=10, metric_after=8, ratchet=8, decision="keep")]
        self.assertEqual(self.chart(records), EXPECTED)

    def test_judged_summary_uses_latest_confirmed_metric_and_ignores_non_trials(self):
        # scope.md chart: ignored events neither reset nor extend the streak.
        records = [
            dict(iteration=0, metric_after=None, ratchet=5, decision="calibrate", metric_type="judged"),
            dict(iteration=1, metric_before=5, metric_after=4, ratchet=5, decision="discard", metric_type="judged"),
            dict(iteration=2, metric_before=5, metric_after=4, ratchet=5, decision="discard", metric_type="judged"),
            dict(iteration=2, metric_after=None, ratchet=5, decision="invalid", metric_type="judged"),
            dict(iteration=3, metric_before=5, metric_after=4, ratchet=5, decision="discard", metric_type="judged"),
            dict(iteration=3, metric_after=None, ratchet=5.5, decision="confirm", metric_type="judged"),
            dict(iteration=3, metric_after=None, ratchet=5.5, decision="calibrate", metric_type="judged"),
            dict(iteration=4, metric_after=None, ratchet=5.5, decision="skip", reason="withdrawn: by Chris", metric_type="judged"),
            dict(iteration=5, metric_before=5.5, metric_after=5, ratchet=5.5, decision="discard", metric_type="judged"),
        ]
        output = self.chart(records)
        self.assertIn("judged", output.lower())
        self.assertNotIn("Improvement:", output)
        self.assertIn("5.5", output)
        self.assertIn("Latest calibrated/confirmed M", output)
        self.assertIn("Longest discard streak: 4", output)

    def test_judged_ignored_records_do_not_extend_streak(self):
        # scope.md chart: extending ignored records gives >1, ignoring gives 1.
        records = [dict(iteration=i, metric_before=5, metric_after=4, ratchet=5,
                        decision=decision, metric_type="judged",
                        reason="withdrawn: by Chris" if decision == "skip" else "fixture")
                   for i, decision in enumerate(
                       ["discard", "invalid", "calibrate", "confirm", "skip", "keep", "discard"], 1)]
        output = self.chart(records)
        self.assertIn("judged", output.lower())
        self.assertNotIn("Improvement:", output)
        self.assertIn("Longest discard streak: 1", output)

EXPECTED = '\n  Metric Progression (1 iterations)\n  =========\n  8.000 |         |\n  7.500 |         |\n  7.000 |    K    |\n  =========\n         1   1   1\n\n  Legend: K = keep, x = discard, - = ratchet line\n\n  Summary\n  -------\n  Total iterations: 1\n  Keeps: 1  Discards: 0  Skips: 0\n  Baseline: 10\n  Final ratchet: 8\n  Improvement: 20.0%\n  Direction: lower is better\n  Longest discard streak: 0\n'
