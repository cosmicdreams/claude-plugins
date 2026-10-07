"""Oracle only: execute unchanged worktree Python against copied specs, never production input."""
import json,sys,time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import responsive, spec_to_tree, render_payload
manifest=json.loads(Path(sys.argv[1]).read_text())
start=time.perf_counter()
for item in manifest:
    spec=json.loads(Path(item['copy']).read_text())
    result={}
    for name,fn in [('flat',lambda:spec_to_tree.build(spec,item['label'])), ('responsive',lambda:responsive.build(spec,item['label'],item['key']))]:
        try:
            tree=fn()
            result[name]={'tree':tree}
            if name == 'responsive':
                args={'id':item['key'], 'pageId':'equivalence-fixture', 'variables':tree['variables'], **spec_to_tree.compact(tree['tree'])}
                result[name]['args']=args
                payload=render_payload.call_payload('build_responsive',args)
                Path(item['copy']+'.payload.oracle.js').write_text(payload)
        except Exception as error: result[name]={'error':str(error), 'class':type(error).__name__}
    Path(item['oracle']).write_text(json.dumps(result,ensure_ascii=False))
print(json.dumps({'count':len(manifest),'wallMs':(time.perf_counter()-start)*1000}))
