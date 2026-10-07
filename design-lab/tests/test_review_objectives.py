"""Regression cases for the four review objectives and collection consolidation."""
import contextlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import artifact_contracts as contracts
import figma_build
import figma_receipts
import index_rows
import library_counts
import plan
import plan_variables
import rebuild
import verify
import workflow
import test_render_pipeline as pipeline_fixture
import test_verify_blocks as receipt_fixture
from PIL import Image


class ReviewObjectives(unittest.TestCase):
    def test_corrected_comparison_reaches_receipt_and_gate(self):
        fixture = receipt_fixture.MeasuredReceiptTests()
        with tempfile.TemporaryDirectory() as tmp:
            root = fixture.workspace(tmp, native=fixture.native())
            image = root / 'specimen.png'
            Image.new('RGB', (300, 150), 'black').save(image)
            block_path = root / 'figma/results/block_hero.json'
            block = json.loads(block_path.read_text())
            block['geometry'] = {'variants': [], 'captures': []}
            for i, label in enumerate(('Mobile', 'Tablet', 'Desktop')):
                block['geometry']['variants'].append(dict(label=label, x=i*100, y=0, width=100, height=50))
                block['geometry']['captures'].append(dict(label=label, x=i*100, y=60, width=100, height=80))
            contracts.write_json(block_path, block)
            state = json.loads((root/'figma/state.json').read_text())
            state['steps'] = [{'id': 'compare:hero'}]
            contracts.write_json(root/'figma/state.json', state)
            contracts.write_json(root/'input.json', {'file': str(image)})
            with contextlib.redirect_stdout(io.StringIO()):
                figma_build.cmd_record(SimpleNamespace(project=str(root), step='compare:hero', result=str(root/'input.json')))
            record = fixture.record(root)
            comparison = record['visualEvidence']['comparison']
            self.assertEqual(comparison['metrics']['metric'], 'corrected')
            self.assertEqual(comparison['verdict'], 'fail')
            rep = verify.Report()
            verify.check_visual_evidence(str(root/'builds'), {'captures': {'hero': {}}}, rep)
            self.assertIn('master-matches-capture', [f['check'] for f in rep.findings])

    def test_unknown_and_partial_usage_are_not_retirement(self):
        component = dict(id='hero', label='Hero', sourceRef='hero.component.yml', fields=[], slots=[])
        capture = {'path': '/', 'images': [{'file': 'hero.png'}]}
        for usage in (None, {'status': 'unavailable'}, {'status': 'partial', 'placements': 0, 'structuralRefs': 0}):
            with self.subTest(usage=usage):
                result = plan.plan_component({**component, 'usage': usage}, capture=capture)
                self.assertEqual(result['verdict'], 'build')
                self.assertNotEqual(result['libraryRole'], 'retirement')
        zero = {**component, 'usage': {'placements': 0, 'structuralRefs': 0}}
        self.assertEqual(plan.plan_component(zero)['libraryRole'], 'retirement')
        self.assertEqual(plan.plan_component(zero, capture=capture)['verdict'], 'build')
        self.assertEqual(index_rows.tier_of({**component, 'usage': {'status': 'partial', 'placements': 0}}, 50, 10), 'Components — Untiered')
        document = {'components': [{**zero, 'usage': {**zero['usage'], 'examples': ['/hero']}}]}
        workflow.mark_untiered(document)
        usage = document['components'][0]['usage']
        self.assertIsNone(usage['placements'])
        self.assertEqual(usage['examples'], ['/hero'])
        self.assertEqual(index_rows.tier_of(document['components'][0], 50, 10), 'Components — Untiered')

    def test_subset_keeps_unrelated_component_and_rebuilds_parent(self):
        fixture = pipeline_fixture.FigmaBuildTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        for cid in ('card', 'other'):
            component = {'id': 'sdc.test.'+cid, 'label': cid, 'slots': [], 'fields': [], 'usage': {'tier': 'High Use'}}
            if cid == 'card':
                fixture.components[1] = component
            else:
                fixture.components.append(component)
            spec = json.loads((fixture.project/'capture/measurements/hero.spec.json').read_text())
            spec.update(component=cid, machineName=cid)
            fixture.write('capture/measurements/'+cid+'.spec.json', spec)
        fixture.components[0]['slots'] = [{'name': 'card', 'accepts': ['sdc.test.card']}]
        fixture.write('components.json', {'components': fixture.components})
        ids = ['sdc.test.hero', 'sdc.test.card', 'sdc.test.other']
        fixture.write('plan.json', {'plans': [{'id': cid, 'verdict': 'build'} for cid in ids]})
        state = fixture.init()
        state['done'] = [step['id'] for step in state['steps']]
        fixture.write('figma/state.json', state)
        fixture.result('build:sdc.test.hero', {'componentId': 'stable-hero'})
        fixture.result('build:sdc.test.card', {'componentId': 'stable-card'})
        fixture.result('build:sdc.test.other', {'componentId': 'untouched'})
        fixture.result('pages', {'pages': {'Components — High Use': 'page'}})
        completion = fixture.project/'benchmark/completion.md'
        completion.parent.mkdir()
        completion.write_text('Earlier finished run')
        after = fixture.init(only='sdc.test.card')
        self.assertFalse(completion.exists())
        self.assertEqual(next(completion.parent.glob('completion-before-subset-*.md')).read_text(), 'Earlier finished run')
        self.assertEqual(after['planned'], state['planned'])
        self.assertEqual(after['subset'], ['sdc.test.card', 'sdc.test.hero'])
        self.assertIn('build:sdc.test.other', after['done'])
        self.assertNotIn('build:sdc.test.hero', after['done'])
        self.assertEqual(library_counts.built_ids(fixture.project), {'sdc.test.other'})
        self.assertEqual(figma_build.build_args(fixture.project, 'sdc.test.card', after)['existingComponentId'], 'stable-card')
        with self.assertRaises(SystemExit):
            fixture.init(only='sdc.test.card', rebuild=True)
        fixture.result('build:sdc.test.card', {})
        saved = (fixture.project/'figma/state.json').read_bytes()
        with self.assertRaisesRegex(SystemExit, 'master identity'):
            fixture.init(only='sdc.test.card')
        self.assertEqual((fixture.project/'figma/state.json').read_bytes(), saved)

    def test_large_token_inventory_consolidates_and_preserves_aliases(self):
        out = {'collections': {
            'Primitives': {'modes': ['Value'], 'variables': [dict(name=f'color/{i}', type='COLOR', hex='#000') for i in range(201)]},
            'Semantic': {'modes': ['Value'], 'variables': [dict(name='surface', type='COLOR', aliasOf='color/0')]}}}
        plan_variables._consolidate_single_mode_collections(out)
        self.assertEqual(list(out['collections']), ['Core'])
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out['collections']['Type'] = {'modes': ['Value', '@media (max-width: 600px)'], 'variables': [
                dict(name='type/h1', type='FLOAT', valuesByMode={'Value': 40, '@media (max-width: 600px)': 24})]}
            contracts.write_json(root/'variable-plan.json', out)
            contracts.write_json(root/'project.json', {'run': {'siteLabel': 'Example'}})
            collections = figma_build.variables_args(root)['collections']
            self.assertEqual(list(collections), ['Example Core'])
            rows = collections['Example Core']['variables']
            self.assertEqual(len(rows), 203)
            alias = next(v for v in rows if v.get('aliasOf'))
            self.assertIn(alias['aliasOf'], {v['name'] for v in rows})
            self.assertEqual(next(v for v in rows if v['name']=='type/h1')['valuesByMode']['Mobile 375px'], 24)

    def test_independent_core_modes_survive_consolidation(self):
        dark = {'modes': ['Value', '@media (prefers-color-scheme: dark)'], 'variables': [
            dict(name='theme/surface', type='COLOR', valuesByMode={
                'Value': '#fff', '@media (prefers-color-scheme: dark)': '#000'})]}
        out = {'collections': {
            'Core': dark,
            'Spacing': {'modes': ['Value'], 'variables': [dict(name='space/1', type='FLOAT', value=4)]},
            'Radius': {'modes': ['Value'], 'variables': [dict(name='radius/1', type='FLOAT', value=2)]}}}
        plan_variables._consolidate_single_mode_collections(out)
        self.assertEqual(sum(len(c['variables']) for c in out['collections'].values()), 3)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out['collections']['Type'] = {'modes': ['Value', '@media (max-width: 600px)'], 'variables': [
                dict(name='type/h1', type='FLOAT', valuesByMode={'Value': 40, '@media (max-width: 600px)': 24})]}
            contracts.write_json(root/'variable-plan.json', out)
            contracts.write_json(root/'project.json', {'run': {'siteLabel': 'Example'}})
            collections = figma_build.variables_args(root)['collections']
            self.assertEqual(len(collections), 2)
            self.assertEqual(len(collections['Example Core']['variables']), 3)
            theme = next(c for c in collections.values() if any(v['name']=='theme/surface' for v in c['variables']))
            self.assertEqual(theme['modes'], ['Value', 'Dark'])
            self.assertEqual(theme['variables'][0]['valuesByMode'], {'Value': '#fff', 'Dark': '#000'})

    def test_finish_never_accepts_a_failed_gate_and_always_scores(self):
        for gate_exit in (0, 1):
            with self.subTest(gate_exit=gate_exit), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                contracts.write_json(root/'project.json', {'repository': {}, 'phases': {}, 'artifacts': {}})
                contracts.write_json(root/'figma/verify/state.json', {})
                calls = []
                def command(script, *args, **kwargs):
                    calls.append((script, args))
                    if script == 'verify.py':
                        contracts.write_json(root/'verify-report.json', dict(standardVersion='4.1.0', generatedAt='now', open=[], waived=[], passed=[], inapplicable=[], completeness={}))
                    return subprocess.CompletedProcess([], gate_exit if script=='workflow.py' else 0, '{}')
                with mock.patch.object(rebuild, 'command', side_effect=command), mock.patch.object(rebuild, 'build_measurements', return_value={}):
                    result = rebuild.evaluate(root)
                project = json.loads((root/'project.json').read_text())
                self.assertEqual(project['phases']['verify']['status'], 'failed' if gate_exit else 'complete')
                self.assertEqual(result['quality'], 'failed' if gate_exit else 'passed')
                self.assertTrue(project['artifacts']['verifyReport']['valid'])
                self.assertIn('sha256', project['artifacts']['verifyReport'])
                self.assertEqual(calls[-1][0], 'score_run.py')

    def test_native_rebuild_preserves_master_and_variant_node_ids(self):
        source = (Path(figma_build.__file__).parent/'render/build_responsive.js').read_text()
        body = source[source.index('/* ---- The master:'):]
        harness = r"""
const nodes = new Map(); let created = 0;
function node(id, type, name) {
 const n = {id, type, name, children: [], width: 100, height: 50, parent: null,
  appendChild(c) { if(c.parent) c.parent.children = c.parent.children.filter(x=>x!==c); this.children.push(c); c.parent=this; },
  remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);},
  resize(w,h){this.width=w;this.height=h;}, resizeWithoutConstraints(w,h){this.resize(w,h);},
  setSharedPluginData(){}};
 nodes.set(id,n); return n;
}
const page = node('page','PAGE','Page'); const block=node('block','FRAME','Block');page.appendChild(block);
const master=node('master','COMPONENT','Hero');block.appendChild(master);
const consumer={mainComponent:master};
const owner = SET ? node('set','COMPONENT_SET','Hero') : master;
if(SET){block.appendChild(owner);owner.appendChild(master);master.name='Theme=Default';}
const figma={getNodeByIdAsync:async id=>nodes.get(id),createComponent:()=>{created++;return node('new'+created,'COMPONENT','new');},
 combineAsVariants:()=>{throw Error('must preserve existing set');}};
const ARGS={existingComponentId:owner.id,name:'Hero',id:'hero',x:0,y:0,tree:{width:100,height:50,children:[]},variant:SET?{Theme:'Default'}:{}};
const col={id:'core'};const report={};const num=x=>x;const isVar=()=>false;
const style=()=>{};const layout=()=>{};const bind=()=>{};const build=async()=>{};
const run = new (Object.getPrototypeOf(async function(){}).constructor)('ARGS','figma','page','col','report','num','isVar','style','layout','bind','build',BODY);
const result=await run(ARGS,figma,page,col,report,num,isVar,style,layout,bind,build);
console.log(JSON.stringify({id:result.componentId,variant:result.variantId,consumer:consumer.mainComponent.id,removed:!!master.removed,created}));
"""
        for is_set in (False, True):
            script = 'const SET='+json.dumps(is_set)+'; const BODY='+json.dumps(body)+';\n'+harness
            result = subprocess.run(['node', '--input-type=module', '-e', script], capture_output=True, text=True, check=True)
            value = json.loads(result.stdout)
            self.assertEqual(value, dict(id='set' if is_set else 'master', variant='master', consumer='master', removed=False, created=0))

    def test_extraction_preserves_approved_untiered_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = dict(schemaVersion=1, standardVersion='4.1.0', pluginVersion='test',
                           repository=dict(root=str(root), commit=None, dirty=False),
                           decisions=dict(componentSource='sdc', usageSource='none'), artifacts={},
                           phases={'usage': {'status': 'waived', 'detail': {'by': 'operator', 'reason': 'database unavailable'}}})
            contracts.write_json(root/'project.json', project)
            inventory = dict(standardVersion='3.0.0', toolVersion='test', generatedAt='now', source={}, components=[
                dict(id='hero', label='Hero', sourceRef='hero.component.yml', fields=[], slots=[], defects=[])])
            with mock.patch.dict(workflow.COMPONENT_EXTRACTORS, {'sdc': lambda _: inventory}), contextlib.redirect_stdout(io.StringIO()):
                workflow.extract_command(SimpleNamespace(project=str(root), kind='components'))
            saved = json.loads((root/'project.json').read_text())
            self.assertEqual(saved['phases']['usage']['status'], 'waived')
            self.assertIsNone(json.loads((root/'components.json').read_text())['components'][0]['usage']['placements'])
