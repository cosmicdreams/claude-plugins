#!/usr/bin/env python3
"""Emit a read-only snapshot for an ideas-funnel dispatcher."""
import argparse
import datetime as dt
import json
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
                isinstance(w.get('remaining_pct'), (int, float))
                and isinstance(w.get('age_minutes'), (int, float))
                and 0 <= w['age_minutes'] <= max_age
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
    inbox = vault / 'Raw' / 'Inbox'
    domains = {}
    if inbox.is_dir():
        for domain in sorted(p for p in inbox.iterdir() if p.is_dir()):
            files = [p for p in domain.glob('*.md') if p.name.lower() != 'readme.md']
            stale = sum((now.timestamp() - p.stat().st_mtime) > 7 * 86400 for p in files)
            domains[domain.name] = {'waiting': len(files), 'stale_over_7_days': stale}
    pools, error = allowance(command, max_age)
    return {'generated_at': now.isoformat(), 'domains': domains, 'allowance': pools,
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
