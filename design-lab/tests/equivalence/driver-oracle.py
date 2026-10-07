"""Python oracle, in-process dispatch on scratch copies only. No Figma connection."""
import contextlib, io, json, os, sys, time
from pathlib import Path
from types import SimpleNamespace
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import figma_build as b
import figma_receipts
os.environ['DESIGN_LAB_RUNNER'] = '1'

def invoke(fn, ns):
    output = io.StringIO()
    with contextlib.redirect_stdout(output): fn(ns)
    return json.loads(output.getvalue())

def fake_result(project, step):
    sid = step['step']; prefix = sid.split(':')[0]
    if step['kind'] == 'skip': return {}
    if step['kind'] == 'upload': return {'statuses': [200] * len(step['nodeIds'])}
    if step['kind'] == 'screenshot':
        geo = b.result(project, 'block:' + sid.split(':',1)[1])['geometry']
        # A deterministic synthetic specimen exercises all screenshot/compare dispatch.
        # PNCB has no saved Figma results or screenshots; do not call this a Figma replay.
        image = Image.new('RGB', (int(geo['specimen']['width']), int(geo['specimen']['height'])), 'white')
        image.save(step['out']); return {'file': step['out']}
    args = json.loads(Path(step['payload']).read_text().split('\n', 1)[0][len('const ARGS = '):-1])
    if sid == 'pages':
        pages={name: 'page:' + str(i) for i,name in enumerate(args['pages'])}
        cover=b.load(project,'figma/state.json',{}).get('preflightCover')
        if cover: pages['Cover']=cover
        return {'pages':pages,'foreign':[]}
    if sid == 'variables': return {'collections': {}, 'created': 0, 'updated': 0, 'aliasMisses': [], 'unplanned': []}
    if prefix == 'build':
        images=[]
        def visit(node):
            if node.get('kind') == 'image': images.append({'id': sid + ':image:' + str(len(images)), 'src': node['src'], 'fit': node.get('fit','FILL')})
            if node.get('backgroundImage'): images.append({'id': sid + ':image:' + str(len(images)), 'src': node['backgroundImage']['src'], 'fit': 'FIT' if node['backgroundImage'].get('fit') == 'contain' else 'FILL'})
            for child in node.get('children', []): visit(child)
        visit(args['tree'])
        for alt in args.get('alternates',[]): visit(alt['tree'])
        return {'componentId': sid + ':master', 'variantId': sid + ':variant', 'collectionId': 'collection', 'variables': len(args['variables']), 'bound': len(args['variables']), 'created': 1, 'literal': 0, 'width': 1400, 'height': 100, 'images': images, 'fonts': {}, 'missingFonts': [], 'standIns': {}, 'styleFallbacks': {}, 'iconText': {}, 'nested': [], 'nestedMismatch': [], 'svgFailures': [], 'fellBack': []}
    if prefix == 'block':
        variants=[]; captures=[]; x=0
        for column, capture in zip(args['columns'],args['evidence']):
            width=column['width'];height=capture['height']
            variants.append({'label':column['label'],'x':x,'y':0,'width':width,'height':height})
            captures.append({'label':capture['label'],'x':x,'y':height+10,'width':width,'height':height})
            x+=width+10
        height=max((c['y']+c['height'] for c in captures),default=1)
        return {'setId':args['setId'],'blockId':sid+':block','docId':sid+':doc','specimenId':sid+':specimen','evidenceIds':[sid+':ev:'+str(i) for i in range(len(captures))],'width':x,'height':height,'geometry':{'variants':variants,'captures':captures,'specimen':{'width':x,'height':height}},'native':{'nodeType':'COMPONENT','rootHasImageFill':False,'documentedFields':[f[0] for f in args['doc']['fields']],'nestedInstances':[]}}
    if sid=='wipe': return {'removedPages':[], 'removedCollections':[], 'kept':[]}
    if sid=='cover': return {'coverId':'cover','pageId':args['pageId'],'width':1400,'height':400,'font':'Inter','fontLoaded':True,'pluginData':True,'nameOnly':False}
    return {'rootId': sid + ':root'}

def run(project):
    started=time.perf_counter(); old=json.loads((project/'figma/state.json').read_text())
    init=invoke(b.cmd_init, SimpleNamespace(project=str(project),file_key=old['fileKey'],site_url=old['siteUrl'],canonical_base_url=old['canonicalBaseUrl'],offline_images=True,iterate=old.get('iterate',False),rebuild=json.loads((project/'replay-options.json').read_text()).get('rebuild',False),only=None))
    transcript=[]
    while True:
        step=invoke(b.cmd_next, SimpleNamespace(project=str(project)))
        if step['kind']=='done': break
        saved=project/'recorded-results'/(b.safe(step['step'])+'.json')
        if saved.is_file():
            data=json.loads(saved.read_text())
            if step['kind']=='screenshot': data={'file':data['file']}
        else: data=fake_result(project,step)
        recordfile=project/'inbox.json';recordfile.write_text(json.dumps(data))
        recorded=invoke(b.cmd_record, SimpleNamespace(project=str(project),step=step['step'],result=str(recordfile)))
        transcript.append({'step':step,'input':data,'recorded':recorded,'result':b.result(project,step['step'])})
    receipts=figma_receipts.generate(project)
    out={'init':init,'state':json.loads((project/'figma/state.json').read_text()),'transcript':transcript,'receipts':[(name,str(path),kind,phase) for name,path,kind,phase in receipts],'ms':(time.perf_counter()-started)*1000}
    (project/'oracle.json').write_text(json.dumps(out));print(json.dumps({'project':str(project),'steps':len(transcript),'ms':out['ms']}))
if __name__=='__main__':
    for arg in sys.argv[1:]:
        project=Path(arg).resolve()
        assert str(project).startswith('/private/tmp/') or str(project).startswith('/tmp/')
        run(project)
