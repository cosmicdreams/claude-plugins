"""Offline direct transport contracts; fake CLIs never invoke a model."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/council_call.py'
spec = importlib.util.spec_from_file_location('council_call', SCRIPT)
council = importlib.util.module_from_spec(spec)
spec.loader.exec_module(council)


class CouncilCallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.request = self.root / 'request'
        self.request.mkdir()
        (self.request / 'request.md').write_text('Judge this exact request.\n')
        self.panel = self.root / 'panel.json'
        # Shell scripts on PATH capture stdin and argv and return prepared output.
        for name in ('codex', 'claude', 'gemini'):
            cli = self.root / name
            cli.write_text('#!/bin/sh\ncat > "$CAPTURE.stdin"\nprintf "%s\\n" "$@" > "$CAPTURE.args"\n'
                           'printf "%s" "$REPLY"\nprintf "%s" "$HEADER" >&2\nexit "${EXIT_CODE:-0}"\n')
            cli.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.root) + os.pathsep + os.environ['PATH'],
                        CAPTURE=str(self.root / 'capture'), HEADER='')

    def run_cli(self, provider='codex', model='gpt-6.1-sol', options=None, reply=None, **env):
        entry = dict(provider=provider, model=model, options=options or {})
        self.panel.write_text(json.dumps({'second': entry}))
        self.env.update(env)
        self.env['REPLY'] = reply if reply is not None else '{"items":{}}'
        result = subprocess.run([sys.executable, str(SCRIPT), '--request', str(self.request),
                                 '--role', 'second', '--panel', str(self.panel)],
                                env=self.env, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.stderr, '')
        return result, json.loads((self.request / 'return.json').read_text()), entry

    def test_provider_commands_and_stdin(self):
        cases = [
            ('codex', 'gpt-6.1-sol', {'reasoningEffort': 'high'},
             json.dumps({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': '{"items":{}}'}}),
             ['codex', 'exec', '-m', 'gpt-6.1-sol', '-s', 'read-only', '--skip-git-repo-check', '--json', '-c', 'model_reasoning_effort="high"', '-']),
            ('claudeAgent_work', 'claude-opus-5-5', {'effort': 'medium', 'fastMode': False},
             json.dumps({'result': '```json\n{"items":{}}\n```', 'modelUsage': {'claude-opus-5-5': {}}}), None),
            ('claudeAgent', 'claude-opus-5-5', {'effort': 'medium'},
             json.dumps({'result': '{"items":{}}'}), None),
            ('gemini', 'gemini-4-argon', {}, json.dumps({'response': '{"items":{}}', 'stats': {'models': {'gemini-4-argon': {}}}}),
             ['gemini', '-m', 'gemini-4-argon', '-p', 'Judge the request on stdin.', '--approval-mode', 'plan', '--output-format', 'json']),
        ]
        for provider, model, options, reply, expected in cases:
            with self.subTest(provider=provider):
                result, value, entry = self.run_cli(provider, model, options, reply)
                self.assertEqual(result.returncode, 0, value)
                self.assertEqual(value, {'items': {}})
                self.assertEqual(json.loads((self.request / 'invocation.json').read_text()), entry)
                self.assertEqual((self.root / 'capture.stdin').read_text(), 'Judge this exact request.\n')
                args, env = council.command(entry)
                self.assertEqual((self.root / 'capture.args').read_text().splitlines(), args[1:])
                if expected: self.assertEqual(args, expected)
                if provider.startswith('claude'):
                    self.assertEqual(env['CLAUDE_CONFIG_DIR'], str(Path.home() / ('.claude-work' if provider.endswith('_work') else '.claude')))
                    self.assertIn('--strict-mcp-config', args)
                    self.assertEqual(args[args.index('--tools') + 1], '')

    def test_unparseable_reply_preserves_raw(self):
        result, value, _ = self.run_cli(reply='not JSON')
        self.assertEqual(result.returncode, 1)
        self.assertIn('error', value)
        self.assertEqual((self.request / 'return.raw.txt').read_text(), 'not JSON')

    def test_model_mismatch(self):
        for provider, model, reply, header in [
            ('codex', 'gpt-6.1-sol', '{"items":{}}', 'model: gpt-6-luna\n'),
            ('claudeAgent', 'claude-opus-5-5', '{"model":"claude-sonnet-5-5","result":"{}"}', ''),
            ('gemini', 'gemini-4-argon', '{"response":"{}","stats":{"models":{"other":{}}}}', ''),
        ]:
            with self.subTest(provider=provider):
                result, value, _ = self.run_cli(provider, model, reply=reply, HEADER=header)
                self.assertEqual(result.returncode, 1)
                self.assertIn('model mismatch:', value['error'])

    def test_alias_refusal_before_execution(self):
        for model in ('opus', 'sonnet', 'haiku', 'gpt-6-latest'):
            result, value, _ = self.run_cli(model=model)
            self.assertEqual(result.returncode, 1)
            self.assertIn('alias model refused', value['error'])
            self.assertFalse((self.root / 'capture.stdin').exists())

    def test_cli_failure(self):
        result, value, _ = self.run_cli(EXIT_CODE='2', HEADER='offline')
        self.assertEqual(result.returncode, 1)
        self.assertIn('CLI exited 2: offline', value['error'])

    def test_unsupported_options_refused(self):
        result, value, _ = self.run_cli('gemini', 'gemini-4-argon', {'reasoningEffort': 'medium'})
        self.assertEqual(result.returncode, 1)
        self.assertIn('unsupported options', value['error'])

    def test_timeout(self):
        self.panel.write_text(json.dumps({'second': dict(provider='codex', model='gpt-6.1-sol', options={})}))
        with patch.object(council.subprocess, 'run', side_effect=subprocess.TimeoutExpired('codex', 600, output=b'partial')) as run:
            self.assertEqual(council.dispatch(self.request, 'second', self.panel), 1)
        self.assertEqual(run.call_args.kwargs['timeout'], 600)
        self.assertEqual((self.request / 'return.raw.txt').read_text(), 'partial')


if __name__ == '__main__':
    unittest.main()
