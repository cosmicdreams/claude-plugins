"""Unit tests for drover.scripts.charts (slice 11)."""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest

HERE = pathlib.Path(__file__).resolve()
SCRIPTS = HERE.parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

spec = importlib.util.spec_from_file_location(
    "drover_charts", SCRIPTS / "charts.py",
)
charts = importlib.util.module_from_spec(spec)
sys.modules["drover_charts"] = charts
spec.loader.exec_module(charts)


class HorizontalBarChartTests(unittest.TestCase):
    def test_empty_items_renders_no_data(self):
        out = charts.horizontal_bar_chart([])
        self.assertIn("(no data)", out)
        self.assertIn("```", out)

    def test_single_item_full_bar(self):
        out = charts.horizontal_bar_chart([("only", 42)])
        # The single bar should occupy the full width
        self.assertIn(charts.BAR_CHAR * charts.DEFAULT_WIDTH, out)
        self.assertIn("only", out)
        self.assertIn("42", out)

    def test_proportional_widths(self):
        out = charts.horizontal_bar_chart(
            [("a", 100), ("b", 50), ("c", 25)],
            width=20,
        )
        # Three rows; "a" fully filled, "b" half, "c" quarter
        lines = [l for l in out.splitlines() if l.startswith(("a ", "b ", "c "))]
        self.assertEqual(len(lines), 3)
        # 100 -> full, 50 -> half, 25 -> quarter
        self.assertTrue(lines[0].count(charts.BAR_CHAR) >= lines[1].count(charts.BAR_CHAR))
        self.assertTrue(lines[1].count(charts.BAR_CHAR) >= lines[2].count(charts.BAR_CHAR))

    def test_top_n_truncates(self):
        items = [(f"row{i}", 10 - i) for i in range(15)]
        out = charts.horizontal_bar_chart(items, top_n=5)
        # Only 5 rendered, plus the "and N more" line
        self.assertIn("… and 10 more", out)

    def test_long_label_truncated_with_ellipsis(self):
        out = charts.horizontal_bar_chart(
            [("a" * 100, 1)],
            label_width=20,
        )
        self.assertIn("…", out)

    def test_show_pct_false_omits_percentage(self):
        out = charts.horizontal_bar_chart(
            [("x", 10), ("y", 5)], show_pct=False,
        )
        self.assertNotIn("%", out)

    def test_show_pct_true_includes_percentage(self):
        out = charts.horizontal_bar_chart(
            [("x", 80), ("y", 20)], show_pct=True,
        )
        self.assertIn("80.0%", out)
        self.assertIn("20.0%", out)


class ChannelBarChartTests(unittest.TestCase):
    def test_sorts_by_count_descending(self):
        out = charts.channel_bar_chart(
            {"low": 1, "high": 100, "mid": 50},
        )
        # Find positions of each label in output
        pos_high = out.index("high")
        pos_mid = out.index("mid")
        pos_low = out.index("low")
        self.assertLess(pos_high, pos_mid)
        self.assertLess(pos_mid, pos_low)

    def test_empty_dict(self):
        out = charts.channel_bar_chart({})
        self.assertIn("(no data)", out)


class SeverityBarChartTests(unittest.TestCase):
    def test_canonical_order_preserved(self):
        out = charts.severity_bar_chart({
            "info": 1, "critical": 1, "warning": 1, "error": 1,
        })
        # critical → error → warning → notice → info → unknown
        crit_pos = out.index("critical")
        err_pos = out.index("error")
        warn_pos = out.index("warning")
        info_pos = out.index("info")
        self.assertLess(crit_pos, err_pos)
        self.assertLess(err_pos, warn_pos)
        self.assertLess(warn_pos, info_pos)

    def test_non_canonical_severity_appended(self):
        out = charts.severity_bar_chart({
            "error": 10, "weirdo": 5,
        })
        # Both appear; weirdo is after error
        self.assertIn("weirdo", out)
        err_pos = out.index("error")
        weirdo_pos = out.index("weirdo")
        self.assertLess(err_pos, weirdo_pos)


if __name__ == "__main__":
    unittest.main()
