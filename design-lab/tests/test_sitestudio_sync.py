"""Site Studio configuration exported to its own sync directory."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import detect

COMPONENT = "cohesion_elements.cohesion_component.cpt_hero.yml"


def site(tmp, settings_line=None, sync="config/sitestudio"):
    root = Path(tmp)
    (root / "docroot/sites/default").mkdir(parents=True)
    (root / "docroot/themes").mkdir()
    (root / "config/default").mkdir(parents=True)
    (root / "config/default/system.site.yml").write_text("name: x\n")
    (root / sync).mkdir(parents=True, exist_ok=True)
    (root / sync / COMPONENT).write_text("id: cpt_hero\n")
    if settings_line:
        (root / "docroot/sites/default/settings.php").write_text("<?php\n" + settings_line + "\n")
    return root


class SiteStudioSyncTests(unittest.TestCase):
    def test_settings_path_relative_to_app_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp, "$settings['site_studio_sync'] = $app_root . '/../ss-export';", "ss-export")
            self.assertEqual(detect.sitestudio_dir(str(root)), str(root / "ss-export"))

    def test_conventional_directory_without_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp)
            self.assertEqual(detect.sitestudio_dir(str(root)), str(root / "config/sitestudio"))

    def test_detect_reports_sitestudio_components(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp, "$settings['site_studio_sync'] = $app_root . '/../config/sitestudio';")
            out = detect.detect(str(root))
            self.assertEqual([s["strategy"] for s in out["componentSources"]], ["sitestudio"])

    def test_falls_back_to_config_sync(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "config/default").mkdir(parents=True)
            self.assertEqual(detect.sitestudio_dir(str(root), "fallback"), "fallback")


if __name__ == "__main__":
    unittest.main()
