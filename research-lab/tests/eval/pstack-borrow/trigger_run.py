#!/usr/bin/env python3
"""Which skill (if any) does a headless session invoke first for each query?

trigger_run.py --evals FILE --skill NAME --out FILE [--model sonnet] [--seconds 120] [-P 4]
Runs each query in an empty scratch folder with the installed plugins, stops at the first
Skill call (or the end of the reply), and scores should_trigger against the named skill.
Edit, Write and NotebookEdit are disallowed so a query cannot change anything.
"""
import argparse, json, os, subprocess, tempfile, time
from concurrent.futures import ThreadPoolExecutor

p = argparse.ArgumentParser()
p.add_argument('--evals', required=True); p.add_argument('--skill', required=True)
p.add_argument('--out', required=True); p.add_argument('--model', default='sonnet')
p.add_argument('--seconds', type=int, default=120); p.add_argument('-P', type=int, default=4)
a = p.parse_args()
env = {k: v for k, v in os.environ.items() if k != 'CLAUDECODE'}

def one(item):
    with tempfile.TemporaryDirectory() as box:
        cmd = ['claude', '-p', '--model', a.model, '--no-session-persistence', '--output-format', 'stream-json',
               '--verbose', '--disallowedTools=Edit,Write,NotebookEdit,Bash', '--', item['query']]
        proc = subprocess.Popen(cmd, cwd=box, env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        first, start = None, time.time()
        for line in proc.stdout:
            try: ev = json.loads(line)
            except json.JSONDecodeError: continue
            if ev.get('type') == 'assistant':
                for c in ev.get('message', {}).get('content', []):
                    if c.get('type') == 'tool_use' and c.get('name') == 'Skill':
                        first = c['input'].get('skill'); break
            if first or ev.get('type') == 'result' or time.time() - start > a.seconds: break
        proc.kill()
    hit = bool(first) and first.split(':')[-1] == a.skill.split(':')[-1] and (':' not in a.skill or first == a.skill)
    return {**item, 'first_skill': first, 'triggered': hit, 'correct': hit == item['should_trigger']}

items = json.load(open(a.evals))
with ThreadPoolExecutor(a.P) as ex: rows = list(ex.map(one, items))
json.dump(rows, open(a.out, 'w'), indent=1)
print(f"{sum(r['correct'] for r in rows)}/{len(rows)} correct")
for r in rows:
    if not r['correct']: print('WRONG', r['should_trigger'], r['first_skill'], '|', r['query'][:80])
