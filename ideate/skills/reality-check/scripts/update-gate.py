#!/usr/bin/env python3
"""
Update .reality-check.json after evaluating a gate.

Usage:
    python3 update-gate.py <gate_num> <gate_name> <challenge> <result> <response> <evaluator_note>

Arguments:
    gate_num       : 1-5
    gate_name      : e.g. "Problem clarity"
    challenge      : The verbatim challenge text
    result         : PASS, WARN, or KILL
    response       : The user's response (quote or summarize)
    evaluator_note : Why it passed or was killed

Exit codes:
    0 = PASS or WARN (continue to next gate)
    1 = KILL (stop, proceed to verdict)
"""

import json
import sys

gate_num = int(sys.argv[1])
gate_name = sys.argv[2]
challenge = sys.argv[3]
result = sys.argv[4].upper()
response = sys.argv[5]
evaluator_note = sys.argv[6]

with open('.reality-check.json') as f:
    state = json.load(f)

gate_record = {
    'gate': gate_num,
    'name': gate_name,
    'challenge': challenge,
    'response': response,
    'result': result,
    'evaluator_note': evaluator_note,
}
state['gates'].append(gate_record)

if result == 'KILL':
    state['status'] = 'killed'
    state['killed_at'] = gate_num
    exit_code = 1
elif gate_num == 5 and result == 'PASS':
    state['status'] = 'cleared'
    exit_code = 0
else:
    state['current_gate'] = gate_num + 1
    exit_code = 0

with open('.reality-check.json', 'w') as f:
    json.dump(state, f, indent=2)

print(f"Gate {gate_num}: {result}")
sys.exit(exit_code)
