"""Phase-four Python oracle, isolated generated artifacts under /tmp."""
from pathlib import Path
import contextlib,io,json,sys,time
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
import verify,verify_state,verify_inputs,score_run,score_report,compare_runs,determinism,scoreboard_render,tier1
request=json.loads(Path(sys.argv[1]).read_text());run=Path(request['run']);out=Path(request['out']);assert str(run).startswith('/tmp/') and str(out).startswith('/tmp/');out.mkdir(exist_ok=True,parents=True)
timings={}
def timed(name,f):
 start=time.perf_counter();value=f();timings[name]=time.perf_counter()-start;return value
def save(name,value):
 (out/name).write_text(json.dumps(value,indent=2)+'\n')
if request['action']=='verify':
 folder=run/'figma/verify'
 if (folder/'root.json').is_file():state=timed('merge',lambda:verify_state.merge(folder))
 else:state=json.loads((folder/'state.json').read_text())
 save('state.json',state);measure=verify_inputs.build_measurements(run);save('measurements.json',measure)
 args=['verify.py','--state',str(out/'state.json'),'--measurements',str(out/'measurements.json'),'--out',str(run/'verify-report.json'),'--json']
 for flag,name in [('components','components.json'),('tokens','tokens.json'),('plan','plan.json'),('index','index.json'),('waivers','waivers.json'),('render-evidence','render-evidence.json'),('capture-evidence','capture-evidence.json'),('shots-dir','capture/shots'),('builds','builds')]:
  if (run/name).exists():args+=['--'+flag,str(run/name)]
 project=json.loads((run/'project.json').read_text());theme=(project.get('repository')or{}).get('root')
 if theme and Path(theme).is_dir():args+=['--theme-root',theme]
 if state.get('brand'):args+=['--brand',state['brand']]
 sys.argv=args
 with contextlib.redirect_stdout(io.StringIO()):exit_code=timed('verify',verify.main)
 save('verify-report.json',json.loads((run/'verify-report.json').read_text()));save('exit.json',{'code':exit_code})
elif request['action']=='scorecard':
 save('scorecard.json',timed('score',lambda:score_run.score(run,compare=[Path(p) for p in request.get('compare',[])])))
elif request['action']=='score':
 card=timed('score',lambda:score_run.score(run));save('scorecard.json',card)
 card['generatedAt']=request['generatedAt'];card['sections']['cost']['clock']['scorerSeconds']=0
 save('report-card.json',card)
 html=timed('report',lambda:score_report.render(card,run));(out/'report.html').write_text(html)
 (out/'completion.md').write_text(score_run.completion_message(card,Path(request['reportPath'])))
elif request['action']=='compare':save('comparison.json',compare_runs.compare(run,Path(request['other'])))
elif request['action']=='determinism':save('determinism.json',{'hash':determinism.hash_layout(run)})
elif request['action']=='scoreboard':(out/'report.html').write_text(scoreboard_render.render(request['rows']))
elif request['action']=='tier1':save('tier1.json',timed('tier1',lambda:tier1.replay(run,request['label'])))
save('timings.json',timings)
