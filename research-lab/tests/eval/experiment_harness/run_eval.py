#!/usr/bin/env python3
"""E2 layer 1: replay realistic broken harnesses through two versions of experiment_loop.

Usage: run_eval.py --scripts <dir with experiment.py> [--out results.json]

Each scenario seeds a git repository with a small workload (app.py writes one
output line per input record, 2 ms each) and a timing harness (bench.py), then
runs init, baseline and one trial. The methodology declares Sensitivity, Errors
and Work in every scenario, the way a methodology written to the current spec
would. A version that ignores those fields shows what happens without them.
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

APP = '''import os, sys, time
src = os.environ.get('DATA', 'data.txt')
delay = 0.002 * (3 if os.environ.get('APP_SLOW') else 1)
n = 0
with open('out.txt', 'w') as o:
    if os.path.exists(src):
        for line in open(src):
            time.sleep(delay)
            o.write(line.upper())
            n += 1
'''

# Times the workload. Like most quick harnesses, it ignores the app's exit code.
BENCH = '''import subprocess, sys, time
t = time.perf_counter()
with open('app.err', 'w') as err:
    subprocess.run([sys.executable, 'app.py'], stderr=err)
print(round((time.perf_counter() - t) * 1000, 1))
'''

# Blind harness: times reading the last output instead of running the app.
BLIND_BENCH = '''import time
t = time.perf_counter()
open('out.txt', 'a').close(); open('out.txt').read()
print(round((time.perf_counter() - t) * 1000 + 100, 1))
'''

METHOD = '''# Methodology: harness eval

## 1. Objective
**Metric:** run time ms
**Direction:** lower is better
**Target:** 1

## 2. Baseline
Measure: python3 bench.py
Checks: python3 -m py_compile app.py
Runs: 3
Margin: 10
Sensitivity: APP_SLOW=1 python3 bench.py
Errors: cat app.err 2>/dev/null | grep -c Traceback || true
Work: cat out.txt 2>/dev/null | wc -l

## 3. Hypotheses
1. make the per-record work cheaper

## 4. Iteration Rules
- Budget: 5

## 5. Measurement Protocol
python3 bench.py, median of 3

## 6. Correctness Checks
- app.py compiles

## 7. Scope Constraints
- app.py only

## 8. Working Directory
{w}
'''

FAST = APP.replace('0.002 *', '0.0002 *')
CRASH = APP.replace("n = 0\n", "n = 0\nraise ValueError('config missing')\n")
NO_WORK = APP.replace("'data.txt'", "'data.csv'")

# id, harness, trial edit, what a correct loop does
SCENARIOS = [
    ('blind-harness', BLIND_BENCH, FAST, 'refuse baseline: the harness never runs the app'),
    ('blind-harness-sensitivity-only', BLIND_BENCH, FAST,
     'refuse baseline on Sensitivity alone (Errors and Work removed)'),
    ('fast-failure', BENCH, CRASH, 'refuse the trial: the app now crashes, which looks faster'),
    ('no-work', BENCH, NO_WORK, 'refuse the trial: the app now reads nothing, which looks faster'),
    ('healthy', BENCH, FAST, 'freeze baseline and keep the real 10x improvement'),
]


def git(cwd, *args):
    subprocess.run(['git', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-C', str(cwd), *args], check=True, capture_output=True, text=True)


def loop(script, e, *args):
    r = subprocess.run([sys.executable, str(script), *args, '--engagement', str(e)],
                       capture_output=True, text=True, timeout=300)
    try:
        out = json.loads(r.stdout)
    except json.JSONDecodeError:
        out = {'raw': (r.stdout + r.stderr)[-400:]}
    return r.returncode, out


def scenario(script, sid, bench, edit, root):
    repo, w = root / 'repo', root / 'trial'
    repo.mkdir()
    git(repo, 'init', '-b', 'main')
    git(repo, 'config', 'user.name', 'Eval'); git(repo, 'config', 'user.email', 'eval@example.invalid')
    (repo / 'app.py').write_text(APP)
    (repo / 'bench.py').write_text(bench)
    (repo / 'data.txt').write_text(''.join(f'record {i}\n' for i in range(50)))
    (repo / '.gitignore').write_text('out.txt\napp.err\n__pycache__/\n.experiment/\n')
    git(repo, 'add', '.'); git(repo, 'commit', '-m', 'seed')
    git(repo, 'worktree', 'add', '-b', 'experiment', str(w))
    e = w / '.experiment' / 'eval'
    method = root / 'methodology.md'
    text = METHOD.format(w=w)
    if sid.endswith('sensitivity-only'):
        text = '\n'.join(x for x in text.splitlines() if not x.startswith(('Errors:', 'Work:'))) + '\n'
    method.write_text(text)
    rc, out = loop(script, e, 'init', '--worktree', str(w), '--methodology', str(method),
                   '--strategy', 'climb', '--scorer', 'scripted')
    if rc:
        return {'stage': 'init', 'outcome': 'init failed', 'detail': out}
    rc, out = loop(script, e, 'baseline')
    if rc:
        return {'stage': 'baseline', 'outcome': 'refused baseline', 'detail': out.get('reason', out)}
    base = json.loads((e / 'state.json').read_text())['baseline']['median']
    loop(script, e, 'trial', 'begin', '--change', 'edit app.py', '--tradeoff', 'none')
    (w / 'app.py').write_text(edit)
    rc, out = loop(script, e, 'trial', 'commit')
    if rc:
        return {'stage': 'commit', 'outcome': 'commit failed', 'detail': out}
    rc, out = loop(script, e, 'trial', 'score')
    if rc:
        return {'stage': 'trial', 'outcome': 'refused trial', 'baseline': base,
                'detail': out.get('reason', out)}
    last = [json.loads(x) for x in (e / 'results.jsonl').read_text().splitlines()][-1]
    return {'stage': 'trial', 'outcome': out.get('decision'), 'baseline': base,
            'trial_median': last.get('metric_after'), 'reason': out.get('reason')}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--scripts', required=True)
    p.add_argument('--out')
    a = p.parse_args()
    script = Path(a.scripts).resolve() / 'experiment.py'
    results = {}
    for sid, bench, edit, expected in SCENARIOS:
        with tempfile.TemporaryDirectory() as tmp:
            results[sid] = {'expected': expected, **scenario(script, sid, bench, edit, Path(tmp))}
    text = json.dumps(results, indent=2)
    if a.out:
        Path(a.out).write_text(text + '\n')
    print(text)


if __name__ == '__main__':
    main()
