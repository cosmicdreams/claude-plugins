import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PLUGIN = Path(__file__).resolve().parents[1]
SCRIPTS = PLUGIN / "scripts"
sys.path.insert(0, str(SCRIPTS))

from artifact_contracts import load_json, register_artifact, validate, write_json
from detect import detect
from extract_drupal_authoring import extract
from extract_drupal_rendering import extract as extract_rendering
from extract_drupal_usage import build_usage, merge_usage
from extract_sass_style_facts import extract_file as extract_style_file
from extract_tokens_sass import extract as extract_sass
from index_rows import row_for
from plan import plan_component
from plan_variables import build as plan_variables


def write(path: Path, body: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def drupal_fixture(root: Path) -> None:
    config = root / "config" / "default"
    for bundle in ("hero", "accordion"):
        write(config / f"block_content.type.{bundle}.yml",
              f"id: {bundle}\nlabel: {bundle.title()}\nstatus: true\n")
    for bundle in ("item", "card", "quote"):
        write(config / f"paragraphs.paragraphs_type.{bundle}.yml",
              f"id: {bundle}\nlabel: {bundle.title()}\nstatus: true\n")
    write(config / "field.storage.block_content.field_items.yml",
          "field_name: field_items\ntype: entity_reference_revisions\ncardinality: -1\n"
          "settings:\n  target_type: paragraph\n")
    write(config / "field.field.block_content.accordion.field_items.yml",
          "field_name: field_items\nfield_type: entity_reference_revisions\n"
          "label: Items\nrequired: true\nsettings:\n  handler_settings:\n"
          "    target_bundles:\n      item: item\n")
    for index in range(10):
        write(root / "docroot" / "themes" / "custom" / "test" / f"c{index}" /
              f"c{index}.component.yml", f"name: Component {index}\n")


class ArtifactContractTests(unittest.TestCase):
    def test_atomic_write_preserves_previous_file_on_serialisation_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.json"
            write_json(path, {"safe": True})
            with self.assertRaises(TypeError):
                write_json(path, {"unsafe": object()})
            self.assertEqual({"safe": True}, load_json(path))

    def test_duplicate_component_ids_fail_validation(self):
        document = {
            "standardVersion": "2.1.0", "generatedAt": "now", "source": {},
            "components": [
                {"id": "same", "label": "A", "sourceRef": "a", "fields": [],
                 "slots": [], "defects": []},
                {"id": "same", "label": "B", "sourceRef": "b", "fields": [],
                 "slots": [], "defects": []},
            ],
        }
        self.assertTrue(any("duplicate" in error for error in validate(document, "components")))

    def test_components_require_tool_version(self):
        document = {
            "standardVersion": "2.1.0", "generatedAt": "now", "source": {},
            "components": [],
        }
        self.assertIn("missing `toolVersion`", validate(document, "components"))

    def test_build_record_keeps_not_run_assertion_for_verify(self):
        document = {
            "standardVersion": "2.1.0", "toolVersion": "design-lab test",
            "id": "block:hero", "sourceHash": "sha256:test",
            "figma": {"fileKey": "test", "pageId": "1:2",
                      "documentationCardId": "1:3"},
            "assertions": {"fidelity": {"verdict": "not-run"}},
        }
        self.assertNotIn("assertion `fidelity` is not a passing assertion",
                         validate(document, "build-record"))

    def test_unknown_explicit_kind_fails_closed(self):
        self.assertEqual(["unsupported artifact kind: mystery"],
                         validate({"anything": True}, "mystery"))

    def test_capture_evidence_rejects_local_documentation_link(self):
        document = {
            "standardVersion": "3.0.0", "toolVersion": "design-lab test",
            "generatedAt": "now", "canonicalBaseUrl": "https://americascreditunions.org",
            "captures": {"block:hero": {
                "path": "/about", "verificationUrl": "https://acu-main.ddev.site/about",
                "linkUrl": "https://acu-main.ddev.site/about", "selector": ".hero",
                "states": ["default"], "images": [{"file": "hero.png"}],
            }}, "problems": [],
        }
        self.assertTrue(any("must not use a DDEV hostname" in error
                            for error in validate(document, "capture-evidence")))

    def test_build_record_requires_visual_comparison(self):
        document = {
            "standardVersion": "3.0.0", "toolVersion": "design-lab test",
            "id": "block:hero", "sourceHash": "sha256:test",
            "figma": {"fileKey": "test", "pageId": "1:2",
                      "documentationCardId": "1:3", "componentId": "1:4"},
            "assertions": {"structure": {"verdict": "pass"}},
        }
        self.assertIn("missing `visualEvidence`", validate(document, "build-record"))

    def test_build_record_rejects_screenshot_component_and_incomplete_breakpoints(self):
        document = {
            "standardVersion": "3.0.0", "toolVersion": "design-lab test",
            "id": "block:hero", "sourceHash": "sha256:test",
            "figma": {"fileKey": "test", "pageId": "1:2",
                      "documentationCardId": "1:3", "componentId": "1:4"},
            "documentation": {
                "anatomy": {"fields": ["field_heading"], "relationships": []},
                "breakpointScreenshots": {"desktop": "1:5"},
            },
            "nativeComponent": {
                "nodeType": "FRAME", "rootHasImageFill": True,
                "componentProperties": [], "nestedInstances": [], "validation": {},
            },
            "visualEvidence": {
                "path": "/example", "captureFiles": ["desktop.png"],
                "states": ["default"],
                "breakpoints": {
                    "desktop": {"captureFile": "desktop.png", "viewportWidth": 1280}},
                "comparison": {"verdict": "pass", "reviewedAt": "now",
                               "breakpoints": {"desktop": "pass"}},
            },
            "assertions": {"structure": {"verdict": "pass"}},
        }
        errors = validate(document, "build-record")
        self.assertTrue(any("desktop, tablet, and mobile" in error for error in errors))
        self.assertIn("nativeComponent.rootHasImageFill must be false", errors)
        self.assertIn("nativeComponent.nodeType must be COMPONENT or COMPONENT_SET", errors)


class VisualPlanningTests(unittest.TestCase):
    @staticmethod
    def component():
        return {"id": "block:hero", "label": "Hero", "fields": [], "slots": [],
                "defects": [], "usage": {"placements": 12, "structuralRefs": 0}}

    def test_rendering_without_capture_is_refused(self):
        plan = plan_component(self.component(), {"rootClasses": ["hero"]}, None)
        self.assertEqual("refuse", plan["verdict"])
        self.assertIn("screenshot", plan["refuseReason"])

    def test_verified_capture_authorises_visual_build(self):
        capture = {"path": "/about", "states": ["default"],
                   "images": [{"file": "hero.png"}]}
        plan = plan_component(self.component(), {"rootClasses": ["hero"]}, capture)
        self.assertEqual("build", plan["verdict"])
        self.assertEqual("component", plan["libraryRole"])

    def test_index_keeps_component_and_documentation_destinations_separate(self):
        component = self.component()
        record = {"figma": {"pageId": "1:1", "componentId": "1:2",
                            "documentationCardId": "1:3"}}
        row = row_for(component, record, 50, 10,
                      {"libraryRole": "component", "verdict": "build"})
        self.assertEqual("1:2", row["componentLinkTarget"])
        self.assertEqual("1:3", row["documentationLinkTarget"])
        self.assertNotEqual(row["componentLinkTarget"], row["documentationLinkTarget"])

    def test_registered_kind_is_persisted_for_later_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project_path = root / "project.json"
            artifact_path = root / "index.json"
            write_json(project_path, {
                "schemaVersion": 1, "standardVersion": "2.1.0", "pluginVersion": "test",
                "repository": {"root": str(root), "commit": None, "dirty": False},
                "decisions": {}, "phases": {}, "artifacts": {},
            })
            write_json(artifact_path, {
                "standardVersion": "2.1.0", "generatedAt": "now",
                "totals": {"components": 1},
                "rows": [{"id": "block:hero"}], "notBuilt": ["block:hero"],
                "problems": [],
            })
            project = register_artifact(project_path, "index", artifact_path, "index")
            self.assertTrue(project["artifacts"]["index"]["valid"])
            self.assertEqual("index", project["artifacts"]["index"]["kind"])


class DrupalAuthoringTests(unittest.TestCase):
    def test_authoring_source_outranks_more_numerous_sdcs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            drupal_fixture(root)
            result = detect(root)
            self.assertEqual("drupal-authoring", result["recommended"]["component"])
            authoring = next(source for source in result["componentSources"]
                             if source["strategy"] == "drupal-authoring")
            self.assertEqual(5, authoring["count"])

    def test_active_workspace_is_not_reported_as_prior_art(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            drupal_fixture(root)
            (root / ".design-lab/figma-batches").mkdir(parents=True)
            result = detect(root)
            self.assertFalse(any(item["path"].startswith(".design-lab")
                                 for item in result["priorArt"]))

    def test_combined_extractor_qualifies_ids_and_slots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            drupal_fixture(root)
            result = extract(root)
            self.assertEqual({"all": 5, "blocks": 2, "paragraphs": 3, "withDefects": 0},
                             result["totals"])
            by_id = {component["id"]: component for component in result["components"]}
            self.assertIn("block:accordion", by_id)
            self.assertIn("paragraph:item", by_id)
            self.assertEqual(["paragraph:item"],
                             by_id["block:accordion"]["slots"][0]["accepts"])
            self.assertEqual(["block:accordion.field_items"],
                             by_id["paragraph:item"]["containedBy"])
            self.assertEqual("design-lab 0.14.0", result["toolVersion"])

    def test_predefined_list_options_replace_exported_placeholder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            drupal_fixture(root)
            config = root / "config/default"
            write(config / "field.storage.block_content.field_color.yml", """
field_name: field_color
type: list_string
cardinality: 1
third_party_settings:
  list_predefined_options:
    plugin_id: colors
settings:
  allowed_values:
    -
      value: placeholder
      label: Placeholder
  allowed_values_function: list_predefined_options_allowed_values
""")
            write(config / "field.field.block_content.hero.field_color.yml", """
field_name: field_color
field_type: list_string
label: Color
required: true
""")
            write(root / "docroot/modules/custom/example/src/Plugin/ListOptions/Colors.php", """<?php
/** @ListOptions(id = "colors", label = @Translation("Colors")) */
class Colors {
  public function getListOptions($definition) {
    return [
      'purple' => $this->t('ACU Purple'),
      'red' => $this->t('ACU Red'),
    ];
  }
}
""")
            result = extract(root)
            hero = next(c for c in result["components"] if c["id"] == "block:hero")
            field = next(f for f in hero["fields"] if f["name"] == "field_color")
            self.assertEqual("list_predefined_options:colors", field["optionsSource"])
            self.assertEqual(["purple", "red"], [o["value"] for o in field["options"]])

    def test_common_contrib_contact_date_and_block_fields_have_model_kinds(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            drupal_fixture(root)
            config = root / "config/default"
            for name, source_type in (("field_email", "email"),
                                      ("field_phone", "telephone"),
                                      ("field_when", "smartdate"),
                                      ("field_block", "block_field")):
                write(config / f"field.storage.block_content.{name}.yml",
                      f"field_name: {name}\ntype: {source_type}\ncardinality: 1\n")
                write(config / f"field.field.block_content.hero.{name}.yml",
                      f"field_name: {name}\nfield_type: {source_type}\nlabel: {name}\n")
            hero = next(c for c in extract(root)["components"] if c["id"] == "block:hero")
            self.assertEqual({"field_email": "text", "field_phone": "text",
                              "field_when": "text", "field_block": "reference"},
                             {field["name"]: field["kind"] for field in hero["fields"]})
            self.assertFalse(any(d["kind"] == "unmapped-field-type" for d in hero["defects"]))

    def test_render_evidence_bounds_twig_sdc_and_style_search(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            drupal_fixture(root)
            twig = root / "docroot/themes/custom/test/templates/block/hero/block--hero.html.twig"
            write(twig, "{{ include('test:hero', {title: content.field_title}) }}")
            component = root / "docroot/themes/custom/test/components/hero/hero.component.yml"
            write(component, "name: Hero\n")
            write(component.with_name("hero.scss"), ".hero { color: $brand; }\n")
            document = extract(root)
            evidence = extract_rendering(root, document)
            hero = evidence["items"]["block:hero"]
            self.assertEqual(["test:hero"], hero["sdc"])
            self.assertEqual(["docroot/themes/custom/test/components/hero/hero.scss"],
                             hero["stylesheets"])
            self.assertEqual("high", hero["confidence"])

    def test_bundle_stylesheet_is_additive_to_child_sdc_stylesheet(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            drupal_fixture(root)
            twig = root / "docroot/themes/custom/test/templates/block/hero/block--hero.html.twig"
            write(twig, "{{ include('test:icon') }}")
            child = root / "docroot/themes/custom/test/components/icon/icon.component.yml"
            write(child, "name: Icon\n")
            write(child.with_name("icon.scss"), ".icon { color: red; }\n")
            bundle_style = root / "docroot/themes/custom/test/components/hero/hero.scss"
            write(bundle_style, ".hero { color: blue; }\n")
            evidence = extract_rendering(root, extract(root))
            self.assertEqual([
                "docroot/themes/custom/test/components/hero/hero.scss",
                "docroot/themes/custom/test/components/icon/icon.scss",
            ], evidence["items"]["block:hero"]["stylesheets"])


class DrupalUsageTests(unittest.TestCase):
    def test_usage_separates_direct_and_nested_instances(self):
        components = {
            "standardVersion": "2.1.0", "toolVersion": "design-lab 0.14.0",
            "generatedAt": "now", "source": {}, "totals": {},
            "components": [
                {"id": "block:hero", "label": "Hero", "sourceRef": "hero.yml",
                 "fields": [], "slots": [], "defects": []},
                {"id": "paragraph:item", "label": "Item", "sourceRef": "item.yml",
                 "fields": [], "slots": [], "defects": []},
                {"id": "paragraph:card", "label": "Card", "sourceRef": "card.yml",
                 "fields": [], "slots": [], "defects": []},
            ],
            "problems": [],
        }
        uuid = "11111111-1111-1111-1111-111111111111"
        rows = {
            "paragraphs": [
                ["1", "item", "paragraph", "2", "1"],
                ["2", "card", "node", "9", "1"],
            ],
            "layout_sections": [["9", "inline_block:hero"]],
            "blocks": [["5", uuid, "hero", "0", "1"]],
            "blocks_in_paragraphs": [[f"block_content:{uuid}", "2"]],
            "block_configuration": [],
            "nodes": [["9", "1", "page"]],
        }
        usage = build_usage(components, rows, {"ddevProject": "test"})
        self.assertEqual(1, usage["usage"]["paragraph:card"]["placements"])
        self.assertEqual(1, usage["usage"]["paragraph:item"]["structuralRefs"])
        self.assertEqual(1, usage["usage"]["block:hero"]["placements"])
        self.assertEqual(2, usage["usage"]["block:hero"]["structuralRefs"])
        merged = merge_usage(components, usage)
        tiers = {c["id"]: c["usage"]["tier"] for c in merged["components"]}
        self.assertEqual("Components — Low Use", tiers["paragraph:card"])
        self.assertEqual("Components — Structural Only", tiers["paragraph:item"])


class TokenStrategyTests(unittest.TestCase):
    def test_loaded_stylesheets_match_paths_not_only_basenames(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write(root / "docroot/themes/custom/test/test.libraries.yml",
                  "global:\n  css:\n    theme:\n      dist/index.css: {}\n")
            write(root / "docroot/themes/custom/test/source/card/index.css",
                  ":root { --fake-1: #111; --fake-2: #222; }\n")
            settings = root / "docroot/themes/custom/test/source/00-config/scss/settings"
            write(settings / "_colors.scss", "$brand: #123456;\n")
            result = detect(root)
            css = next(source for source in result["tokenSources"]
                       if source["strategy"] == "css-custom-properties")
            self.assertEqual(0, css["variablesLoadedByTheme"])
            self.assertEqual("sass-source", result["recommended"]["token"])

    def test_sass_source_preserves_typed_families(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = root / "docroot/themes/custom/test/source/00-config/scss/settings"
            write(settings / "_tokens.scss", """
$brand: #123456;
$surface-brand: $brand;
$font-size-body: 1rem;
$font-weight-bold: 700;
$radius-card: 8px;
$spacers: (
  1: 4px,
  2: 8px,
);
""")
            tokens = extract_sass(root)
            plan = plan_variables(tokens)
            self.assertEqual("sass-source", tokens["source"]["strategy"])
            core = plan["collections"]["Core"]["variables"]
            self.assertEqual(2, len([v for v in core if v["name"].startswith("Spacing/")]))
            self.assertEqual(1, len([v for v in core if v["name"].startswith("Shape/Radius/")]))
            self.assertTrue(any(v["name"] == "Color/Semantic/surface/brand" for v in core))
            self.assertEqual("grouped-single-collection",
                             plan["collectionStrategy"]["kind"])

    def test_sass_root_declarations_do_not_leak_into_part_selectors(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "card.scss"
            write(path, """
.card {
  display: grid;
  &__title {
    color: $purple;
  }
  gap: 24px;
}
.other {
  padding: 8px;
}
""")
            facts = extract_style_file(path)
            roots = {rule["selector"]: rule["declarations"]
                     for rule in facts["rootRules"]}
            self.assertEqual({"display", "gap"},
                             {item["property"] for item in roots[".card"]})
            self.assertIn(".other", roots)
            self.assertEqual("&__title", facts["partRules"][0]["selector"])


class WorkflowTests(unittest.TestCase):
    def run_workflow(self, *args, cwd):
        return subprocess.run([sys.executable, str(SCRIPTS / "workflow.py"), *args],
                              cwd=cwd, text=True, capture_output=True)

    def test_project_runs_discovery_inventory_and_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            workspace = Path(directory) / "artifacts"
            root.mkdir()
            drupal_fixture(root)
            init = self.run_workflow("init", "--repo", str(root), "--workspace",
                                     str(workspace), cwd=root)
            self.assertEqual(0, init.returncode, init.stderr)
            found = self.run_workflow("detect", "--project", str(workspace), cwd=root)
            self.assertEqual(0, found.returncode, found.stderr)
            extracted = self.run_workflow("extract", "--kind", "components", "--project",
                                          str(workspace), cwd=root)
            self.assertEqual(0, extracted.returncode, extracted.stderr)
            waived = self.run_workflow(
                "select", "--project", str(workspace), "--usage", "none",
                "--degraded-reason", "fixture has no running database", "--by", "test owner",
                cwd=root)
            self.assertEqual(0, waived.returncode, waived.stderr)
            planned = self.run_workflow("plan", "--project", str(workspace), cwd=root)
            self.assertEqual(0, planned.returncode, planned.stderr)
            project = load_json(workspace / "project.json")
            self.assertEqual("complete", project["phases"]["inventory"]["status"])
            self.assertEqual("awaiting-approval", project["phases"]["plan"]["status"])
            self.assertTrue(project["artifacts"]["components"]["valid"])
            self.assertEqual(5, len(load_json(workspace / "plan.json")["plans"]))

            rerun = self.run_workflow("extract", "--kind", "components", "--project",
                                      str(workspace), cwd=root)
            self.assertEqual(0, rerun.returncode, rerun.stderr)
            project = load_json(workspace / "project.json")
            self.assertEqual("pending", project["phases"]["plan"]["status"])
            self.assertNotIn("plan", project["artifacts"])

    def test_plan_blocks_when_detected_usage_was_not_measured(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            workspace = Path(directory) / "artifacts"
            root.mkdir()
            drupal_fixture(root)
            self.assertEqual(0, self.run_workflow(
                "init", "--repo", str(root), "--workspace", str(workspace), cwd=root).returncode)
            self.assertEqual(0, self.run_workflow(
                "detect", "--project", str(workspace), cwd=root).returncode)
            self.assertEqual(0, self.run_workflow(
                "extract", "--kind", "components", "--project", str(workspace),
                cwd=root).returncode)
            planned = self.run_workflow("plan", "--project", str(workspace), cwd=root)
            self.assertEqual(2, planned.returncode)
            self.assertIn("usage evidence was detected", planned.stderr)

    def test_model_cannot_self_authorise_a_waiver(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            workspace = Path(directory) / "artifacts"
            root.mkdir()
            self.assertEqual(0, self.run_workflow(
                "init", "--repo", str(root), "--workspace", str(workspace), cwd=root).returncode)
            waived = self.run_workflow(
                "record", "--project", str(workspace), "--phase", "capture",
                "--status", "waived", "--detail", '{"reason":"not attempted"}', cwd=root)
            self.assertEqual(2, waived.returncode)
            self.assertIn("human-decider", waived.stderr)

    def test_component_phase_completes_only_after_every_build_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = root / ".design-lab"
            workspace.mkdir()
            project_path = workspace / "project.json"
            write_json(project_path, {
                "schemaVersion": 1, "standardVersion": "2.1.0", "pluginVersion": "test",
                "repository": {"root": str(root), "commit": None, "dirty": False},
                "target": {"figmaFileKey": "test", "figmaUrl": "https://figma.com/design/test"},
                "decisions": {},
                "phases": {"components": {"status": "pending"}},
                "artifacts": {},
            })
            plan_path = workspace / "plan.json"
            write_json(plan_path, {
                "standardVersion": "2.1.0",
                "plans": [{"id": "block:hero", "verdict": "build", "libraryRole": "component"},
                          {"id": "paragraph:card", "verdict": "build", "libraryRole": "component"}],
            })
            register_artifact(project_path, "plan", plan_path, "plan")

            for index, component_id in enumerate(("block:hero", "paragraph:card")):
                record = workspace / f"build-{index}.json"
                write_json(record, {
                    "standardVersion": "2.1.0", "toolVersion": "design-lab test",
                    "id": component_id, "sourceHash": "sha256:test",
                    "assertions": {"structure": {"verdict": "pass"}},
                    "figma": {"fileKey": "test", "pageId": str(index),
                              "documentationCardId": f"doc-{index}",
                              "componentId": f"component-{index}"},
                    "documentation": {
                        "anatomy": {"fields": [], "relationships": [],
                                    "emptyReason": "fixture has no authored inputs"},
                        "breakpointScreenshots": {
                            "desktop": "shot-desktop", "tablet": "shot-tablet",
                            "mobile": "shot-mobile"},
                    },
                    "nativeComponent": {
                        "nodeType": "COMPONENT", "rootHasImageFill": False,
                        "componentProperties": [], "nestedInstances": [],
                        "validation": {
                            "nativeNode": True, "noScreenshotSurrogate": True,
                            "authoringCoverage": True, "relationshipCoverage": True},
                    },
                    "visualEvidence": {
                        "path": "/example",
                        "captureFiles": ["desktop.png", "tablet.png", "mobile.png"],
                        "states": ["default"],
                        "breakpoints": {
                            "desktop": {"captureFile": "desktop.png", "viewportWidth": 1280},
                            "tablet": {"captureFile": "tablet.png", "viewportWidth": 800},
                            "mobile": {"captureFile": "mobile.png", "viewportWidth": 390}},
                        "comparison": {
                            "verdict": "pass", "reviewedAt": "now",
                            "breakpoints": {
                                "desktop": "pass", "tablet": "pass", "mobile": "pass"}},
                    },
                })
                result = self.run_workflow(
                    "register", "--project", str(workspace), "--name", f"build-{index}",
                    "--path", str(record), "--kind", "build-record", "--phase", "components",
                    cwd=root)
                self.assertEqual(0, result.returncode, result.stderr)
                status = load_json(project_path)["phases"]["components"]["status"]
                self.assertEqual("running" if index == 0 else "complete", status)


class VerifyRegressionTests(unittest.TestCase):
    def load_verify(self):
        spec = importlib.util.spec_from_file_location("design_lab_verify", SCRIPTS / "verify.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_find_oriented_documentation_card_name_is_recognised(self):
        module = self.load_verify()
        report = module.Report()
        state = {"cards": [{
            "name": "Link · link_default (Paragraph)", "pageId": "2:6"
        }], "components": [{
            "name": "link_default — Link (Paragraph)", "pageId": "2:6"
        }]}
        components = {"components": [{
            "id": "paragraph:link_default", "label": "Link"
        }]}
        module.check_documentation_cards(state, components, report)
        module.check_documentation_adjacent(state, report)
        self.assertEqual([], report.findings)

    def test_generated_plans_key_enforces_completeness(self):
        module = self.load_verify()
        report = module.Report()
        module.check_components_built({"components": []}, None,
                                      {"plans": [{"id": "block:hero", "verdict": "build"}]},
                                      report)
        self.assertEqual("components-built", report.findings[0]["check"])
        self.assertIn("1 of 1", report.findings[0]["detail"])

    def test_receipt_contract_requires_source_anatomy_triad_and_nested_instances(self):
        module = self.load_verify()
        report = module.Report()
        with tempfile.TemporaryDirectory() as directory:
            build = Path(directory) / "accordion.json"
            write_json(build, {
                "id": "block:accordion",
                "documentation": {
                    "anatomy": {"fields": [], "relationships": []},
                    "breakpointScreenshots": {"desktop": "1:1"},
                },
                "nativeComponent": {
                    "nodeType": "COMPONENT_SET", "rootHasImageFill": False,
                    "componentProperties": [], "nestedInstances": [],
                    "validation": {"nativeNode": True, "noScreenshotSurrogate": True,
                                   "authoringCoverage": True,
                                   "relationshipCoverage": False},
                },
                "visualEvidence": {
                    "breakpoints": {"desktop": {"captureFile": "desktop.png"}},
                    "comparison": {"breakpoints": {"desktop": "pass"}},
                },
            })
            components = {"components": [{
                "id": "block:accordion",
                "fields": [{"name": "field_heading"}],
                "slots": [{"name": "field_items", "accepts": ["paragraph:item"]}],
            }]}
            module.check_component_receipt_contract(directory, components, report)
        checks = {finding["check"] for finding in report.findings}
        self.assertEqual({"documentation-anatomy", "breakpoint-triad",
                          "nested-component-coverage"}, checks)

    def test_sass_token_evidence_blocks_an_unbound_component_without_capture(self):
        module = self.load_verify()
        report = module.Report()
        state = {"components": [{"name": "hero — Hero", "boundVariableCount": 0}]}
        rendering = {"items": {"block:hero": {"styleFacts": {
            "rootRules": [{"declarations": [
                {"property": "color", "value": "$brand", "resolution": "sass-variable"}
            ]}], "partRules": []
        }}}}
        module.check_bindings_match_source(state, None, rendering, report)
        blockers = [finding for finding in report.findings
                    if finding["check"] == "bindings-match-source" and
                    finding["severity"] == "blocker"]
        self.assertEqual(1, len(blockers))
        self.assertIn("block:hero", blockers[0]["evidence"][0])

    def test_refused_inventory_does_not_require_full_documentation_card(self):
        module = self.load_verify()
        report = module.Report()
        state = {"cards": [{"name": "Hero · block:hero"}]}
        components = {"components": [
            {"id": "block:hero", "machineName": "hero", "label": "Hero"},
            {"id": "paragraph:field_group", "machineName": "field_group",
             "label": "Field group"},
        ]}
        plan = {"plans": [
            {"id": "block:hero", "verdict": "build"},
            {"id": "paragraph:field_group", "verdict": "refuse"},
        ]}
        module.check_documentation_cards(state, components, report, plan=plan)
        self.assertEqual([], report.findings)

    def test_completeness_requires_qualified_source_id_for_namespace_collision(self):
        module = self.load_verify()
        state = {"components": [{
            "name": "accordion — Accordion",
            "description": "Machine name: accordion\nSource id: block:accordion",
        }]}
        components = {"components": [
            {"id": "block:accordion", "machineName": "accordion",
             "usage": {"tier": "Components — High Use"}},
            {"id": "paragraph:accordion", "machineName": "accordion",
             "usage": {"tier": "Components — High Use"}},
        ]}
        result = module.completeness(state, components, None)
        self.assertEqual(1, result["built"])
        self.assertEqual(["paragraph:accordion"],
                         result["byTier"]["Components — High Use"][2])

    def test_render_evidence_does_not_cross_drupal_source_namespaces(self):
        module = self.load_verify()
        report = module.Report()
        state = {"components": [{
            "name": "accordion — Accordion",
            "description": "Machine name: accordion\nSource id: block:accordion",
            "boundVariableCount": 0,
        }]}
        rendering = {"items": {"paragraph:accordion": {"styleFacts": {
            "rootRules": [{"declarations": [
                {"property": "color", "value": "$brand", "resolution": "sass-variable"}
            ]}], "partRules": []
        }}}}
        module.check_bindings_match_source(state, None, rendering, report)
        blockers = [finding for finding in report.findings
                    if finding["check"] == "bindings-match-source" and
                    finding["severity"] == "blocker"]
        self.assertEqual([], blockers)

    def test_whole_file_verify_rejects_not_run_build_assertion(self):
        module = self.load_verify()
        with tempfile.TemporaryDirectory() as directory:
            record = Path(directory) / "hero.json"
            write_json(record, {"assertions": {"fidelity": {"verdict": "not-run"}}})
            report = module.Report()
            module.check_build_record_assertions(directory, report)
            self.assertEqual("build-record-assertions", report.findings[0]["check"])
            self.assertEqual("blocker", report.findings[0]["severity"])


if __name__ == "__main__":
    unittest.main()
