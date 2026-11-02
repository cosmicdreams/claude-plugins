#!/usr/bin/env python3
"""Emit a read-only snapshot for an ideas-funnel dispatcher."""
import argparse
import datetime as dt
import json
import math
import subprocess
from pathlib import Path


def allowance(command, max_age):
    try:
        result = subprocess.run([str(command), '--json'], capture_output=True, text=True, timeout=15, check=True)
        pools = json.loads(result.stdout)
        if not isinstance(pools, list):
            raise ValueError('expected a list of pools')
        output = {}
        for pool in pools:
            windows = pool.get('windows') or []
            name = pool.get('pool')
            if not isinstance(name, str):
                continue
            valid = bool(windows) and all(
                type(w.get('remaining_pct')) in (int, float)
                and math.isfinite(w['remaining_pct'])
                and 0 <= w['remaining_pct'] <= 100
                and type(w.get('age_minutes')) in (int, float)
                and math.isfinite(w['age_minutes'])
                and 0 <= w['age_minutes'] < max_age
                and not w.get('stale', False)
                for w in windows
            ) and not pool.get('stale', False)
            output[name] = {'available': valid and all(w['remaining_pct'] >= 20 for w in windows),
                            'windows': windows, 'fresh': valid}
        return output, None
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, AttributeError) as exc:
        return {}, str(exc)


def snapshot(vault, command, max_age=360):
    now = dt.datetime.now(dt.timezone.utc)
    pools, error = allowance(command, max_age)
    def load(relative, default):
        try:
            return json.loads((vault / relative).read_text())
        except FileNotFoundError:
            return default
        except (OSError, ValueError):
            return {'error': 'unreadable ' + relative}
    index = load('Raw/.url-index.json', {})
    runs = load('_meta/ideas-funnel-pull.json', {})
    records = index.get('items', {})
    domains = {}
    inbox = vault / 'Raw/Inbox'
    for domain in sorted(p for p in inbox.glob('*') if p.is_dir()):
        files = [p for p in domain.glob('*.md') if p.name.lower() != 'readme.md']
        waiting = [p for p in files if records.get(str(p.relative_to(vault)), {}).get('state') != 'ingested']
        domains[domain.name] = {'waiting': len(waiting),
            'stale_over_7_days': sum(now.timestamp() - p.stat().st_mtime > 7 * 86400 for p in waiting),
            'unindexed': [str(p.relative_to(vault)) for p in files if str(p.relative_to(vault)) not in records][:20]}
    lease = load('_meta/ideas-funnel-owner.json', {})
    states = {state: sum(r.get('state') == state for r in records.values())
              for state in ('collected', 'processing', 'ingested', 'failed')}
    summary = {'states': states, 'conflicts': index.get('conflicts', [])[:20],
               'conflict_count': len(index.get('conflicts', [])), 'error': index.get('error')}
    return {'run_owner': lease, 'url_index': summary, 'last_pull': runs, 'generated_at': now.isoformat(), 'domains': domains, 'allowance': pools,
            'allowance_error': error}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault', type=Path, required=True)
    parser.add_argument('--allowance', type=Path, default=Path.home() / 'bin' / 'allowance')
    parser.add_argument('--max-age-minutes', type=int, default=360)
    args = parser.parse_args()
    if not args.vault.is_dir() or args.max_age_minutes < 0:
        parser.error('vault must exist and max age must be nonnegative')
    print(json.dumps(snapshot(args.vault, args.allowance, args.max_age_minutes), indent=2))


if __name__ == '__main__':
    main()
