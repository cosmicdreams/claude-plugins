"""Site Studio's two sources: the export folder the site's settings declare, and custom components."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import detect
import extract_sitestudio
import sitestudio_source as source
import workflow

COMPONENT = "cohesion_elements.cohesion_component.cpt_hero.yml"
STYLE = "cohesion_custom_styles.cohesion_custom_style.button.yml"
FIXTURE = Path(__file__).parent / "fixtures/sitestudio_custom"


def site(tmp, settings=None, export=None, settings_file="settings.php"):
    root = Path(tmp)
    (root / "docroot/sites/default").mkdir(parents=True)
    (root / "docroot/themes/custom").mkdir(parents=True)
    (root / "config/default").mkdir(parents=True)
    (root / "config/default/system.site.yml").write_text("name: x\n")
    if export:
        (root / export).mkdir(parents=True, exist_ok=True)
        (root / export / COMPONENT).write_text("id: cpt_hero\n")
        (root / export / STYLE).write_text("id: button\n")
    if settings:
        (root / "docroot/sites/default" / settings_file).write_text("<?php\n" + settings + "\n")
    return root


class ExportFolderTests(unittest.TestCase):
    def folder(self, settings, export, **kw):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp, settings, export, **kw)
            found = source.config_dir(str(root))
            return (found["path"] and str(Path(found["path"]).relative_to(root))), found

    def test_every_form_of_the_setting_is_read_without_running_php(self):
        cases = {
            "$settings['site_studio_sync'] = $app_root . '/../config/sitestudio';": "config/sitestudio",
            "$settings['site_studio_sync'] ='../config/packages';": "config/packages",
            "$settings[\"site_studio_sync\"] = DRUPAL_ROOT . '/../export';": "export",
            "$settings['site_studio_sync'] = __DIR__ . '/../../../ss';": "ss",
            "$settings['site_studio_sync'] = '/var/www/html/config/packages';": "config/packages",
        }
        for line, expected in cases.items():
            self.assertEqual(self.folder(line, expected)[0], expected, line)

    def test_the_setting_wins_over_any_folder_name(self):
        path, found = self.folder("$settings['site_studio_sync'] = '../config/packages';", "config/packages")
        self.assertEqual(path, "config/packages")
        self.assertIn("settings.php:2 (site_studio_sync)", found["from"])

    def test_no_guessing_from_folder_names(self):
        path, found = self.folder(None, "config/sitestudio")
        self.assertIsNone(path)
        self.assertIn("--sitestudio-config", found["problem"])

    def test_without_the_setting_site_studio_exports_with_drupal_config(self):
        path, _ = self.folder("$settings['config_sync_directory'] = '../config/sync';", "config/sync")
        self.assertEqual(path, "config/sync")

    def test_a_setting_that_needs_php_is_reported_not_guessed(self):
        path, found = self.folder("$settings['site_studio_sync'] = getenv('SS') . '/x';", "config/sitestudio")
        self.assertIsNone(path)
        self.assertIn("cannot be read without running PHP", found["problem"])

    def test_commented_out_and_environment_generated_settings_are_ignored(self):
        path, _ = self.folder("// $settings['site_studio_sync'] = '../config/old';\n"
                              "$settings['site_studio_sync'] = '../config/packages';", "config/packages")
        self.assertEqual(path, "config/packages")
        path, _ = self.folder("$settings['site_studio_sync'] = '../config/packages';", "config/packages",
                              settings_file="settings.ddev.php")
        self.assertIsNone(path)

    def test_the_export_is_counted_by_family(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp, "$settings['site_studio_sync'] = '../config/packages';", "config/packages")
            summary = source.summary(str(root))
            self.assertEqual((summary["components"], summary["customStyles"]), (1, 1))
            self.assertEqual(set(summary["families"]), {"cohesion_elements.cohesion_component",
                                                        "cohesion_custom_styles.cohesion_custom_style"})


class CustomComponentTests(unittest.TestCase):
    def install(self, root, location, name="tiny"):
        destination = root / location
        shutil.copytree(FIXTURE, destination)
        if name != "tiny":
            (destination / "tiny.custom_component.yml").rename(destination / f"{name}.custom_component.yml")
        return destination

    def test_a_site_with_only_custom_components_is_a_site_studio_site(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp)
            self.install(root, "docroot/themes/custom/example/custom_components/tiny")
            out = detect.detect(str(root))
            sources = {s["strategy"]: s for s in out["componentSources"]}
            self.assertEqual((sources["sitestudio"]["configComponents"], sources["sitestudio"]["customComponents"]), (0, 1))
            self.assertIn("--sitestudio-config", " ".join(out["notes"]))

    def test_found_at_any_depth_and_named_by_their_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp)
            self.install(root, "docroot/modules/custom/kit/custom_components/group/deep", name="banner")
            ids = [c["id"] for c in extract_sitestudio.extract(str(root))["components"]]
            self.assertEqual(ids, ["banner"])

    def test_a_component_without_a_form_is_kept_with_no_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp)
            definition = self.install(root, "docroot/themes/custom/example/custom_components/tiny")
            text = (definition / "tiny.custom_component.yml").read_text()
            (definition / "tiny.custom_component.yml").write_text(
                "\n".join(line for line in text.splitlines() if not line.startswith("form:")) + "\n")
            document = extract_sitestudio.extract(str(root))
            self.assertEqual([(c["id"], c["fields"]) for c in document["components"]], [("tiny", [])])
            self.assertEqual(document["problems"], [])

    def test_both_sources_together(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp, "$settings['site_studio_sync'] = '../config/packages';", "config/packages")
            (root / "config/packages" / COMPONENT).write_text(
                "id: cpt_hero\nlabel: Hero\njson_values: '{\"model\": {}}'\nstatus: true\n")
            self.install(root, "docroot/themes/custom/example/custom_components/tiny")
            ids = sorted(c["id"] for c in extract_sitestudio.extract(str(root))["components"])
            self.assertEqual(ids, ["cpt_hero", "tiny"])


class RecommendationTests(unittest.TestCase):
    def test_site_studio_outranks_a_few_authoring_bundles(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp, "$settings['site_studio_sync'] = '../config/packages';", "config/packages")
            for name in ("block_content.type.basic.yml", "paragraphs.paragraphs_type.text.yml"):
                (root / "config/default" / name).write_text("id: x\n")
            for name in ("cta", "card"):
                (root / "config/packages" / f"cohesion_elements.cohesion_component.cpt_{name}.yml").write_text("id: x\n")
            self.assertEqual(detect.detect(str(root))["recommended"]["component"], "sitestudio")


class DecisionTests(unittest.TestCase):
    def test_the_folder_is_a_decision_a_person_can_override(self):
        import argparse
        import contextlib
        import io
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp, "$settings['site_studio_sync'] = '../config/packages';", "config/packages")
            other = root / "config/other"
            other.mkdir()
            (other / COMPONENT).write_text("id: cpt_hero\n")
            workspace = Path(tmp) / "run"
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                workflow.init_command(argparse.Namespace(repo=str(root), workspace=str(workspace), force=False,
                                                         site_label=None, site_url=None, operator=None, model=None))
                workflow.detect_command(argparse.Namespace(project=str(workspace)))
                decisions = json.loads((workspace / "project.json").read_text())["decisions"]
                self.assertEqual(decisions["sitestudioConfig"], str((root / "config/packages").resolve()))
                workflow.select_command(argparse.Namespace(project=str(workspace), component=None, token=None,
                                                           usage=None, degraded_reason=None, by=None,
                                                           sitestudio_config=str(other)))
                with self.assertRaises(ValueError):
                    workflow.select_command(argparse.Namespace(project=str(workspace), component=None, token=None,
                                                               usage=None, degraded_reason=None, by=None,
                                                               sitestudio_config=str(root / "config/default")))
            project = json.loads((workspace / "project.json").read_text())
            self.assertEqual(project["decisions"]["sitestudioConfig"], str(other.resolve()))
            produced = project["artifacts"]["detection"]["producedBy"]
            self.assertEqual(produced["pluginDir"], str(Path(workflow.__file__).resolve().parents[1]),
                             "every artifact names the copy of design-lab that wrote it")


if __name__ == "__main__":
    unittest.main()
