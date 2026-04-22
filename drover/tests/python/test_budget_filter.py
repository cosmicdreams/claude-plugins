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


class TestCrossEnvDedup(unittest.TestCase):
    def test_same_fp_in_different_envs_within_window_is_suppressed(self):
        t = [0.0]
        d = bf.CrossEnvDedup(window_seconds=60, now_fn=lambda: t[0])
        first = d.handle("[ddev:siteA] NEW abc123 error php local oh no")
        second = d.handle("[acquia:siteA-prod] NEW abc123 error php prod oh no")
        self.assertIsNotNone(first)
        self.assertIsNone(second)

    def test_same_fp_same_env_is_not_suppressed_by_dedup(self):
        t = [0.0]
        d = bf.CrossEnvDedup(window_seconds=60, now_fn=lambda: t[0])
        a = d.handle("[ddev:siteA] NEW abc123 error php local oh no")
        b = d.handle("[ddev:siteA] NEW abc123 error php local oh no")
        self.assertIsNotNone(a)
        self.assertIsNotNone(b)

    def test_window_expiry_allows_cross_env_again(self):
        t = [0.0]
        d = bf.CrossEnvDedup(window_seconds=60, now_fn=lambda: t[0])
        d.handle("[ddev:siteA] NEW abc123 error php local oh no")
        self.assertIsNone(d.handle("[acquia:siteA-prod] NEW abc123 error php prod oh no"))
        t[0] = 120.0
        self.assertIsNotNone(d.handle("[acquia:siteA-prod] NEW abc123 error php prod oh no"))

    def test_summary_reports_multi_env_span(self):
        t = [0.0]
        d = bf.CrossEnvDedup(window_seconds=60, now_fn=lambda: t[0])
        d.handle("[ddev:siteA] NEW abc123 error php local oh no")
        d.handle("[acquia:siteA-stg] NEW abc123 error php stg oh no")
        d.handle("[acquia:siteA-prod] NEW abc123 error php prod oh no")
        summaries = d.flush_multi_env_summaries()
        self.assertEqual(len(summaries), 1)
        line = summaries[0]
        self.assertIn("abc123", line)
        self.assertIn("multi-env", line)
        for env in ("local", "stg", "prod"):
            self.assertIn(env, line)

    def test_non_new_lines_are_passed_through(self):
        d = bf.CrossEnvDedup(window_seconds=60)
        self.assertIsNotNone(d.handle("[x] THRESH abc count=50"))
        self.assertIsNotNone(d.handle("[x] TRAFFIC env=pncb.prod count=1000"))
        self.assertIsNotNone(d.handle("random unrelated noise"))


if __name__ == "__main__":
    unittest.main()
