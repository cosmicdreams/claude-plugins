"""Verify checks that misjudged a correct file, and the variable naming that fed them."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import plan_variables
import spec_to_tree
import verify
import verify_state


def checks(report):
    return [finding["check"] for finding in report.findings]


class VariableChecksTest(unittest.TestCase):
    def test_boolean_variables_are_exempt_from_scoping(self):
        report = verify.Report()
        verify.check_variable_scopes({"collections": [{"name": "Core Breakpoint", "variables": [
            {"name": "x/visible", "type": "BOOLEAN", "scopes": ["ALL_SCOPES"]},
            {"name": "x/width", "type": "FLOAT", "scopes": ["ALL_SCOPES"]}]}]}, report)
        self.assertEqual([f["scope"] for f in report.findings], ["Core Breakpoint::x/width"])

    def test_measured_breakpoint_description_explains_the_blank_code_name(self):
        description = ("Measured from the live site at each breakpoint; no CSS custom property "
                       "declares this value, so there is no code name.")
        report = verify.Report()
        verify.check_code_syntax_set({"collections": [{"name": "Core Breakpoint", "variables": [
            {"name": "x/width", "web": None, "description": description}]}]}, None, report)
        self.assertNotIn("code-syntax-set", checks(report))

    def test_sass_map_entries_take_map_get_names_that_resolve(self):
        self.assertEqual(plan_variables.code_name({"codePath": "$spacers[1]"}),
                         "map-get($spacers, 1)")
        self.assertEqual(plan_variables.code_name({"codeName": "$black", "codePath": "x"}), "$black")
        self.assertIsNone(plan_variables.code_name({"codePath": None}))
        state = {"collections": [{"name": "Core", "variables": [
            {"name": "Spacing/spacers-1", "web": "map-get($spacers, 1)"},
            {"name": "Spacing/missing", "web": "map-get($nowhere, 1)"}]}]}
        report = verify.Report()
        verify.check_code_syntax_resolves(state, "$spacers: (1: 4px);", report)
        self.assertEqual(len(report.findings), 1)
        self.assertIn("$nowhere", json.dumps(report.findings[0]))


class LayerNameTest(unittest.TestCase):
    def test_names_never_repeat_figma_defaults(self):
        name = lambda tag, *classes: spec_to_tree.node_name({"tag": tag, "classes": list(classes)}, None)
        self.assertEqual(name("div", "c-card__text"), "Card text")
        self.assertEqual(name("div", "c-card__title"), "Title")
        self.assertEqual(name("div", "c-frame"), "Frame element")
        self.assertEqual(name("p"), "Paragraph")
        self.assertEqual(name("span"), "Inline text")


class FileChecksTest(unittest.TestCase):
    def test_captures_unique_reads_component_id_stems(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ("paragraph__card__tablet.png", "paragraph__cards__tablet.png",
                         "block__cards__desktop.png", "block__cards__mobile.png"):
                (Path(folder) / name).write_bytes(b"same" if "tablet" in name else name.encode())
            report = verify.Report()
            verify.check_captures_unique(folder, report)
            self.assertEqual([f["scope"] for f in report.findings],
                             ["capture:paragraph__card,paragraph__cards"])

    def test_verify_state_carries_the_collection_strategy_reason(self):
        with tempfile.TemporaryDirectory() as folder:
            project = Path(folder)
            dumps = project / "figma" / "verify"
            dumps.mkdir(parents=True)
            (dumps / "root.json").write_text(json.dumps({"pages": [], "collections": [
                {"name": "Core"}, {"name": "Core Breakpoint"}]}))
            (project / "variable-plan.json").write_text(json.dumps(
                {"collectionStrategy": {"reason": "single-mode domains use slash-name groups"}}))
            state = verify_state.merge(dumps)
            self.assertIn("mode boundary", state["collectionStrategyReason"])
            report = verify.Report()
            verify.check_collection_strategy(state, "Core", report)
            self.assertEqual(report.findings, [])


if __name__ == "__main__":
    unittest.main()
