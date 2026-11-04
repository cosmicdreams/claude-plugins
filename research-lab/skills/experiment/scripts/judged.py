#!/usr/bin/env python3
"""Interface placeholder for judged experiment state transitions."""
import argparse
import json
import sys

parser = argparse.ArgumentParser()
sub = parser.add_subparsers(dest='command', required=True)
for name in ('validate', 'capture', 'trial', 'open', 'score', 'abandon',
             'invalidate', 'checks', 'resolve', 'next'):
    p = sub.add_parser(name)
    if name == 'trial':
        p.add_argument('operation', choices=('begin', 'commit'))
    p.add_argument('--engagement', required=True)
    p.add_argument('--protocol', required=True)
    if name == 'validate':
        p.add_argument('--host')
    if name in ('capture', 'trial', 'checks', 'resolve', 'next'):
        p.add_argument('--worktree', required=name in ('capture', 'trial', 'checks', 'next'))
    if name == 'capture':
        p.add_argument('--role', required=True, choices=('incumbent', 'candidate'))
    if name == 'trial':
        p.add_argument('--change')
    if name in ('open', 'next'):
        p.add_argument('--panel', required=True)
    if name == 'open':
        p.add_argument('--purpose', required=True, choices=('calibrate', 'confirm', 'measure'))
        p.add_argument('--seed', required=True, type=int)
    if name in ('score', 'abandon', 'invalidate', 'checks'):
        p.add_argument('--eval', required=True)
    if name == 'invalidate':
        p.add_argument('--reason', required=True)
    if name == 'checks':
        g = p.add_mutually_exclusive_group(required=True)
        g.add_argument('--passed', action='store_true')
        g.add_argument('--failed', action='store_true')
        p.add_argument('--details')
    if name == 'resolve':
        p.add_argument('--decision', required=True, choices=('withdraw', 'retry', 'continue', 'reject'))
        p.add_argument('--note', required=True)
parser.parse_args()
print(json.dumps({'error': 'not implemented'}))
sys.exit(3)
