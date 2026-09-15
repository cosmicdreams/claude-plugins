"""Offline regression tests of the working-tree measurement harness."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "skills/experiment/scripts/measure.sh"
BASE = "https://measurement.invalid"


class MeasureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.calls = self.root / "calls.jsonl"
        self.fixture = self.root / "responses.json"
        self.env = {
            **os.environ,
            "PATH": str(self.root) + os.pathsep + os.environ["PATH"],
            "MEASURE_RESPONSES": str(self.fixture),
            "MEASURE_CALLS": str(self.calls),
        }
        self.fake("curl", """
import json, os, sys
args = sys.argv[1:]
assert args[:-1] == ["-fsS", "-o", "/dev/null", "--connect-timeout", "5",
                    "--max-time", "30", "-w", "%{time_starttransfer}"], args
with open(os.environ["MEASURE_CALLS"], "a") as log:
    log.write(json.dumps(args[-1]) + "\\n")
with open(os.environ["MEASURE_RESPONSES"]) as source:
    timing, status = json.load(source)[args[-1]]
sys.stdout.write(timing)
sys.exit(status)
""")
        self.fake("bc", """
from decimal import Decimal, ROUND_DOWN
import os, sys
expression = sys.stdin.read().strip()
if expression.startswith("scale=3;") and "MEASURE_BC_OUTPUT" in os.environ:
    sys.stdout.write(os.environ["MEASURE_BC_OUTPUT"])
    sys.exit(int(os.environ.get("MEASURE_BC_STATUS", "0")))
try:
    if expression.startswith("scale=3;"):
        left, right = expression.removeprefix("scale=3;").split("/")
        value = (Decimal(left.strip()) / Decimal(right.strip())).quantize(
            Decimal("0.001"), rounding=ROUND_DOWN)
    else:
        left, right = expression.split("+")
        value = Decimal(left.strip()) + Decimal(right.strip())
    if not value.is_finite():
        raise ValueError("nonfinite")
    print(format(value, "f"))
except Exception:
    print("invalid bc expression", file=sys.stderr)
    sys.exit(1)
""")

    def fake(self, name, source):
        path = self.root / name
        path.write_text(f"#!{sys.executable}\n" + source)
        path.chmod(0o755)

    def measure(self, responses, pages=None, base=BASE):
        self.fixture.write_text(json.dumps(responses))
        self.calls.write_text("")
        args = [] if base is None else [base] + ([] if pages is None else pages)
        return subprocess.run(
            ["bash", str(SCRIPT), *args], cwd=self.root, env=self.env,
            text=True, capture_output=True, timeout=10,
        )

    def assert_invalid(self, result, failed, requested):
        self.assertNotEqual(result.returncode, 0, result)
        self.assertEqual(result.stdout, "", result)
        self.assertIn(f"{failed} of {requested} pages failed", result.stderr)

    def test_complete_samples_preserve_page_mean(self):
        for timings, expected in [
            (["0.100", "0.100"], 0.1),
            (["0.010", "2.000"], 1.005),
            (["3.750"], 3.75),
            (["0"], 0.0),
            (["0.000", "0.200"], 0.1),
        ]:
            with self.subTest(timings=timings):
                pages = [f"/{i}" for i in range(len(timings))]
                result = self.measure(
                    {BASE + p: [t, 0] for p, t in zip(pages, timings)}, pages)
                self.assertEqual(result.returncode, 0, result)
                self.assertEqual(float(result.stdout), expected)
                self.assertEqual(len(result.stdout.splitlines()), 1)

    def test_partial_and_all_request_failures_invalidate_whole_sample(self):
        for statuses in [[0, 22], [28, 0], [22, 0, 28], [22], [22, 28]]:
            with self.subTest(statuses=statuses):
                pages = [f"/{i}" for i in range(len(statuses))]
                result = self.measure(
                    {BASE + p: ["0.100", s] for p, s in zip(pages, statuses)},
                    pages)
                self.assert_invalid(result, sum(s != 0 for s in statuses), len(pages))
                self.assertEqual(
                    [json.loads(line) for line in self.calls.read_text().splitlines()],
                    [BASE + p for p in pages])

    def test_bad_timing_invalidates_sample(self):
        for timing in ["", "NaN", "nan", "inf", "Infinity", "-0.1",
                       "garbage", "0.1\n0.2", "1+2", " 0.1", "1e999"]:
            with self.subTest(timing=timing):
                result = self.measure({
                    BASE + "/good": ["0.200", 0],
                    BASE + "/bad": [timing, 0],
                }, ["/good", "/bad"])
                self.assert_invalid(result, 1, 2)

    def test_invalid_calculator_output_never_becomes_metric(self):
        for output, status in [
            ("99\\\n99\n", 0), ("garbage\n", 0), ("", 0),
            ("NaN\n", 0), ("-0.1\n", 0), ("0.1\n0.2\n", 0),
            ("0.123\n", 1),
        ]:
            with self.subTest(output=output, status=status):
                self.env["MEASURE_BC_OUTPUT"] = output
                self.env["MEASURE_BC_STATUS"] = str(status)
                result = self.measure({BASE + "/": ["0.123", 0]})
                self.assertNotEqual(result.returncode, 0, result)
                self.assertEqual(result.stdout, "", result)
                self.assertIn("invalid sample", result.stderr)

    def test_valid_calculator_decimal_formats(self):
        for output in [".123\n", "0.123\n", "0\n"]:
            with self.subTest(output=output):
                self.env["MEASURE_BC_OUTPUT"] = output
                result = self.measure({BASE + "/": ["0.123", 0]})
                self.assertEqual(result.returncode, 0, result)
                self.assertEqual(result.stdout, output)

    def test_no_pages_defaults_to_root_and_trims_base_slash(self):
        result = self.measure({BASE + "/": ["0.125", 0]}, base=BASE + "/")
        self.assertEqual(result.returncode, 0, result)
        self.assertEqual(float(result.stdout), 0.125)

    def test_explicit_empty_page_is_base_url_not_default_root(self):
        result = self.measure({BASE: ["0.125", 0]}, [""])
        self.assertEqual(result.returncode, 0, result)
        self.assertEqual(float(result.stdout), 0.125)

    def test_missing_or_empty_url_retains_usage_error(self):
        for base in [None, ""]:
            with self.subTest(base=base):
                result = self.measure({}, base=base)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertIn("Usage: measure.sh <url> [pages...]", result.stderr)
                self.assertEqual(self.calls.read_text(), "")


if __name__ == "__main__":
    unittest.main()
