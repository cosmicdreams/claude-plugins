"""Offline Site Studio layout fixtures."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import extract_drupal_usage as usage


def component(name, children=None):
    return {'type': 'component', 'componentId': name, 'children': children or []}


def layout(number, host, parent, canvas):
    return [str(number), host, str(parent), json.dumps({'canvas': canvas,
        'model': {'ignored': component('model_only')}})]


class SiteStudioUsageTests(unittest.TestCase):
    def inventory(self):
        return {'source': {'strategy': 'sitestudio'}, 'components': [
            {'id': name, 'sourceRef': 'cohesion_elements.cohesion_component.' + name + '.yml'}
            for name in ('hero_highlight', 'text_banner', 'cpt_callouts', 'promo', 'unused')]}

    def test_direct_nested_reusable_and_published_pages(self):
        reference = {'type': 'component-content', 'componentContentId': 'cc_uuid-7'}
        rows = {'nodes': [['14631', '1', 'page'], ['2', '0', 'page'], ['3', '1', 'page']],
            'path_aliases': [['/node/14631', '/home']],
            'component_contents': [['7', 'uuid-7']],
            'sitestudio_layouts': [
                layout(1, 'node', 14631, [component('hero_highlight', [
                    {'type': 'container', 'children': [component('cpt_callouts')]}]),
                    {'type': 'container', 'children': [component('text_banner')]}, reference]),
                layout(2, 'node', 2, [component('text_banner')]),
                layout(3, 'component_content', 7, [component('promo'), reference]),
                layout(4, 'node', 3, [reference, reference])]}
        document = usage.build_usage(self.inventory(), rows, {})
        values = document['usage']
        self.assertEqual(1, values['hero_highlight']['placements'])
        self.assertEqual(0, values['cpt_callouts']['placements'])
        self.assertEqual(1, values['cpt_callouts']['structuralRefs'])
        self.assertEqual(['/home'], values['cpt_callouts']['exampleCandidates'])
        self.assertEqual(2, values['text_banner']['placements'])
        self.assertEqual(1, values['text_banner']['pages'])
        self.assertEqual(1, values['promo']['structuralRefs'])
        self.assertEqual(2, values['promo']['pages'])
        self.assertEqual(['/home', '/node/3'], values['promo']['exampleCandidates'])
        self.assertNotIn('model_only', str(document['problems']))
        merged = usage.merge_usage(self.inventory(), document)
        self.assertEqual(usage.TIERS['structural'], merged['components'][2]['category'])
        self.assertEqual(usage.TIERS['retirement'], merged['components'][4]['category'])

    def test_no_published_nodes_has_no_pages(self):
        rows = {'nodes': [['2', '0', 'page']], 'sitestudio_layouts': [
            layout(1, 'node', 2, [component('hero_highlight')])]}
        value = usage.build_usage(self.inventory(), rows, {})['usage']['hero_highlight']
        self.assertEqual(1, value['placements'])
        self.assertEqual(0, value['pages'])
        self.assertEqual([], value['exampleCandidates'])

    def test_invalid_json_identifies_layout(self):
        with self.assertRaisesRegex(ValueError, 'Site Studio layout 99'):
            usage.build_usage(self.inventory(), {'sitestudio_layouts': [
                ['99', 'node', '1', 'broken']]}, {})

    def test_mixed_inventory_keeps_paragraphs(self):
        inventory = self.inventory()
        inventory['components'].append({'id': 'paragraph:card'})
        document = usage.build_usage(inventory, {'paragraphs': [
            ['1', 'card', 'node', '1', '1']], 'sitestudio_layouts': [
                layout(2, 'node', 1, [component('hero_highlight')])]}, {})
        self.assertEqual(1, document['usage']['paragraph:card']['placements'])
        self.assertEqual(1, document['usage']['hero_highlight']['placements'])

    def test_site_studio_preserves_candidates_without_paragraph_markers(self):
        rows = {'nodes': [['14631', '1', 'page']], 'sitestudio_layouts': [
            layout(1, 'node', 14631, [component('hero_highlight')])]}
        with mock.patch.object(usage, 'collect_rows', return_value=rows), \
                mock.patch.object(usage, 'enrich_examples') as enrich:
            document = usage.extract(tempfile.gettempdir(), self.inventory())
        enrich.assert_not_called()
        value = document['usage']['hero_highlight']
        self.assertEqual(['/node/14631'], value['exampleCandidates'])
        self.assertEqual([], value['examples'])

    def test_absent_feature_tables_are_skipped(self):
        describe = subprocess.CompletedProcess([], 0, json.dumps({'raw': {
            'status': 'running', 'name': 'site'}}), '')
        queries = []
        def mysql(_root, _project, sql):
            queries.append(sql)
            return [['cohesion_layout_field_data'], ['node_field_data']] if sql == 'SHOW TABLES;' else []
        with mock.patch.object(usage.subprocess, 'run', return_value=describe), \
                mock.patch.object(usage, '_mysql', side_effect=mysql):
            rows = usage.collect_rows(tempfile.gettempdir())
        self.assertEqual([], rows['paragraphs'])
        self.assertTrue(any('FROM cohesion_layout_field_data' in sql for sql in queries))
        self.assertFalse(any('FROM paragraphs_item_field_data' in sql for sql in queries))
        self.assertFalse(any('FROM block_content ' in sql for sql in queries))

if __name__ == '__main__':
    unittest.main()
