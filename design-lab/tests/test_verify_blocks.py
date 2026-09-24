"""Deterministic component blocks and receipt conversion."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import verify
import figma_receipts
from artifact_contracts import validate


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))


class BlockChecks(unittest.TestCase):
    def setUp(self):
        self.card = {'name': 'Documentation · hero', 'component': 'hero',
                     'blockName': 'Hero · hero', 'pageId': 'p',
                     'sections': ['Head', 'Usage', 'Figma properties', 'Fields'],
                     'captureLabels': ['Mobile 375px', 'Tablet 800px', 'Desktop 1400px'],
                     'breakpointScreenshotCount': 3, 'defaultNamedLayers': 0}
        self.card['breakpointNodes'] = [
            {'id': 'm', 'name': 'hero · Mobile', 'type': 'INSTANCE', 'width': 375,
             'mainComponentId': 'master', 'explicitModes': {'bp': 'mobile'}},
            {'id': 't', 'name': 'hero · Tablet', 'type': 'INSTANCE', 'width': 800,
             'mainComponentId': 'master', 'explicitModes': {'bp': 'tablet'}},
            {'id': 'master', 'name': 'hero — Hero', 'type': 'COMPONENT', 'width': 1400}] 
        self.state = {'cards': [self.card], 'components': [{
            'id': 'master', 'name': 'hero — Hero', 'page': 'Components — High Use', 'pageId': 'p',
            'type': 'COMPONENT', 'breakpointBoundCount': 2}],
            'breakpointCollection': {'id': 'bp', 'modes': [
                {'name': 'Desktop 1400px', 'id': 'desktop'},
                {'name': 'Tablet 800px', 'id': 'tablet'},
                {'name': 'Mobile 375px', 'id': 'mobile'}]}}

    def checks(self):
        report = verify.Report()
        verify.check_documentation_cards(self.state, {'components': [
            {'id': 'hero', 'machineName': 'hero', 'label': 'Hero'}]}, report)
        verify.check_documentation_adjacent(self.state, report)
        verify.check_documentation_signal(self.state, report)
        verify.check_block_breakpoint_triad(self.state, report)
        verify.check_layers_named(self.state, report)
        return [item['check'] for item in report.findings]

    def test_complete_block_passes(self):
        self.assertEqual([], self.checks())

    def test_missing_section_and_capture_fail(self):
        self.card['sections'].remove('Fields')
        self.card['breakpointScreenshotCount'] = 2
        self.assertIn('documentation-signal', self.checks())
        self.assertIn('breakpoint-triad', self.checks())

    def test_wrong_page_and_default_layer_fail(self):
        self.card['pageId'] = 'other'
        self.card['defaultNamedLayers'] = 1
        self.assertIn('documentation-adjacent', self.checks())
        self.assertIn('layers-named', self.checks())

    def test_missing_instance_mode_fails(self):
        self.card['breakpointNodes'][0]['explicitModes'] = {}
        self.assertIn('breakpoint-triad', self.checks())

    def test_wrong_default_mode_fails(self):
        self.state['breakpointCollection']['modes'].reverse()
        self.assertIn('breakpoint-triad', self.checks())

    def test_unbound_responsive_variable_fails(self):
        self.state['components'][0]['responsiveVariableCount'] = 1
        self.state['components'][0]['breakpointBoundCount'] = 0
        report = verify.Report()
        verify.check_variants_are_sets(self.state, {'plans': [{'id': 'hero'}]}, report)
        self.assertEqual('variants-are-sets', report.findings[0]['check'])

    def test_component_set_without_real_axis_fails(self):
        self.state['components'][0]['type'] = 'COMPONENT_SET'
        report = verify.Report()
        verify.check_variants_are_sets(self.state, {'plans': [{'id': 'hero'}]}, report)
        self.assertEqual('variants-are-sets', report.findings[0]['check'])

    def test_real_variant_axis_allows_set(self):
        self.state['components'][0]['type'] = 'COMPONENT_SET'
        report = verify.Report()
        verify.check_variants_are_sets(self.state, {'plans': [
            {'id': 'hero', 'variantAxes': [{'field': 'appearance'}]}]}, report)
        self.assertEqual([], report.findings)

    def test_duplicates_and_examples_components_fail(self):
        self.state['components'].append({'name': 'hero — Copy', 'type': 'COMPONENT',
                                         'page': 'Examples'})
        self.state['exampleInvalidNodes'] = [{'name': 'Extra shape', 'type': 'RECTANGLE'}]
        report = verify.Report()
        verify.check_no_duplicate_components(self.state, report)
        verify.check_examples_instances_only(self.state, report)
        self.assertEqual({'no-duplicate-components', 'examples-instances-only'},
                         {item['check'] for item in report.findings})


class ReceiptTests(unittest.TestCase):
    def test_receipts_from_recorded_steps(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = Path(tmp)
            dump(w / 'project.json', {'schemaVersion': 1, 'standardVersion': '4.0.0',
                'pluginVersion': 'test', 'repository': {'root': str(w), 'commit': None, 'dirty': False},
                'decisions': {}, 'phases': {}, 'artifacts': {}})
            dump(w / 'components.json', {'components': [{
                'id': 'hero', 'label': 'Hero', 'sourceRef': 'hero.yml',
                'usage': {'tier': 'High Use', 'placements': 50, 'structuralRefs': 0},
                'fields': [], 'slots': []}]})
            (w / 'hero.yml').write_text('hero')
            dump(w / 'plan.json', {'plans': [{'id': 'hero', 'verdict': 'build'}]})
            dump(w / 'capture-evidence.json', {'captures': {'hero': {
                'path': '/hero', 'images': [
                    {'viewport': bp, 'file': f'{bp}.png', 'width': width, 'state': 'default'}
                    for bp, width in [('mobile', 375), ('tablet', 800), ('desktop', 1400)]]}}})
            dump(w / 'figma/state.json', {'standardVersion': '4.0.0', 'fileKey': 'key',
                                          'built': ['hero']})
            result = w / 'figma/results'
            dump(result / 'pages.json', {'pages': {'Components — High Use': 'p'}})
            dump(result / 'variables.json', {'collections': {'Core': {'id': 'c'}}})
            dump(result / 'build_hero.json', {'componentId': 'master', 'collectionId': 'bp',
                'created': 5, 'bound': 2, 'literal': 3, 'variables': 1,
                'images': [{'id': 'image'}], 'fonts': {}, 'svgFailures': [], 'fellBack': []})
            dump(result / 'images_hero.json', {'statuses': [200]})
            dump(result / 'block_hero.json', {'blockId': 'block', 'docId': 'doc',
                'setId': 'master', 'specimenId': 'specimen',
                'geometry': {'specimen': {'width': 2000, 'height': 500},
                             'variants': [{'label': bp} for bp in ('Mobile', 'Tablet', 'Desktop')],
                             'captures': [{'label': bp} for bp in ('Mobile', 'Tablet', 'Desktop')]},
                'native': {'nodeType': 'COMPONENT', 'rootHasImageFill': False,
                           'nestedInstances': [], 'documentedFields': []},
                'evidenceIds': ['m', 't', 'd']})
            dump(result / 'evidence_hero.json', {'statuses': [200, 200, 200]})
            dump(w / 'figma/trees/hero.json', {'variables': {
                'hero/width': {'values': {'Desktop': 1400, 'Tablet': 800, 'Mobile': 375}}}})
            outputs = figma_receipts.generate(w)
            self.assertEqual(3, len(outputs))
            for _, path, kind, _ in outputs:
                self.assertEqual([], validate(json.loads(path.read_text()), kind, str(path)))
            build = json.loads((w / 'builds/hero.json').read_text())
            self.assertEqual('not-run', build['assertions']['visual-comparison']['verdict'])
            self.assertEqual(2, build['built']['bindings'])
            self.assertEqual('COMPONENT', build['nativeComponent']['nodeType'])
            self.assertEqual({'mobile': 'm', 'tablet': 't', 'desktop': 'd'},
                             build['documentation']['breakpointScreenshots'])
            self.assertEqual('master', build['figma']['componentId'])
            report = verify.Report()
            verify.check_build_record_assertions(str(w / 'builds'), report)
            self.assertEqual('build-record-assertions', report.findings[0]['check'])
            dump(result / 'compare_hero.json', {'pass': True, 'pairs': [
                {'label': bp.capitalize(), 'pass': True} for bp in ('mobile', 'tablet', 'desktop')]})
            figma_receipts.generate(w)
            build = json.loads((w / 'builds/hero.json').read_text())
            self.assertEqual('pass', build['visualEvidence']['comparison']['verdict'])
            self.assertEqual('pass', build['assertions']['visual-comparison']['verdict'])
            dump(result / 'compare_hero.json', {'pass': False, 'pairs': [
                {'label': 'hero — Hero · Mobile · 375px', 'pass': True},
                {'label': 'hero — Hero · Tablet · 800px', 'pass': False},
                {'label': 'hero — Hero', 'pass': True}]})
            dump(result / 'images_hero.json', {'statuses': [500]})
            figma_receipts.generate(w)
            build = json.loads((w / 'builds/hero.json').read_text())
            self.assertEqual('fail', build['assertions']['image-upload']['verdict'])
            self.assertEqual('fail', build['visualEvidence']['comparison']['verdict'])
            self.assertEqual('fail', build['visualEvidence']['comparison']['breakpoints']['tablet'])
            dump(result / 'images_hero.json', {'statuses': [200]})
            dump(result / 'compare_hero.json', {'pass': True, 'pairs': [
                {'label': bp.capitalize(), 'pass': True}
                for bp in ('mobile', 'tablet', 'desktop')]})
            subprocess.run([sys.executable, str(SCRIPTS / 'figma_receipts.py'),
                            '--project', str(w)], check=True, capture_output=True, text=True)
            manifest = json.loads((w / 'project.json').read_text())
            self.assertEqual({'foundation', 'build:hero', 'index'}, set(manifest['artifacts']))
            self.assertTrue(all(item['valid'] for item in manifest['artifacts'].values()))


class MeasuredReceiptTests(unittest.TestCase):
    """Build-record flags come from what the block step measured, never from constants."""

    def workspace(self, tmp, *, slots=(), fields=(), native=None, viewports=('mobile', 'tablet', 'desktop'),
                  tier='High Use'):
        w = Path(tmp)
        dump(w / 'project.json', {'schemaVersion': 1, 'standardVersion': '4.0.0',
            'pluginVersion': 'test', 'repository': {'root': str(w), 'commit': None, 'dirty': False},
            'decisions': {}, 'phases': {}, 'artifacts': {}})
        dump(w / 'components.json', {'components': [{
            'id': 'hero', 'label': 'Hero', 'sourceRef': 'hero.yml',
            'usage': {'tier': tier, 'placements': 50, 'structuralRefs': 0} if tier else None,
            'fields': list(fields), 'slots': list(slots)}]})
        (w / 'hero.yml').write_text('hero')
        dump(w / 'plan.json', {'plans': [{'id': 'hero', 'verdict': 'build'}]})
        widths = {'mobile': 375, 'tablet': 800, 'desktop': 1400}
        dump(w / 'capture-evidence.json', {'captures': {'hero': {'path': '/hero', 'images': [
            {'viewport': bp, 'file': f'{bp}.png', 'width': widths[bp], 'state': 'default'}
            for bp in viewports]}}})
        dump(w / 'figma/state.json', {'standardVersion': '4.0.0', 'fileKey': 'key', 'built': ['hero']})
        result = w / 'figma/results'
        page = 'Components — ' + (tier or 'Untiered')
        dump(result / 'pages.json', {'pages': {page: 'p'}})
        dump(result / 'variables.json', {'collections': {'Core': {'id': 'c'}}})
        dump(result / 'build_hero.json', {'componentId': 'master', 'collectionId': 'bp',
            'created': 5, 'bound': 2, 'literal': 3, 'variables': 0, 'width': 1400, 'height': 400,
            'images': [], 'fonts': {}, 'svgFailures': [], 'fellBack': []})
        dump(result / 'images_hero.json', {})  # a skipped step is recorded with an empty result
        labels = [bp.capitalize() for bp in ('mobile', 'tablet', 'desktop') if bp in viewports]
        block = {'blockId': 'block', 'docId': 'doc', 'setId': 'master', 'specimenId': 'specimen',
                 'geometry': {'specimen': {'width': 2000, 'height': 500},
                              'variants': [{'label': bp} for bp in ('Mobile', 'Tablet', 'Desktop')],
                              'captures': [{'label': f'Capture · {bp}'} for bp in labels]},
                 'evidenceIds': [bp[0].lower() for bp in labels]}
        if native is not None:
            block['native'] = native
        dump(result / 'block_hero.json', block)
        dump(result / 'evidence_hero.json', {'statuses': [200] * len(labels)})
        dump(w / 'figma/trees/hero.json', {'variables': {}})
        return w

    def record(self, w):
        figma_receipts.generate(w)
        return json.loads((w / 'builds/hero.json').read_text())

    def native(self, **overrides):
        return {'nodeType': 'COMPONENT', 'rootHasImageFill': False, 'nestedInstances': [],
                'documentedFields': [], **overrides}

    def nesting_findings(self, w, slots):
        report = verify.Report()
        verify.check_component_receipt_contract(str(w / 'builds'), {'components': [{
            'id': 'hero', 'fields': [], 'slots': list(slots)}]}, report)
        return [f for f in report.findings if f['check'] == 'nested-component-coverage']

    def test_slot_without_a_nested_instance_fails_relationship_coverage(self):
        slots = [{'name': 'body', 'accepts': ['*']}]
        with tempfile.TemporaryDirectory() as tmp:
            w = self.workspace(tmp, slots=slots, native=self.native(documentedFields=['body']))
            build = self.record(w)
            validation = build['nativeComponent']['validation']
            self.assertIs(validation['relationshipCoverage'], False)
            self.assertIs(validation['authoringCoverage'], True)
            self.assertIs(validation['nativeNode'], True)
            self.assertEqual(1, len(self.nesting_findings(w, slots)))

    def test_nested_instance_satisfies_wildcard_and_named_slots(self):
        slots = [{'name': 'body', 'accepts': 'any'}, {'name': 'cta', 'accepts': ['button']}]
        nested = [{'instanceId': '1:2', 'mainComponentId': '1:1', 'sourceId': 'button'}]
        with tempfile.TemporaryDirectory() as tmp:
            w = self.workspace(tmp, slots=slots, native=self.native(
                nestedInstances=nested, documentedFields=['body', 'cta']))
            build = self.record(w)
            self.assertIs(build['nativeComponent']['validation']['relationshipCoverage'], True)
            self.assertEqual([{'sourceId': 'button', 'instanceNodeIds': ['1:2']}],
                             build['nativeComponent']['nestedInstances'])
            self.assertEqual([], self.nesting_findings(w, slots))

    def test_unmeasured_block_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            build = self.record(self.workspace(tmp, native=None))
            native = build['nativeComponent']
            self.assertIsNone(native['nodeType'])
            self.assertFalse(any(native['validation'].values()))
            self.assertIn('nativeComponent.nodeType must be COMPONENT or COMPONENT_SET',
                          validate(build, 'build-record'))

    def test_measured_image_fill_and_missing_field_rows_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = self.workspace(tmp, fields=[{'name': 'title', 'kind': 'text'}],
                               native=self.native(rootHasImageFill=True, documentedFields=[]))
            build = self.record(w)
            validation = build['nativeComponent']['validation']
            self.assertIs(validation['noScreenshotSurrogate'], False)
            self.assertIs(validation['authoringCoverage'], False)
            self.assertIn('nativeComponent.rootHasImageFill must be false',
                          validate(build, 'build-record'))

    def test_full_width_capture_crop_is_a_screenshot_surrogate(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = self.workspace(tmp, native=self.native())
            path = w / 'figma/results/build_hero.json'
            build = json.loads(path.read_text())
            build['images'] = [{'id': 'i', 'src': 'capture:desktop:0,0,1400,400'}]
            dump(path, build)
            self.assertIs(self.record(w)['nativeComponent']['validation']['noScreenshotSurrogate'], False)

    def test_legacy_string_accepts_become_a_valid_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = self.workspace(tmp, slots=[{'name': 'body', 'accepts': 'any'}],
                               native=self.native(documentedFields=['body']))
            build = self.record(w)
            self.assertEqual(['*'], build['documentation']['anatomy']['relationships'][0]['accepts'])
            self.assertEqual([], validate(build, 'build-record'))
            for bad in ('any', [], [None]):
                build['documentation']['anatomy']['relationships'][0]['accepts'] = bad
                self.assertTrue(any('.accepts must be' in e for e in validate(build, 'build-record')), bad)

    def test_partial_capture_is_a_failing_assertion_not_a_crash(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = self.workspace(tmp, viewports=('mobile', 'desktop'), native=self.native())
            build = self.record(w)
            self.assertEqual({'verdict': 'fail', 'missing': ['tablet']},
                             build['assertions']['breakpoint-evidence'])
            self.assertEqual({'mobile': 'm', 'desktop': 'd'},
                             build['documentation']['breakpointScreenshots'])
            self.assertNotIn('tablet', build['visualEvidence']['breakpoints'])
            done = subprocess.run([sys.executable, str(SCRIPTS / 'figma_receipts.py'), '--project', str(w)],
                                  capture_output=True, text=True)
            self.assertEqual(1, done.returncode, done.stderr)
            summary = json.loads(done.stdout)
            self.assertIn('build:hero', summary['invalid'])
            self.assertEqual(['foundation', 'index'], summary['registered'])

    def test_capture_evidence_without_the_component_does_not_crash(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = self.workspace(tmp, native=self.native())
            dump(w / 'capture-evidence.json', {'captures': {}})
            build = self.record(w)
            self.assertEqual(['mobile', 'tablet', 'desktop'],
                             build['assertions']['breakpoint-evidence']['missing'])

    def test_untiered_component_lands_on_the_untiered_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            build = self.record(self.workspace(tmp, tier=None, native=self.native()))
            self.assertEqual('Components — Untiered', build['figma']['pageName'])
            self.assertEqual('p', build['figma']['pageId'])
