"""Offline subprocess tests for account selection, bounded failures and secret handling."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "skills/testrail/scripts/testrail.py"
ITEM = "a" * 26
SHARED = "b" * 26
SECRET = 'sentinel-secret-with-"quote\\slash'

FAKE = r'''#!/usr/bin/env python3
import json, os, sys, time
from pathlib import Path
name = Path(sys.argv[0]).name
secret = os.environ['FAKE_SECRET']
assert secret not in str(sys.argv), 'Secret leaked to argv'
with open(os.environ['CALL_LOG'], 'a') as log:
    log.write(json.dumps([name, sys.argv[1:]]) + '\n')
mode = os.environ.get('MODE', '')
if name == 'op':
    if mode == 'locked':
        time.sleep(5)
    if mode == 'wrong':
        print('item not found: ' + secret, file=sys.stderr)
        sys.exit(1)
    if mode == 'denied':
        print('not signed in: ' + secret, file=sys.stderr)
        sys.exit(1)
    shared = '/' + 'b' * 26 + '/' in sys.argv[-1]
    print(('studio@example.com' if shared else 'own@example.com')
          if sys.argv[-1].endswith('/username') else secret)
elif name == 'security':
    print(secret)
else:
    config = sys.stdin.read()
    escaped = secret.replace('\\', '\\\\').replace('"', '\\"')
    assert escaped in config, 'Missing stdin secret'
    assert sys.argv[1] == '-q'
    assert sys.argv[-2:] == ['-K', '-']
    assert '-u' not in sys.argv
    url = next(line for line in config.splitlines() if line.startswith('url = '))
    endpoint = url.split('/api/v2/')[1].rstrip('"')
    with open(os.environ['ENDPOINT_LOG'], 'a') as log:
        log.write(endpoint + '\n')
    status = 200
    if mode == '401':
        status, data = 401, {'error': secret}
    elif mode == 'network':
        print(secret, file=sys.stderr)
        sys.exit(7)
    elif endpoint.startswith('get_user_by_email'):
        data = {'email': 'studio@example.com' if 'studio' in config else 'own@example.com'}
    elif endpoint == 'get_projects':
        if mode == 'legacy':
            data = [{'id': 1}]
        else:
            data = {'projects': [{'id': 1}], '_links': {'next': '/api/v2/get_projects&offset=1'}}
    elif endpoint == 'get_projects&offset=1':
        data = {'projects': [{'id': 93}, {'id': 99}], '_links': {'next': None}}
        if mode == 'foreign':
            data['_links']['next'] = 'https://evil.example/api/v2/get_projects'
        if mode == 'repeat':
            data['_links']['next'] = '/api/v2/get_projects&offset=1'
    else:
        data = {'id': 123, 'echo': secret}
    print(json.dumps(data))
    print(status, end='')
'''


class TestRailTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("op", "security", "curl"):
            executable = self.root / name
            executable.write_text(FAKE)
            executable.chmod(0o755)
        self.config = self.root / "config.md"
        self.config.write_text(f"host: example.testrail.com\nop_item: op://Employee/{ITEM}\n"
                               f"op_item_shared: op://Employee/{SHARED}\n")
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("TESTRAIL_")}
        self.env.update(PATH=str(self.root) + os.pathsep + os.environ["PATH"],
                        FAKE_SECRET=SECRET, CALL_LOG=str(self.root / "calls"),
                        ENDPOINT_LOG=str(self.root / "endpoints"))

    def run_client(self, *args, mode=""):
        env = dict(self.env, MODE=mode)
        result = subprocess.run([sys.executable, str(SCRIPT), "--config", str(self.config), *args],
                                capture_output=True, text=True, env=env, timeout=10)
        self.assertNotIn(SECRET, result.stdout + result.stderr)
        return result

    def calls(self):
        return [json.loads(line) for line in (self.root / "calls").read_text().splitlines()]

    def test_default_and_shared_use_paired_item_fields_and_count_pages(self):
        for account, item, email in (("default", ITEM, "own@example.com"),
                                     ("shared", SHARED, "studio@example.com")):
            with self.subTest(account=account):
                result = self.run_client("whoami", "--account", account, "--project", "93")
                self.assertEqual(result.returncode, 0, result.stderr)
                data = json.loads(result.stdout)
                self.assertEqual(data["project_count"], 3)
                self.assertEqual(data["project_ids"], [1, 93, 99])
                self.assertEqual(data["user"]["email"], email)
                self.assertIn(f"account={account}", result.stderr)
                reads = [args[-1] for name, args in self.calls() if name == "op"][-2:]
                self.assertEqual(reads, [f"op://Employee/{item}/username", f"op://Employee/{item}/password"])

    def test_default_specific_reference_wins_over_alias(self):
        with self.config.open("a") as config:
            config.write(f"op_item_default: op://Employee/{SHARED}\n")
        result = self.run_client("whoami")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["user"]["email"], "studio@example.com")

    def test_environment_tuple_without_config(self):
        self.config.unlink()
        self.env.update(TESTRAIL_URL="https://env.testrail.com/index.php?/api/v2/",
                        TESTRAIL_USERNAME="env@example.com", TESTRAIL_API_KEY=SECRET)
        result = self.run_client("get_projects")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(json.loads(result.stdout)), 3)
        self.assertTrue(all(name == "curl" for name, _ in self.calls()))
        self.assertIn("source=environment", result.stderr)

    def test_keychain_uses_email(self):
        self.config.write_text("host: example.testrail.com\nusername: email@example.com\n")
        result = self.run_client("whoami")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls()[0], ["security", ["find-generic-password", "-s", "testrail", "-a", "email@example.com", "-w"]])

    def test_wrong_item_never_falls_back(self):
        self.env.update(TESTRAIL_URL="https://env.example", TESTRAIL_USERNAME="env@example.com", TESTRAIL_API_KEY=SECRET)
        result = self.run_client("whoami", mode="wrong")
        self.assertEqual(result.returncode, 1)
        self.assertIn("item or field not found", result.stderr)
        self.assertEqual([name for name, _ in self.calls()], ["op"])

    def test_locked_lookup_is_bounded(self):
        start = time.monotonic()
        result = self.run_client("whoami", "--op-timeout", "0.1", mode="locked")
        self.assertLess(time.monotonic() - start, 2)
        self.assertEqual(result.returncode, 1)
        self.assertIn("1Password locked or not signed in", result.stderr)

    def test_empty_config_partial_env_short_username_and_missing_account(self):
        for content, env, args, expected in (
            ("", {}, [], "not configured"),
            ("", {"TESTRAIL_API_KEY": SECRET}, [], "Incomplete environment"),
            ("host: example.com\nusername: Chris.Weber\n", {}, [], "login email"),
            ("", {}, ["--account", "shared"], "Account shared is not configured"),
            ("host: example.com\nop_item: op://Employee/TestRail\n", {}, [], "never an item title"),
        ):
            with self.subTest(expected=expected):
                self.config.write_text(content)
                self.env.update(env)
                result = self.run_client("whoami", *args)
                self.assertEqual(result.returncode, 1)
                self.assertIn(expected, result.stderr)
                self.env.pop("TESTRAIL_API_KEY", None)

    def test_missing_project_reports_authenticated_identity(self):
        result = self.run_client("get_cases/93", mode="legacy")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Authenticated as own@example.com, which can't see project 93", result.stderr)
        self.assertNotIn("get_cases/93", (self.root / "endpoints").read_text())

    def test_401_does_not_claim_authentication_or_print_response_secret(self):
        result = self.run_client("whoami", mode="401")
        self.assertEqual(result.returncode, 1)
        self.assertIn("HTTP 401", result.stderr)
        self.assertNotIn("Authenticated as", result.stderr)

    def test_response_secret_and_curl_errors_are_redacted(self):
        result = self.run_client("get_case/123")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["echo"], "[REDACTED]")
        result = self.run_client("whoami", mode="network")
        self.assertEqual(result.returncode, 1)
        self.assertIn("network/TLS", result.stderr)

    def test_unsafe_endpoint_rejected_before_loading_credentials(self):
        for endpoint in ("add_case/1", "get_projects&url=https://evil.example", "get_case/1\nuser=x"):
            result = self.run_client(endpoint)
            self.assertEqual(result.returncode, 1)
            self.assertIn("read-only", result.stderr)
        self.assertFalse((self.root / "calls").exists())

    def test_foreign_and_repeating_pagination_rejected(self):
        for mode, expected in (("foreign", "unexpected"), ("repeat", "repeating")):
            result = self.run_client("whoami", mode=mode)
            self.assertEqual(result.returncode, 1)
            self.assertIn(expected, result.stderr)


if __name__ == "__main__":
    unittest.main()
