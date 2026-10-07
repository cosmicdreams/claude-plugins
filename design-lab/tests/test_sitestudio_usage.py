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


def php(value):
    """PHP serialize(), as Drupal stores config."""
    if value is None:
        return 'N;'
    if isinstance(value, bool):
        return 'b:%d;' % value
    if isinstance(value, int):
        return 'i:%d;' % value
    if isinstance(value, str):
        return 's:%d:"%s";' % (len(value.encode('utf-8')), value)
    return 'a:%d:{%s}' % (len(value), ''.join(php(k) + php(v) for k, v in value.items()))


def template(kind, name, canvas, **settings):
    data = {'status': True, 'id': name, 'json_values': json.dumps({'canvas': canvas}), **settings}
    return ['cohesion_templates.cohesion_%s_templates.%s' % (kind, name), php(data)]


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

    def test_php_unserialize_reads_byte_lengths_and_nesting(self):
        text = 'Café "quoted"; {braces}'
        value = {'a': {0: 1, 1: None}, 'b': True, 's': text}
        self.assertEqual(value, usage.php_unserialize(php(value).encode('utf-8')))
        self.assertEqual(1.5, usage.php_unserialize(b'd:1.5;'))
        with self.assertRaisesRegex(ValueError, 'unsupported'):
            usage.php_unserialize(b'O:8:"stdClass":0:{}')

    def test_master_template_components_are_structural_and_site_wide(self):
        rows = {'nodes': [['10', '1', 'page'], ['11', '1', 'event'], ['12', '0', 'event']],
            'path_aliases': [['/node/11', '/events/expo']],
            'sitestudio_templates': [
                template('master', 'master_template', [component('site_header', [
                    component('promo')]), {'type': 'container'}, component('site_footer')],
                    default=True),
                template('master', 'boxed', [component('text_banner')], default=False),
                template('master', 'retired', [component('cpt_callouts')],
                         default=False, status=False),
                template('content', 'node_event_full', [], entity_type='node',
                         bundle='event', view_mode='full', default=True,
                         master_template='boxed'),
                template('content', 'node_page_full', [], entity_type='node',
                         bundle='page', view_mode='full', default=True,
                         master_template='master_template')]}
        inventory = self.inventory()
        inventory['components'] += [{'id': 'site_header'}, {'id': 'site_footer'}]
        document = usage.build_usage(inventory, rows, {})
        values = document['usage']
        header = values['site_header']
        self.assertEqual((0, 1, 0), (header['placements'], header['structuralRefs'], header['pages']))
        # Even when a content template names the default master, the home page is the example.
        self.assertEqual(['/'], header['exampleCandidates'])
        self.assertEqual(['cohesion_templates.cohesion_master_templates.master_template'],
                         header['templates'])
        self.assertEqual(['/'], values['site_footer']['exampleCandidates'])
        self.assertEqual(['/'], values['promo']['exampleCandidates'])
        # A non-default master renders only on the published nodes whose content template picks it.
        self.assertEqual(['/events/expo'], values['text_banner']['exampleCandidates'])
        self.assertEqual(1, values['text_banner']['pages'])
        # A disabled master template renders nowhere.
        self.assertEqual(0, values['cpt_callouts']['structuralRefs'])
        self.assertNotIn('templates', values['cpt_callouts'])
        self.assertEqual(5, document['source']['population']['siteStudioTemplates'])
        absent = [p for p in document['problems'] if p['check'] == 'inventoried-bundle-absent-from-database']
        self.assertNotIn('site_header', absent[0]['evidence'] if absent else [])
        merged = usage.merge_usage(inventory, document)
        tiers = {c['id']: c['category'] for c in merged['components']}
        self.assertEqual(usage.TIERS['structural'], tiers['site_header'])
        self.assertEqual(usage.TIERS['structural'], tiers['site_footer'])

    def test_content_menu_and_view_templates(self):
        view = {'display': {
            'default': {'display_plugin': 'default', 'display_options': {
                'style': {'type': 'cohesion_layout', 'options': {'views_template': 'view_tpl_search'}}}},
            'page_1': {'display_plugin': 'page', 'display_options': {'path': 'search'}},
            'page_2': {'display_plugin': 'page', 'display_options': {'path': 'node/%/related'}},
            'page_3': {'display_plugin': 'page', 'display_options': {'path': 'off', 'enabled': False}},
            'block_1': {'display_plugin': 'block', 'display_options': {}}}}
        rows = {'nodes': [['20', '1', 'event'], ['21', '1', 'event'], ['22', '1', 'page']],
            'sitestudio_templates': [
                template('content', 'node_event_full', [component('hero_highlight')],
                         entity_type='node', bundle='event', view_mode='full', default=True,
                         master_template=''),
                template('content', 'node_event_teaser', [component('promo')],
                         entity_type='node', bundle='event', view_mode='teaser', default=True),
                template('menu', 'menu_tpl_main', [component('text_banner')]),
                template('view', 'view_tpl_search', [component('cpt_callouts')]),
                ['views.view.search', php(view)],
                ['views.view.retired', php({'status': False, 'display': {'page_1': {
                    'display_plugin': 'page', 'display_options': {'path': 'retired', 'style': {
                        'options': {'views_template': 'view_tpl_search'}}}}}})]]}
        rows['sitestudio_layouts'] = [layout(1, 'node', 22, [component('hero_highlight')])]
        values = usage.build_usage(self.inventory(), rows, {})['usage']
        # The page an author placed it on stays first; template pages follow.
        self.assertEqual(['/node/22', '/node/21', '/node/20'],
                         values['hero_highlight']['exampleCandidates'])
        self.assertEqual(3, values['hero_highlight']['pages'])
        # A teaser renders inside listings, so it names no page of its own.
        self.assertEqual(1, values['promo']['structuralRefs'])
        self.assertEqual([], values['promo']['exampleCandidates'])
        self.assertEqual(['/'], values['text_banner']['exampleCandidates'])
        self.assertEqual(['/search'], values['cpt_callouts']['exampleCandidates'])
        self.assertEqual(1, values['cpt_callouts']['structuralRefs'])

    def test_unreadable_template_is_reported_not_fatal(self):
        rows = {'sitestudio_templates': [
            ['cohesion_templates.cohesion_master_templates.broken', 'a:9:{s:2:"id"'],
            template('master', 'master_template', [component('promo')], default=True)]}
        document = usage.build_usage(self.inventory(), rows, {})
        self.assertEqual(['/'], document['usage']['promo']['exampleCandidates'])
        self.assertIn('sitestudio-template-unreadable',
                      [problem['check'] for problem in document['problems']])

    def test_global_full_template_renders_bundles_without_their_own(self):
        rows = {'nodes': [['30', '1', 'event'], ['31', '1', 'page']],
            'sitestudio_templates': [
                template('content', 'node_event_full', [component('hero_highlight')],
                         entity_type='node', bundle='event', view_mode='full', default=True,
                         master_template=''),
                template('content', 'node_any_full', [component('promo')],
                         entity_type='node', bundle='__any__', view_mode='full', default=True,
                         master_template='master_landing'),
                template('master', 'master_landing', [component('text_banner')])]}
        values = usage.build_usage(self.inventory(), rows, {})['usage']
        # The global template renders only the bundle with no template of its own.
        self.assertEqual(['/node/31'], values['promo']['exampleCandidates'])
        # ...and the master it selects renders there too.
        self.assertEqual(['/node/31'], values['text_banner']['exampleCandidates'])
        self.assertEqual(['/node/30'], values['hero_highlight']['exampleCandidates'])

    def test_unmodified_default_template_renders_nothing(self):
        rows = {'nodes': [['40', '1', 'event']],
            'sitestudio_templates': [
                template('content', 'node_event_full', [component('promo')],
                         entity_type='node', bundle='event', view_mode='full', default=True,
                         modified=False, master_template='')]}
        values = usage.build_usage(self.inventory(), rows, {})['usage']
        self.assertEqual([], values['promo']['exampleCandidates'])

    def test_damaged_rows_are_rejected_not_misread(self):
        for broken in (b'a:1:{a:0:{}i:1;}', b's:50:"x";', b's:-1:"";', b'a:1:{i:0;i:1;'):
            with self.assertRaises((ValueError, IndexError, TypeError)):
                usage.php_unserialize(broken)
        rows = {'sitestudio_templates': [
            ['cohesion_templates.cohesion_master_templates.bad', 'a:1:{a:0:{}i:1;}'],
            ['cohesion_templates.cohesion_master_templates.deep', 'a:1:{i:0;' * 3000 + 'N;' + '}' * 3000],
            template('master', 'master_template', [component('promo')], default=True)]}
        document = usage.build_usage(self.inventory(), rows, {})
        self.assertEqual(['/'], document['usage']['promo']['exampleCandidates'])
        self.assertEqual(2, [p['check'] for p in document['problems']].count('sitestudio-template-unreadable'))

    def test_site_studio_extract_keeps_master_template_candidate(self):
        rows = {'nodes': [['1', '1', 'page']], 'sitestudio_templates': [
            template('master', 'master_template', [component('promo')], default=True)]}
        with mock.patch.object(usage, 'collect_rows', return_value=rows):
            document = usage.extract(tempfile.gettempdir(), self.inventory())
        self.assertEqual(['/'], document['usage']['promo']['exampleCandidates'])
        self.assertEqual([], document['usage']['promo']['examples'])

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
