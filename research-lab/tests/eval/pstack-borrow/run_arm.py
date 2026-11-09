#!/usr/bin/env python3
"""Run one headless Claude Code session against one arm's plugin copies.

run_arm.py --plugins DIR [DIR...] --disable NAME [NAME...] --task DIR --prompt TEXT --out DIR
           [--model sonnet] [--setup CMD] [--timeout 1200]
Copies the task folder to OUT/sandbox, runs `claude -p` there with only the arm's
plugin copies for the named plugins (the installed ones are disabled), and saves the
stream-JSON transcript and the final reply.
"""
import argparse, json, os, shutil, subprocess, time
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--plugins', nargs='+', required=True)
p.add_argument('--disable', nargs='+', default=[])
p.add_argument('--task', required=True)
p.add_argument('--prompt', required=True)
p.add_argument('--out', required=True)
p.add_argument('--model', default='sonnet')
p.add_argument('--setup')
p.add_argument('--timeout', type=int, default=1200)
a = p.parse_args()
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
box = out / 'sandbox'
if box.exists(): shutil.rmtree(box)
shutil.copytree(a.task, box)
if a.setup: subprocess.run([a.setup, str(box)], check=True)
settings = json.dumps({'enabledPlugins': {f'{n}@local': False for n in a.disable}})
cmd = ['claude', '-p', '--model', a.model, '--no-session-persistence', '--output-format', 'stream-json',
       '--verbose', '--dangerously-skip-permissions', '--settings', settings]
for d in a.plugins: cmd += ['--plugin-dir', d]
cmd += ['--', a.prompt]
env = {k: v for k, v in os.environ.items() if k != 'CLAUDECODE'}
t = time.time()
try:
    r = subprocess.run(cmd, cwd=box, env=env, capture_output=True, text=True, timeout=a.timeout)
    stdout, rc = r.stdout, r.returncode
except subprocess.TimeoutExpired as e:
    stdout, rc = (e.stdout or b'').decode() if isinstance(e.stdout, bytes) else (e.stdout or ''), 'timeout'
(out / 'transcript.jsonl').write_text(stdout)
final, skills = '', []
for line in stdout.splitlines():
    try: ev = json.loads(line)
    except json.JSONDecodeError: continue
    if ev.get('type') == 'result': final = ev.get('result', '')
    if ev.get('type') == 'assistant':
        for c in ev.get('message', {}).get('content', []):
            if c.get('type') == 'tool_use' and c.get('name') == 'Skill': skills.append(c['input'].get('skill'))
(out / 'final.md').write_text(final)
(out / 'meta.json').write_text(json.dumps({'rc': rc, 'seconds': round(time.time() - t), 'skills': skills}) + '\n')
print(out, rc, skills)
