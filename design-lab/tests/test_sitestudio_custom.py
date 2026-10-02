"""Offline inventory and downstream contracts for theme/module custom components."""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from artifact_contracts import validate
import extract_sitestudio as extractor
import extract_drupal_usage as usage
import find_rendered_components as rendered
import plan
import scaffold_configs

FIXTURE = Path(__file__).parent / 'fixtures/sitestudio_custom'


class CustomComponentTests(unittest.TestCase):
    def install(self, root, location):
        destination = root / location / 'custom_components/tiny'
        shutil.copytree(FIXTURE, destination)
        return destination

    def test_inventory_fields_and_consumers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            definition = self.install(root, 'docroot/themes/custom/example')
            document = extractor.extract(str(root))
            self.assertEqual([], validate(document, 'components'))
            self.assertEqual([], document['problems'])
            self.assertEqual(1, len(document['components']))
            component = document['components'][0]
            self.assertEqual('tiny', component['id'])
            self.assertEqual('Tiny Custom', component['label'])
            self.assertEqual('custom_category', component['group'])
            self.assertEqual(str((definition / 'tiny.custom_component.yml').relative_to(root)), component['sourceRef'])
            self.assertEqual('.tiny', scaffold_configs.custom_selector(str(root), component['sourceRef'])[0])
            fields = {field['name']: field for field in component['fields']}
            self.assertEqual(['text', 'richtext', 'boolean', 'media', 'reference', 'enum', 'array', 'text'],
                             [field['kind'] for field in component['fields']])
            self.assertEqual('<p>Rich</p>', fields['description']['default'])
            self.assertIs(False, fields['enabled']['default'])
            self.assertTrue(fields['title']['required'])
            self.assertEqual('left', fields['style']['default'])
            self.assertEqual(2, len(fields['style']['options']))
            self.assertIsNone(fields['image']['options'])
            self.assertEqual('items', fields['item-title']['repeatableIn'])
            self.assertEqual((1, 5), (fields['items']['minItems'], fields['items']['maxItems']))
            rows = {'nodes': [['1', '1', 'page']], 'sitestudio_layouts': [
                ['1', 'node', '1', json.dumps({'canvas': [{'type': 'component',
                    'componentId': 'tiny', 'isCustomComponent': True}]})]]}
            counts = usage.build_usage(document, rows, {})
            enriched = usage.merge_usage(document, counts)['components'][0]
            self.assertEqual(1, enriched['usage']['placements'])
            self.assertEqual('component', plan.classify(enriched)[0])
            evidence = rendered.summarize_pages([('/', 200, '<div data-component-id="tiny"></div>')], document)
            self.assertEqual(1, evidence['tiny']['renderedInstances'])

    def test_modules_and_web_root_skip_contrib_core(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.install(root, 'web/modules/custom/example')
            self.install(root, 'web/modules/contrib/ignored')
            self.install(root, 'web/themes/contrib/ignored')
            self.install(root, 'web/core/modules/ignored')
            self.assertEqual(['tiny'], [c['id'] for c in extractor.extract(str(root))['components']])

    def test_bad_form_is_reported_without_losing_other_components(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            definition = self.install(root, 'docroot/themes/custom/example')
            (definition / 'form.json').write_text('{bad')
            self.install(root, 'docroot/modules/custom/example')
            result = extractor.extract(str(root))
            self.assertEqual(1, len(result['components']))
            self.assertEqual('unparseable-custom-component', result['problems'][0]['kind'])
