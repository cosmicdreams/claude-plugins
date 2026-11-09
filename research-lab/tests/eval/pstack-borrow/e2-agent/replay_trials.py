#!/usr/bin/env python3
"""Apply planted trials to an agent-built engagement with that arm's own loop.

replay_trials.py --run DIR --scripts DIR
Reads ENGAGEMENT= from DIR/final.md, snapshots DIR, and for each planted edit
(CRASH, NO_WORK, HEALTHY) runs trial begin / edit app.py / commit / score, records
the outcome, then restores the snapshot so each trial starts from the frozen baseline.
"""
import argparse, json, re, shutil, subprocess, sys, tarfile, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'experiment_harness'))
import run_eval as r

p = argparse.ArgumentParser(); p.add_argument('--run', required=True); p.add_argument('--scripts', required=True)
a = p.parse_args()
run = Path(a.run); script = Path(a.scripts) / 'experiment.py'
eng = Path(re.search(r'^ENGAGEMENT=(.+)$', (run / 'final.md').read_text(), re.M).group(1).strip())
state = json.loads((eng / 'state.json').read_text())
w = Path(state['worktree'])
snap = Path(tempfile.mkdtemp()) / 'snap.tar'
with tarfile.open(snap, 'w') as t: t.add(run, arcname='.')

def loop(*args):
    x = subprocess.run([sys.executable, str(script), *args, '--engagement', str(eng)], capture_output=True, text=True, timeout=900)
    try: return x.returncode, json.loads(x.stdout)
    except json.JSONDecodeError: return x.returncode, {'raw': (x.stdout + x.stderr)[-300:]}

out = {'baseline': state.get('baseline', {}) and state['baseline'].get('median'), 'trials': {}}
for name, text in [('CRASH', r.CRASH), ('NO_WORK', r.NO_WORK), ('HEALTHY', r.FAST)]:
    rc, o = loop('trial', 'begin', '--change', name, '--tradeoff', 'none')
    (w / 'app.py').write_text(text)
    rc, o = loop('trial', 'commit')
    if rc: out['trials'][name] = {'outcome': 'commit failed', 'detail': o}; 
    else:
        rc, o = loop('trial', 'score')
        out['trials'][name] = {'outcome': o.get('decision') if rc == 0 else 'refused', 'reason': o.get('reason')}
    shutil.rmtree(run)
    run.mkdir()
    with tarfile.open(snap) as t: t.extractall(run, filter='fully_trusted')
    # git worktree metadata lives in the repo's .git; restore the worktree checkout too
    subprocess.run(['git', '-C', str(w), 'reset', '-q', '--hard'], capture_output=True)
print(json.dumps(out))
