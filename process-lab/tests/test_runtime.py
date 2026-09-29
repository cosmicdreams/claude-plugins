import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from process_lab import detect, gates, ledger, status

CLI = ROOT / "scripts" / "process_lab.py"
FIXTURES = ROOT / "tests" / "fixtures"


class ParserTests(unittest.TestCase):
    def test_fixture(self):
        parsed, warnings = gates.parse_page((FIXTURES / "pncb-process-page.html").read_text())
        self.assertEqual(6, len(parsed))
        self.assertEqual([], warnings)
        self.assertEqual("work-started", parsed[0]["id"])
        self.assertEqual("In Development", parsed[0]["jira_transition"]["to"])
        self.assertEqual(3, len(parsed[0]["obligations"]))
        self.assertIsNone(parsed[1]["jira_transition"])
        self.assertEqual(1, len(parsed[1]["obligations"]))
        self.assertEqual("Ready for QA", parsed[3]["jira_transition"]["to"])
        self.assertEqual("declared", parsed[5]["detected_by"])

    def test_unknown_key_and_extra_columns(self):
        html = "<table><tr><th>extra</th><th>Obligations</th><th>Gate</th><th>Jira transition</th><th>Detected by</th></tr><tr><td>x</td><td><p>One</p><p>Two</p></td><td>Test gate</td><td></td><td>mystery detail</td></tr></table>"
        parsed, warnings = gates.parse_page(html)
        self.assertEqual("declared", parsed[0]["detected_by"])
        self.assertEqual(2, len(parsed[0]["obligations"]))
        self.assertEqual(1, len(warnings))


class DetectionTests(unittest.TestCase):
    def test_commands(self):
        cases = {
            "git checkout -b feature/PPS-12-x": "branch-created",
            "git switch -c bugfix/PPS-12-x": "branch-created",
            "git branch feature/PPS-12-x": "branch-created",
            "git worktree add ../work -b feature/PPS-12-x": "branch-created",
            "git commit -m 'PPS-12 fix'": "commit",
            "git push origin HEAD": "pushed",
            "gh pr create": "pull-request-opened",
            "ddev phpunit --filter Foo": "tests-passed",
            "ddev exec vendor/bin/phpunit": "tests-passed",
            "FOO=bar rtk git push": "pushed",
            "command git push": "pushed",
        }
        for command, expected in cases.items():
            with self.subTest(command=command):
                self.assertEqual(expected, detect.detect(command, ["ddev phpunit", "ddev exec vendor/bin/phpunit"])[0]["detected_by"])
        self.assertEqual([], detect.detect("git branch -d old"))
        self.assertEqual([], detect.detect("git branch --list"))
        self.assertEqual([], detect.detect("git branch"))
        self.assertEqual(["commit", "pushed"], [item["detected_by"] for item in detect.detect("git commit -m PPS-12 && git push")])
        self.assertIn("PPS-12", detect.detect("git commit -m \"$(cat <<'EOF'\nPPS-12 fix\nEOF\n)\"")[0]["message"])
        self.assertEqual("PPS-12", detect.ticket_from("feature/PPS-12-slug", "PPS"))
        self.assertIsNone(detect.ticket_from("feature/ABC-12-slug", "PPS"))


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        (self.repo / ".velir").mkdir()
        self.manifest = json.loads((FIXTURES / "project.json").read_text())
        self.write_manifest()
        self.ledger = Path(self.temp.name) / "ledger.jsonl"
        self.env = dict(os.environ, PROCESS_LAB_LEDGER=str(self.ledger))
        parsed, warnings = gates.parse_page((FIXTURES / "pncb-process-page.html").read_text())
        gates.save_cache(self.repo, 4205052827, 1, parsed, warnings)
        subprocess.run(["git", "-C", str(self.repo), "checkout", "-q", "-b", "feature/PPS-123-fix"], check=True)
        subprocess.run(["git", "-C", str(self.repo), "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "test: initial"], check=True)

    def write_manifest(self):
        (self.repo / ".velir" / "project.json").write_text(json.dumps(self.manifest))

    def invoke(self, *args, payload=None, cwd=None):
        return subprocess.run([sys.executable, str(CLI), *args], cwd=cwd or self.repo, input=None if payload is None else json.dumps(payload), text=True, capture_output=True, env=self.env)

    def hook(self, kind, command=None):
        payload = {"cwd": str(self.repo)}
        if command is not None:
            payload["tool_input"] = {"command": command}
        result = self.invoke("hook", kind, payload=payload)
        self.assertEqual(0, result.returncode, result.stderr)
        return json.loads(result.stdout) if result.stdout else None

    def entries(self):
        if not self.ledger.exists():
            return []
        return [json.loads(line) for line in self.ledger.read_text().splitlines()]

    def test_pre_observe_and_enforce(self):
        response = self.hook("pre", "git checkout -b wrong")
        self.assertEqual("PreToolUse", response["hookSpecificOutput"]["hookEventName"])
        self.assertIn("additionalContext", response["hookSpecificOutput"])
        self.assertNotIn("permissionDecision", response["hookSpecificOutput"])
        self.assertEqual("check_failed", self.entries()[-1]["event"])
        self.manifest["mode"] = "enforce"
        self.write_manifest()
        response = self.hook("pre", "git checkout -b wrong")
        self.assertEqual("deny", response["hookSpecificOutput"]["permissionDecision"])
        self.assertIn("permissionDecisionReason", response["hookSpecificOutput"])
        response = self.hook("pre", "git commit -m 'missing ticket'")
        self.assertEqual("deny", response["hookSpecificOutput"]["permissionDecision"])
        self.assertIsNone(self.hook("pre", "git commit --amend"))

    def test_post_once_discharge_waive_status_report(self):
        self.hook("post", "git push")
        self.hook("post", "git push")
        entries = self.entries()
        self.assertEqual(2, sum(e["event"] == "gate_crossed" for e in entries))
        self.assertEqual(4, sum(e["event"] == "obligation_opened" for e in entries))
        first = "jira-transition"
        second = "manual-testing-steps-written-on-the-ticket"
        result = self.invoke("discharge", "--gate", "pushed-to-remote-dev", "--obligation", first, "--evidence", "Jira transition 41", "--ticket", "PPS-123")
        self.assertEqual(0, result.returncode, result.stderr)
        result = self.invoke("waive", "--gate", "pushed-to-remote-dev", "--obligation", second, "--reason", "No UI change", "--ticket", "PPS-123", "--actor", "human")
        self.assertEqual(0, result.returncode, result.stderr)
        summary = json.loads(self.invoke("status", "--ticket", "PPS-123", "--json").stdout)
        self.assertEqual(2, summary["gates_crossed"])
        self.assertEqual(2, len(summary["outstanding"]["pushed-to-remote-dev"]))
        report = json.loads(self.invoke("report", "--since", "2020-01-01", "--json").stdout)
        group = report["gates"]["pushed-to-remote-dev"]
        self.assertEqual((2, 4, 1, 1, 2), (group["crossings"], group["obligations_opened"], group["discharged"], group["waived"], group["still_open"]))
        self.assertEqual(0.25, group["discharge_rate"])
        self.assertEqual(["No UI change"], group["waiver_reasons"][second])

    def test_missing_manifest_and_bad_stdin(self):
        (self.repo / ".velir" / "project.json").unlink()
        self.assertIsNone(self.hook("post", "git push"))
        result = subprocess.run([sys.executable, str(CLI), "hook", "post"], cwd=self.repo, input="{bad", text=True, capture_output=True, env=self.env)
        self.assertEqual(0, result.returncode)
        self.assertEqual("", result.stdout)

    def test_invalid_manifest_warning_and_no_ledger(self):
        self.manifest["mode"] = "broken"
        self.write_manifest()
        response = self.hook("post", "git push")
        self.assertIn("invalid project manifest", response["hookSpecificOutput"]["additionalContext"])
        self.assertEqual([], self.entries())

    def test_no_ticket_and_declare(self):
        self.hook("post", "git checkout -b wrong")
        self.assertEqual(0, sum(e["event"] == "obligation_opened" for e in self.entries()))
        self.assertIn("no ticket key", self.hook("post", "git checkout -b wrong")["hookSpecificOutput"]["additionalContext"])
        result = self.invoke("declare", "--gate", "deployed-for-user-acceptance-testing", "--ticket", "PPS-123")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(1, sum(e["event"] == "gate_declared" for e in self.entries()))

    def test_ledger_malformed_line(self):
        self.ledger.write_text("not json\n" + json.dumps({"event": "gate_crossed", "project": "PPS", "ticket": "PPS-123", "gate": "x"}) + "\n")
        result = self.invoke("status", "--ticket", "PPS-123", "--json")
        self.assertEqual(1, json.loads(result.stdout)["gates_crossed"])

    def test_sync_and_session_notice(self):
        result = self.invoke("sync", "--page-file", str(FIXTURES / "pncb-process-page.html"), "--page-id", "4205052827", "--page-version", "2")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(6, len(json.loads(result.stdout)["gates"]))
        cache = json.loads((self.repo / ".velir" / "process-cache.json").read_text())
        cache["synced_at"] = "2020-01-01T00:00:00Z"
        (self.repo / ".velir" / "process-cache.json").write_text(json.dumps(cache))
        response = self.hook("session")
        self.assertIn("older than 14 days", response["hookSpecificOutput"]["additionalContext"])
        (self.repo / ".velir" / "process-cache.json").unlink()
        response = self.hook("session")
        self.assertIn("process-lab:initialize", response["hookSpecificOutput"]["additionalContext"])


if __name__ == "__main__":
    unittest.main()
