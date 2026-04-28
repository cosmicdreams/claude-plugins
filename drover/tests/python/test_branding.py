"""Unit tests for drover.scripts.branding (slice 11)."""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest

HERE = pathlib.Path(__file__).resolve()
SCRIPTS = HERE.parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

spec = importlib.util.spec_from_file_location(
    "drover_branding", SCRIPTS / "branding.py",
)
branding = importlib.util.module_from_spec(spec)
sys.modules["drover_branding"] = branding
spec.loader.exec_module(branding)


class PaletteTests(unittest.TestCase):
    def test_primary_navy_format(self):
        self.assertTrue(branding.PRIMARY_NAVY.startswith("#"))
        self.assertEqual(len(branding.PRIMARY_NAVY), 7)

    def test_severity_color_set_complete(self):
        for sev in ("critical", "error", "warning", "notice",
                    "info", "unknown"):
            self.assertIn(sev, branding.SEVERITY_COLORS)


class LogoTests(unittest.TestCase):
    def test_logo_data_uri_returns_png(self):
        uri = branding.logo_data_uri()
        # Vendored asset present in the repo
        self.assertTrue(uri.startswith("data:image/png;base64,"))

    def test_logo_markdown_wraps_in_image_tag(self):
        md = branding.logo_markdown()
        self.assertTrue(md.startswith("![Velir]("))
        self.assertTrue(md.endswith(")"))


class BannerTests(unittest.TestCase):
    def test_banner_kinds(self):
        self.assertIn("⚠", branding.banner("hi", kind="warning"))
        self.assertIn("✅", branding.banner("ok", kind="success"))
        self.assertIn("🛑", branding.banner("bad", kind="critical"))
        self.assertIn("ℹ", branding.banner("note", kind="info"))

    def test_banner_default_kind_is_info(self):
        self.assertIn("ℹ", branding.banner("hello"))

    def test_banner_renders_as_markdown_blockquote(self):
        out = branding.banner("test", kind="warning")
        self.assertTrue(out.startswith("> "))
        self.assertIn("**test**", out)


if __name__ == "__main__":
    unittest.main()
