#!/usr/bin/env python3
"""Dispatch one prepared council request through a pinned local CLI."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess


def command(entry):
    provider, model, options = entry['provider'], entry['model'], entry['options']
    if not isinstance(model, str) or not model or model in ('opus', 'sonnet', 'haiku', 'fable', 'auto') or model.endswith(('-latest', '-preview')):
        raise ValueError('alias model refused: exact model name required')
    if not isinstance(options, dict):
        raise ValueError('options must be an object')
    env = os.environ.copy()
    if provider == 'codex':
        allowed = {'reasoningEffort'}
        args = ['codex', 'exec', '-m', model, '-s', 'read-only', '--skip-git-repo-check', '--json']
        if 'reasoningEffort' in options:
            args += ['-c', 'model_reasoning_effort=' + json.dumps(options['reasoningEffort'])]
        args += ['-']
    elif provider in ('claudeAgent', 'claudeAgent_work'):
        allowed = {'effort', 'fastMode'}
        if options.get('fastMode', False) is not False:
            raise ValueError('direct Claude requires fastMode false')
        env['CLAUDE_CONFIG_DIR'] = str(Path.home() / ('.claude-work' if provider == 'claudeAgent_work' else '.claude'))
        args = ['claude', '-p', '--model', model, '--output-format', 'json',
                '--tools', '', '--strict-mcp-config', '--permission-mode', 'plan',
                '--settings', '{"fastMode":false}']
        if 'effort' in options:
            args += ['--effort', options['effort']]
    elif provider == 'gemini':
        allowed = set()  # The installed CLI exposes no reasoning/effort option.
        args = ['gemini', '-m', model, '-p', 'Judge the request on stdin.',
                '--approval-mode', 'plan', '--output-format', 'json']
    else:
        raise ValueError('unsupported provider: ' + str(provider))
    if not isinstance(options, dict) or options.keys() - allowed:
        raise ValueError('unsupported options for ' + provider)
    return args, env


def reply_text(provider, stdout, stderr, model):
    reported = re.findall(r'^model:\s*(\S+)', stdout + '\n' + stderr, re.M)
    if provider == 'codex':
        messages = []
        for line in stdout.splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if not isinstance(event, dict):
                continue
            if isinstance(event.get('model'), str):
                reported.append(event['model'])
            item = event.get('item', {})
            if event.get('type') == 'item.completed' and isinstance(item, dict) and item.get('type') == 'agent_message':
                messages.append(item['text'])
        text = messages[-1] if messages else stdout
    else:
        envelope = json.loads(stdout)
        if not isinstance(envelope, dict):
            raise ValueError('CLI output must be a JSON object')
        if isinstance(envelope.get('model'), str):
            reported.append(envelope['model'])
        reported.extend(envelope.get('modelUsage', {}))
        reported.extend(envelope.get('stats', {}).get('models', {}))
        if envelope.get('is_error') or envelope.get('error'):
            raise ValueError('CLI error: ' + str(envelope.get('error', envelope.get('result'))))
        text = envelope['response' if provider == 'gemini' else 'result']
    if not isinstance(text, str):
        raise ValueError('CLI response must be text')
    if any(name != model for name in reported):
        raise ValueError(f'model mismatch: pinned {model}, reported {reported}')
    return text


def dispatch(request, role, panel):
    raw = ''
    try:
        entry = json.loads(panel.read_text(encoding='utf-8'))[role]
        args, env = command(entry)
        (request / 'invocation.json').write_text(json.dumps(entry) + '\n', encoding='utf-8')
        result = subprocess.run(args, input=(request / 'request.md').read_text(encoding='utf-8'),
                                text=True, capture_output=True, timeout=600, env=env)
        raw = result.stdout
        if result.returncode:
            raise ValueError(f'CLI exited {result.returncode}: {result.stderr}')
        text = reply_text(entry['provider'], raw, result.stderr, entry['model'])
        start, end = text.find('{'), text.rfind('}')
        if start < 0 or end < start:
            raise ValueError('reply is not a JSON object')
        value = json.loads(text[start:end + 1])
        if not isinstance(value, dict):
            raise ValueError('reply is not a JSON object')
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as exc:
        if isinstance(exc, subprocess.TimeoutExpired):
            raw = exc.stdout or ''
            if isinstance(raw, bytes): raw = raw.decode('utf-8', errors='replace')
        (request / 'return.raw.txt').write_text(raw, encoding='utf-8')
        value = {'error': str(exc)}
    (request / 'return.json').write_text(json.dumps(value) + '\n', encoding='utf-8')
    return 1 if 'error' in value else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', required=True, type=Path)
    parser.add_argument('--role', required=True)
    parser.add_argument('--panel', required=True, type=Path)
    a = parser.parse_args()
    raise SystemExit(dispatch(a.request.resolve(), a.role, a.panel.resolve()))
