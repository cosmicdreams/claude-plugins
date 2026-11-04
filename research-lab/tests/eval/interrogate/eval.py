#!/usr/bin/env python3
"""Prepare and score repeatable interrogation evaluation jobs."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parents[2] / 'skills/interrogate/scripts/interrogate.py'
DIMS = ('evidence-strength', 'rival-explanations', 'reproducibility', 'internal-consistency', 'relevance')

def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], check=True, capture_output=True, text=True)

def runs(root):
    for fixture in sorted(root.iterdir()):
        if fixture.is_dir():
            for item in sorted(fixture.glob('run*')):
                if item.is_dir(): yield fixture.name, item

def main():
    p = argparse.ArgumentParser(); sp = p.add_subparsers(dest='cmd', required=True)
    q = sp.add_parser('plan'); q.add_argument('--runs', type=int, required=True); q.add_argument('--out', required=True)
    for name in ('rebuttals','score'): sp.add_parser(name).add_argument('dir')
    a = p.parse_args(); root = Path(a.out if a.cmd == 'plan' else a.dir).resolve()
    fixtures = json.loads((HERE / 'fixtures.json').read_text()); lookup = {f['id']: f for f in fixtures}
    if a.cmd == 'plan':
        root.mkdir(parents=True, exist_ok=True); jobs = []
        for f in fixtures:
            for n in range(1, a.runs+1):
                folder = root / f['id'] / f'run{n}'; (folder / 'results').mkdir(parents=True, exist_ok=True)
                sub = dict(f['submission']); sub['corpus'] = {'paths': [str((HERE / x).resolve()) for x in sub['corpus']['paths']]}
                (folder / 'submission.json').write_text(json.dumps(sub, indent=2)+'\n')
                run('briefs', folder/'submission.json', '--out', folder/'briefs')
                for d in DIMS: jobs.append({'fixture':f['id'],'run':n,'dimension':d,'brief':str(folder/'briefs'/f'brief-{d}.md'),'result':str(folder/'results'/f'{d}.r1.json')})
        (root/'jobs.jsonl').write_text(''.join(json.dumps(j)+'\n' for j in jobs)); return
    if a.cmd == 'rebuttals':
        jobs=[]
        for fid, folder in runs(root):
            output=run('rebuttal',folder/'submission.json','--results',folder/'results','--out',folder/'briefs').stdout.splitlines()
            for d in output: jobs.append({'fixture':fid,'run':int(folder.name[3:]),'dimension':d,'brief':str(folder/'briefs'/f'brief-{d}.r2.md'),'result':str(folder/'results'/f'{d}.r2.json')})
        (root/'jobs-r2.jsonl').write_text(''.join(json.dumps(j)+'\n' for j in jobs)); return
    cases={}; totals={'sound':[0,0], 'flawed':[0,0]}; errors=0; flips=0; eligible=0; relevance={}
    for fid, folder in runs(root):
        run('verdict',folder/'submission.json','--results',folder/'results','--out',folder/'verdict.json')
        v=json.loads((folder/'verdict.json').read_text()); cases.setdefault(fid,[]).append(v['verdict'])
        if v['verdict']=='incomplete': errors += 1; continue
        kind=lookup[fid]['kind']; correct=v['verdict']=='survived' if kind=='sound' else v['verdict'] in ('rejected','contested')
        totals[kind][0]+=int(correct); totals[kind][1]+=1
        if fid.startswith('relevance-'): relevance.setdefault(fid,[]).append({d:v['dimensions'][d]['score'] for d in DIMS})
    for values in cases.values():
        valid=[v for v in values if v!='incomplete']
        if valid:
            eligible+=1
            # Rejected versus contested on a flawed case counts as a flip.
            flips+=int(len(set(valid))>1)
    rates=[n/d if d else 0 for n,d in totals.values()]; accuracy=sum(rates)/2; flip=flips/eligible if eligible else 0
    summary={'cases':{fid:{'verdicts':vs,'correctness':[None if v=='incomplete' else (v=='survived' if lookup[fid]['kind']=='sound' else v in ('rejected','contested')) for v in vs]} for fid,vs in cases.items()},'execution_errors':errors,'balanced_accuracy':accuracy,'flip_rate':flip,'gate_pass':errors==0 and all(d for _,d in totals.values()) and accuracy>=.75 and flip<=1/3,'relevance_dimensions':relevance}
    (root/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
if __name__=='__main__': main()
