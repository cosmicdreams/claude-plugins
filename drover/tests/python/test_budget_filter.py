"""Tests for drover/scripts/monitors/budget-filter.py — stdlib unittest."""
import importlib.util
import pathlib
import time
import unittest

HERE = pathlib.Path(__file__).resolve()
SCRIPT = HERE.parents[2] / "scripts" / "monitors" / "budget_filter.py"

spec = importlib.util.spec_from_file_location("budget_filter", SCRIPT)
bf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bf)


class TestBudgetFilter(unittest.TestCase):
    def test_under_budget_passes_through(self):
        f = bf.BudgetFilter(max_events=10, window_seconds=60)
        out = [f.handle("[pncb-main] NEW abc error php pncb.prod msg") for _ in range(5)]
        # All five pass, none are suppressed.
        self.assertEqual(len([o for o in out if o is not None]), 5)
        self.assertEqual(f.suppressed_since_summary(), 0)

    def test_overflow_suppresses_excess(self):
        f = bf.BudgetFilter(max_events=3, window_seconds=60)
        results = [f.handle(f"[x] NEW fp{i} error src env msg") for i in range(10)]
        emitted = [r for r in results if r is not None]
        # Only 3 NEW lines survive; remaining 7 are suppressed.
        self.assertEqual(len(emitted), 3)
        self.assertEqual(f.suppressed_since_summary(), 7)

    def test_non_new_lines_are_always_passed(self):
        f = bf.BudgetFilter(max_events=1, window_seconds=60)
        # Budget already spent on first NEW.
        f.handle("[x] NEW fp0 error src env msg")
        passed = f.handle("[x] THRESH fp0 count=50 error src env")
        self.assertIsNotNone(passed)
        passed2 = f.handle("[x] TRAFFIC env=pncb.prod count=1000")
        self.assertIsNotNone(passed2)

    def test_sliding_window_expires_old_events(self):
        f = bf.BudgetFilter(max_events=2, window_seconds=1, now_fn=lambda: time.monotonic())
        # Inject two with t=0 using a fixed clock.
        t = [0.0]
        f = bf.BudgetFilter(max_events=2, window_seconds=1, now_fn=lambda: t[0])
        self.assertIsNotNone(f.handle("[x] NEW a error s e m"))
        self.assertIsNotNone(f.handle("[x] NEW b error s e m"))
        self.assertIsNone(f.handle("[x] NEW c error s e m"))
        # Advance time past the window; c should now be admissible.
        t[0] = 1.5
        self.assertIsNotNone(f.handle("[x] NEW d error s e m"))

    def test_summary_line_emitted_after_suppression(self):
        f = bf.BudgetFilter(max_events=1, window_seconds=60, summary_every=3)
        f.handle("[x] NEW a error s e m")
        for _ in range(3):
            f.handle("[x] NEW b error s e m")
        summary = f.flush_summary()
        self.assertIsNotNone(summary)
        self.assertIn("suppressed", summary.lower())
        self.assertIn("3", summary)


if __name__ == "__main__":
    unittest.main()
