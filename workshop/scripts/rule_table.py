#!/usr/bin/env python3
"""Validate the rule-to-enforcer table used by workshop:harden. Stdlib only.

check [--table PATH]: print one JSON object with the rows that need hardening.
Exit 0 = table valid, 1 = malformed table or a non-prose row without enforcer or proof.
"""
import argparse
import json
import sys
from pathlib import Path

LEVELS = ('architecture', 'hook', 'schema', 'lint', 'test', 'prose')
COLUMNS = ['rule', 'source', 'level', 'enforcer', 'proven on', 'repeats']
DEFAULT = Path(__file__).resolve().parent.parent / 'references' / 'rule-enforcers.md'


def cells(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]


def parse(text):
    """Rows of the first table whose header matches COLUMNS; errors for anything malformed.

    The table may sit among other tables and prose, such as in a repository's AGENTS.md.
    """
    all_lines = text.splitlines()
    start = next((i for i, x in enumerate(all_lines) if x.strip().startswith('|')
                  and [c.lower() for c in cells(x)] == COLUMNS), None)
    if start is None:
        return [], ['table header must be: ' + ' | '.join(COLUMNS)]
    lines = []
    for x in all_lines[start:]:
        if not x.strip().startswith('|'):
            break
        lines.append(x)
    rows, errors = [], []
    for n, line in enumerate(lines[2:], start=1):
        values = cells(line)
        if len(values) != len(COLUMNS):
            errors.append(f'row {n}: expected {len(COLUMNS)} cells, found {len(values)}')
            continue
        row = dict(zip(COLUMNS, values))
        level = row['level'].lower()
        if not row['rule']:
            errors.append(f'row {n}: rule is empty')
        if level not in LEVELS:
            errors.append(f"row {n}: level must be one of {', '.join(LEVELS)}")
        if level != 'prose':
            for name in ('enforcer', 'proven on'):
                if not row[name]:
                    errors.append(f'row {n} ({row["rule"]}): {name} is required for level {level}')
        try:
            row['repeats'] = int(row['repeats'] or 0)
            if row['repeats'] < 0:
                raise ValueError
        except ValueError:
            errors.append(f'row {n}: repeats must be a nonnegative integer')
            row['repeats'] = 0
        row['level'] = level
        rows.append(row)
    return rows, errors


def check(path):
    rows, errors = parse(Path(path).read_text(encoding='utf-8'))
    candidates = [dict(rule=r['rule'], source=r['source'], repeats=r['repeats'])
                  for r in rows if r['level'] == 'prose' and r['repeats'] >= 2]
    return dict(ok=not errors, errors=errors, rows=len(rows), harden=candidates)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    c = sub.add_parser('check')
    c.add_argument('--table', default=str(DEFAULT))
    a = parser.parse_args(argv)
    result = check(a.table)
    print(json.dumps(result, sort_keys=True))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
