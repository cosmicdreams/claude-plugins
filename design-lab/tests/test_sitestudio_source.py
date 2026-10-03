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
        """Copy the fixture to `location`, below `<extension>/custom_components/`, and make the
        extension a real one (an info file), as Site Studio only searches extensions."""
        destination = root / location
        parts = Path(location).parts
        extension = root.joinpath(*parts[:parts.index("custom_components")])
        extension.mkdir(parents=True, exist_ok=True)
        (extension / f"{extension.name}.info.yml").write_text(f"name: {extension.name}\ntype: theme\n")
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
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                workflow.detect_command(argparse.Namespace(project=str(workspace)))
            project = json.loads((workspace / "project.json").read_text())
            self.assertEqual(project["decisions"]["sitestudioConfig"], str(other.resolve()),
                             "detecting again keeps the folder a person named")
            produced = project["artifacts"]["detection"]["producedBy"]
            self.assertEqual(produced["pluginDir"], str(Path(workflow.__file__).resolve().parents[1]),
                             "every artifact names the copy of design-lab that wrote it")


if __name__ == "__main__":
    unittest.main()


class ReviewRegressionTests(unittest.TestCase):
    """One test per finding of the expert review of 2026-10-03."""

    def folder(self, settings, export="config/packages", extra_site=None):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp, settings, export)
            if extra_site:
                (root / "docroot/sites/other").mkdir(parents=True)
                (root / "docroot/sites/other/settings.php").write_text("<?php\n" + extra_site + "\n")
            found = source.config_dir(str(root))
            return (found["path"] and str(Path(found["path"]).relative_to(root))), found

    def test_strings_keep_what_looks_like_comments_quotes_and_semicolons(self):
        cases = {
            "$settings['site_studio_sync'] = '../config/a/*x*/b';": "config/a/*x*/b",
            "$settings['site_studio_sync'] = '../config/a #b';": "config/a #b",
            "$settings['site_studio_sync'] = '../config/a //b';": "config/a /b",  # the same folder
            "$settings['site_studio_sync'] = '../config/o\"ne';": 'config/o"ne',
            "$settings['site_studio_sync'] = \"../config/it's\";": "config/it's",
            "$settings['site_studio_sync'] = '../config/it\\'s';": "config/it's",
            "$settings['site_studio_sync'] = '../config/a;b';": "config/a;b",
        }
        for line, expected in cases.items():
            self.assertEqual(self.folder(line, expected)[0], expected, line)

    def test_an_unreadable_assignment_is_never_hidden_by_a_readable_one(self):
        path, found = self.folder("$settings['site_studio_sync'] = '../config/packages';\n"
                                  "$settings['site_studio_sync'] = getenv('SS');")
        self.assertIsNone(path)
        self.assertIn("cannot be read without running PHP", found["problem"])

    def test_a_declared_folder_that_is_missing_does_not_fall_back_to_drupal_config(self):
        path, found = self.folder("$settings['site_studio_sync'] = '../config/gone';\n"
                                  "$settings['config_sync_directory'] = '../config/packages';")
        self.assertIsNone(path)
        self.assertIn("does not exist", found["problem"])

    def test_sites_that_disagree_need_a_person_to_choose(self):
        path, found = self.folder("$settings['site_studio_sync'] = '../config/packages';",
                                  extra_site="$settings['site_studio_sync'] = '../config/other';")
        self.assertIsNone(path)
        self.assertIn("2 different values", found["problem"])

    def test_naming_the_folder_makes_an_undetected_site_studio_selectable(self):
        import argparse
        import contextlib
        import io
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp, "$settings['site_studio_sync'] = getenv('SS');", "config/packages")
            workspace = Path(tmp) / "run"
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                workflow.init_command(argparse.Namespace(repo=str(root), workspace=str(workspace), force=False,
                                                         site_label=None, site_url=None, operator=None, model=None))
                workflow.detect_command(argparse.Namespace(project=str(workspace)))
                detection = json.loads((workspace / "detection.json").read_text())
                self.assertNotIn("sitestudio", [s["strategy"] for s in detection["componentSources"]])
                workflow.select_command(argparse.Namespace(
                    project=str(workspace), component="sitestudio", token="sitestudio-styles", usage=None,
                    degraded_reason=None, by=None, sitestudio_config=str(root / "config/packages")))
            decisions = json.loads((workspace / "project.json").read_text())["decisions"]
            self.assertEqual((decisions["componentSource"], decisions["tokenSource"]), ("sitestudio", "sitestudio-styles"))

    def test_a_run_that_recorded_no_export_never_reads_the_settings_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp, "$settings['site_studio_sync'] = '../config/packages';", "config/packages")
            (root / "config/packages" / COMPONENT).write_text(
                "id: cpt_hero\nlabel: Hero\njson_values: '{\"model\": {}}'\nstatus: true\n")
            self.assertEqual(extract_sitestudio.extract(str(root), None)["components"], [])
            self.assertEqual(len(extract_sitestudio.extract(str(root))["components"]), 1)

    def extension(self, root, path, name=None):
        folder = root / path
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{name or folder.name}.info.yml").write_text("name: x\ntype: module\n")
        return folder

    def component(self, folder, name, category=True):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{name}.custom_component.yml").write_text(
            f"name: '{name}'\n" + ("category: c\n" if category else ""))

    def test_symlinked_extensions_and_folders_are_followed(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as elsewhere:
            root = site(tmp)
            outside = self.extension(Path(elsewhere), "linked")
            self.component(outside / "custom_components", "from_linked_extension")
            (root / "docroot/modules/custom").mkdir(parents=True)
            (root / "docroot/modules/custom/linked").symlink_to(outside)
            local = self.extension(root, "docroot/themes/custom/local")
            shared = Path(elsewhere) / "shared"
            self.component(shared, "from_linked_folder")
            (local / "custom_components").mkdir()
            (local / "custom_components/shared").symlink_to(shared)
            ids = [source.custom_component_id(p) for p in source.custom_component_files(str(root))]
            self.assertEqual(sorted(ids), ["from_linked_extension", "from_linked_folder"])

    def test_discovery_follows_site_studios_own_rules(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp)
            first = self.extension(root, "docroot/modules/custom/first")
            second = self.extension(root, "docroot/themes/custom/second")
            self.component(first / "custom_components", "banner")
            self.component(second / "custom_components", "banner")              # the same name again
            self.component(first / "custom_components/fixtures", "test_only")   # a blocked folder
            self.component(first / "custom_components", "9bad")                 # not a machine name
            self.component(first / "custom_components", "no_category", category=False)
            self.component(first / "nested/custom_components", "not_at_the_top")
            found, problems, _ = source.custom_components(str(root))
            self.assertEqual([source.custom_component_id(p) for p in found], ["banner"])
            self.assertIn("first/custom_components", found[0])
            self.assertEqual(sorted(p["kind"] for p in problems),
                             ["duplicate-custom-component", "invalid-custom-component"])

    def test_inactive_extensions_are_left_out_when_drupal_config_says_so(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = site(tmp, "$settings['config_sync_directory'] = '../config/default';")
            (root / "config/default/core.extension.yml").write_text("module:\n  active: 0\ntheme:\n  olivero: 0\n")
            self.component(self.extension(root, "docroot/modules/custom/active") / "custom_components", "kept")
            self.component(self.extension(root, "docroot/modules/custom/disabled") / "custom_components", "dropped")
            found, _, known = source.custom_components(str(root))
            self.assertTrue(known)
            self.assertEqual([source.custom_component_id(p) for p in found], ["kept"])
            self.assertNotIn("sitestudio", [s["strategy"] for s in detect.detect(str(root))["componentSources"]
                                            if s.get("customComponents") == 0 and not s.get("configComponents")])

    def test_a_failed_git_status_records_no_claim_of_cleanliness(self):
        import subprocess
        from unittest import mock
        import artifact_contracts

        def fake(command, **_):
            failed = command[3] == "status"
            return subprocess.CompletedProcess(command, 1 if failed else 0, stdout="" if failed else "abc\n")

        saved = artifact_contracts._PRODUCER
        artifact_contracts._PRODUCER = None
        try:
            with mock.patch.object(subprocess, "run", side_effect=fake):
                self.assertIsNone(artifact_contracts.producer()["dirty"])
        finally:
            artifact_contracts._PRODUCER = saved
