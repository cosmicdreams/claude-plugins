#!/usr/bin/env python3
"""Continue running engagements; stay silent everywhere else."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

SCRIPTS = Path(__file__).resolve().parents[1] / 'skills/experiment/scripts'
sys.path.insert(0, str(SCRIPTS))


def main():
    try:
        from experiment_loop import ending, live_lock, save
        from experiment_report import engagements

        data = json.load(sys.stdin) if not sys.stdin.isatty() else {}
        cwd = data.get('cwd') or os.getcwd()
        r = subprocess.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'],
                           capture_output=True, text=True, timeout=0.5)
        if r.returncode:
            return
        for e, s in engagements(r.stdout.strip()):
            if live_lock(e):
                return
            if s.get('status') != 'running':
                continue
            command = f"python3 {shlex.quote(str(SCRIPTS / 'experiment.py'))} next --engagement {shlex.quote(str(e))}"
            if sys.argv[1] == 'start':
                print(f"Experiment {e}: {s['strategy']}, trials used {s['trials_used']}, "
                      f"ratchet {s['ratchet']}. Run {command} and do its action.")
                return
            results = e / 'results.jsonl'
            count = len(results.read_text().splitlines()) if results.exists() else 0
            if count > s.get('stop_results_count', 0):
                s['stop_blocks'] = 0
            s['stop_results_count'] = count
            s['stop_blocks'] += 1
            if s['stop_blocks'] > 3:
                ending(s, 'paused', 'agent stalled: no progress across 3 continuations')
                save(e, s)
                return
            save(e, s)
            print(json.dumps(dict(decision='block', reason=f"Experiment {e} is running: run {command} and do its action.")))
            return
    except (ImportError, OSError, ValueError, KeyError, subprocess.TimeoutExpired):
        return


if __name__ == '__main__':
    main()
