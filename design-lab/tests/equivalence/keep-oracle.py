"""Time unchanged Python KEEP tests for the modules ported in this partial P2 slice."""
import json,re,sys,time,unittest
from pathlib import Path
root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'tests'))
report=Path(sys.argv[1]).read_text()
targets=r'(?<![\w])(?:spec_to_tree|responsive|nesting|render_payload|fetch_images|capture_all|scaffold_configs|twig_debug|cookie_preferences)\.ts'
selected=[]
for line in report.splitlines():
    cells=[c.strip() for c in line.split('|')]
    if len(cells) < 7 or cells[3] != 'KEEP' or not re.search(targets,cells[4]): continue
    # Dependency installer and extraction/sync commands remain outside this slice.
    if cells[1] in ('test_lab_setup.py','test_canvas.py','test_sitestudio_sync.py'): continue
    selected.append(cells[1].removesuffix('.py')+'.'+cells[2])
suite=unittest.defaultTestLoader.loadTestsFromNames(selected)
start=time.perf_counter()
result=unittest.TextTestRunner(verbosity=1).run(suite)
print(json.dumps({'names':selected,'tests':result.testsRun,'skipped':len(result.skipped),'failures':len(result.failures),'errors':len(result.errors),'wallMs':(time.perf_counter()-start)*1000},indent=2))
sys.exit(not result.wasSuccessful())
