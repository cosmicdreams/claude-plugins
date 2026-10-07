"""Read-only oracle for portable fixtures; generated artifacts belong under /tmp."""
import json, os, sys, math
from pathlib import Path
root = Path(os.environ.get('DESIGN_LAB_ORACLE_ROOT', str(Path(__file__).resolve().parents[2])))
sys.path.insert(0,str(root/'scripts'))
import extract_canvas_usage as canvas
import extract_drupal_usage as drupal
import yaml
import find_examples
request=json.loads(Path(sys.argv[1]).read_text())
def normalize(value):
    if isinstance(value, float) and not math.isfinite(value): return None
    if isinstance(value, list): return [normalize(v) for v in value]
    if isinstance(value, dict): return {k:normalize(v) for k,v in value.items()}
    return value
if request['action']=='yaml':
    expected=json.loads(json.dumps(normalize(yaml.safe_load(request['yaml']))))
    actual=json.loads(request['actual'])
    if expected!=actual:
        raise AssertionError((expected,actual))
    print('match')
elif request['action']=='canvas':
    f=request['fixture'];doc=canvas.build_usage(f['components'],f['rows'],f['source']);doc['generatedAt']='oracle-clock'
    print(json.dumps({'usage':doc,'merged':canvas.merge_canvas_usage(f['components'],doc)}))
elif request['action']=='http':
    print(json.dumps([{'path':path,'result':find_examples.fetch(request['base']+path)} for path in request['paths']]))
