import json
from concurrent.futures import ThreadPoolExecutor
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
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

    def test_status_macro_colspan_nested_table_and_ids(self):
        header = "<tr><th>Gate</th><th>Detected by</th><th>Jira transition</th><th>Obligations</th></tr>"
        row = "<tr><td>Ready {ready-id}</td><td><ac:structured-macro ac:name='status'><ac:parameter ac:name='title'>pushed</ac:parameter></ac:structured-macro></td><td colspan='2'>None</td></tr>"
        parsed, _ = gates.parse_page("<table>" + header + row + "</table>")
        self.assertEqual(("ready-id", "pushed"), (parsed[0]["id"], parsed[0]["detected_by"]))
        macro = "<ac:structured-macro ac:name='note'><ac:parameter ac:name='title'>Ignore</ac:parameter><ac:rich-text-body><p>Body text</p></ac:rich-text-body></ac:structured-macro>"
        parsed, _ = gates.parse_page("<table>" + header + "<tr><td>Ready</td><td>pushed</td><td>None</td><td>" + macro + "</td></tr></table>")
        self.assertEqual("Body text", parsed[0]["obligations"][0]["text"])
        row = "<tr><td>Ready</td><td>pushed</td><td>None</td><td><table><tr><td>Review</td><td>Approve</td></tr></table></td></tr>"
        parsed, _ = gates.parse_page("<table>" + header + row + "</table>")
        self.assertEqual(["Review", "Approve"], [o["text"] for o in parsed[0]["obligations"]])
        for bad in ("<tr><td>Ready</td><td>pushed</td><td colspan='3'>None</td></tr>", "<tr><td rowspan='2'>Ready</td><td>pushed</td><td>None</td><td>X</td></tr>"):
            with self.assertRaisesRegex(ValueError, "row 2"):
                gates.parse_page("<table>" + header + bad + "</table>")
        row = "<tr><td>Ready</td><td>pushed</td><td>None</td><td>Review A/B; Review A B</td></tr>"
        with self.assertRaisesRegex(ValueError, "duplicate obligation id"):
            gates.parse_page("<table>" + header + row + "</table>")
        row = "<tr><td>Ready</td><td>pushed</td><td>None</td><td>X</td></tr>"
        with self.assertRaisesRegex(ValueError, "duplicate gate id"):
            gates.parse_page("<table>" + header + row + row + "</table>")


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

    def test_shell_certainty_and_nonexecuting_options(self):
        self.assertEqual("Fix; PPS-123", detect.detect('git commit -m "Fix; PPS-123"')[0]["message"])
        self.assertEqual([], detect.detect('git commit -m "unclosed'))
        self.assertFalse(detect.detect("true || git push")[0]["certain"])
        self.assertFalse(detect.detect("git push; true")[0]["certain"])
        self.assertFalse(detect.detect("git push\ntrue")[0]["certain"])
        self.assertFalse(detect.detect("git push | cat")[0]["certain"])
        self.assertEqual([], detect.detect("git push --dry-run"))
        self.assertEqual([], detect.detect("git push -n"))
        self.assertEqual([], detect.detect("git commit --dry-run -m PPS-123"))
        self.assertEqual([], detect.detect("pytest --collect-only", ["pytest"]))
        self.assertEqual([], detect.detect("pytest --version", ["pytest"]))
        self.assertEqual([], detect.detect("pytest --collect-only=yes", ["pytest"]))
        self.assertEqual("commit", detect.detect("git commit -m 'PPS-123 --dry-run'")[0]["detected_by"])


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

    def test_ledger_lock_timeout_logs_and_skips(self):
        import time
        with patch.dict(os.environ, {"PROCESS_LAB_LEDGER": str(self.ledger)}), patch.object(ledger.fcntl, "flock", side_effect=BlockingIOError("held")):
            start = time.monotonic()
            self.assertIsNone(ledger.append("PPS", "PPS-123", "branch", "gate_crossed", gate="g"))
            elapsed = time.monotonic() - start
        self.assertLess(elapsed, 0.4)
        self.assertIn("BlockingIOError", (self.ledger.parent / "errors.log").read_text())
        self.assertEqual([], self.entries())

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

    def test_quoted_commit_and_post_certainty(self):
        self.manifest["mode"] = "enforce"
        self.write_manifest()
        self.assertIsNone(self.hook("pre", 'git commit -m "Fix; PPS-123"'))
        for command in ("true || git push", "git push --dry-run", "git push -n", "git push; true"):
            self.hook("post", command)
        self.assertEqual([], self.entries())

    def test_effective_directory_and_git_c(self):
        other = Path(self.temp.name) / "other"
        other.mkdir()
        subprocess.run(["git", "init", "-q", str(other)], check=True)
        (other / ".velir").mkdir()
        (other / ".velir" / "project.json").write_text(json.dumps(self.manifest))
        parsed, warnings = gates.parse_page((FIXTURES / "pncb-process-page.html").read_text())
        gates.save_cache(other, 4205052827, 1, parsed, warnings)
        subprocess.run(["git", "-C", str(other), "checkout", "-q", "-b", "feature/PPS-456-other"], check=True)
        subprocess.run(["git", "-C", str(other), "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "test: initial"], check=True)
        self.hook("post", "cd ../other && git push")
        self.hook("post", "git -C ../other push")
        self.assertEqual({"PPS-456"}, {e["ticket"] for e in self.entries()})
        self.assertEqual(4, sum(e["event"] == "obligation_opened" for e in self.entries()))
        self.hook("post", "cd ../missing && git push")
        self.assertEqual(2, sum(e["event"] == "gate_crossed" for e in self.entries()))

    def test_branch_created_changes_later_segment_context(self):
        self.hook("post", "git switch -c feature/PPS-789-new && git push")
        self.assertEqual({"PPS-789"}, {e["ticket"] for e in self.entries()})
        self.assertEqual(2, sum(e["event"] == "gate_crossed" for e in self.entries()))

    def test_concurrent_open_and_reopen_cycle(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: self.hook("post", "git push"), range(4)))
        self.assertEqual(4, sum(e["event"] == "obligation_opened" for e in self.entries()))
        obligation = "jira-transition"
        self.assertEqual(0, self.invoke("discharge", "--gate", "pushed-to-remote-dev", "--obligation", obligation, "--evidence", "done").returncode)
        self.hook("post", "git push")
        self.assertNotIn(obligation, [o["id"] for o in json.loads(self.invoke("status", "--json").stdout)["outstanding"]["pushed-to-remote-dev"]])
        self.assertEqual(0, self.invoke("reopen", "--gate", "pushed-to-remote-dev", "--reason", "new revision").returncode)
        summary = json.loads(self.invoke("status", "--json").stdout)
        self.assertIn(obligation, [o["id"] for o in summary["outstanding"]["pushed-to-remote-dev"]])
        self.assertEqual(1, json.loads(self.invoke("report", "--since", "2020-01-01", "--json").stdout)["gates"]["pushed-to-remote-dev"]["reopened"])

    def test_sync_error_preserves_cache(self):
        cache_file = self.repo / ".velir" / "process-cache.json"
        original = cache_file.read_bytes()
        bad_page = Path(self.temp.name) / "bad-page.html"
        bad_page.write_text("<table><tr><th>Gate</th><th>Detected by</th><th>Jira transition</th><th>Obligations</th></tr><tr><td>Bad</td><td>pushed</td><td colspan='3'>None</td></tr></table>")
        result = self.invoke("sync", "--page-file", str(bad_page), "--page-id", "4205052827", "--page-version", "2")
        self.assertEqual(1, result.returncode)
        self.assertIn("row 2", result.stderr)
        self.assertEqual(original, cache_file.read_bytes())

    def test_status_failed_check_details(self):
        self.hook("pre", "git commit -m missing")
        summary = json.loads(self.invoke("status", "--json").stdout)
        self.assertEqual(1, summary["checks_failed"])
        self.assertEqual("commit_message", summary["failed_checks"][0]["check"])
        self.assertIn("Commit message must contain", summary["failed_checks"][0]["detail"])

    def test_page_id_mismatch_and_status_fields(self):
        self.manifest["confluence"]["pages"]["process"] = 12345
        self.write_manifest()
        self.assertIsNone(self.hook("post", "git push"))
        self.assertIn("process-lab:initialize", self.hook("session")["hookSpecificOutput"]["additionalContext"])
        summary = json.loads(self.invoke("status", "--json").stdout)
        self.assertEqual({"page_id": None, "page_version": None, "synced_at": None, "stale": True}, summary["cache"])
        self.assertEqual([], summary["failed_checks"])

    def test_report_window_math_and_declared_count(self):
        entries = [
            {"ts": "2026-01-01T00:00:00Z", "project": "PPS", "ticket": "PPS-1", "gate": "g", "obligation": "o", "text": "O", "event": "obligation_opened"},
            {"ts": "2026-02-01T00:00:00Z", "project": "PPS", "ticket": "PPS-1", "gate": "g", "obligation": "o", "event": "obligation_discharged"},
            {"ts": "2026-02-02T00:00:00Z", "project": "PPS", "ticket": "PPS-1", "gate": "g", "event": "gate_declared"},
            {"ts": "2026-02-03T00:00:00Z", "project": "OTHER", "ticket": "OTHER-1", "gate": "g", "event": "gate_crossed"},
        ]
        group = status.report("2026-02-01", "2026-02-28", "PPS", entries)["gates"]["g"]
        self.assertEqual((1, 0, 1, 0, 1, 0, 1.0), (group["open_at_start"], group["opened"], group["discharged"], group["open_at_end"], group["crossings"], group["reopened"], group["discharge_rate"]))
        self.assertEqual(1, status.summarize("PPS", "PPS-1", entries)["gates_crossed"])
        result = self.invoke("declare", "--gate", "deployed-for-user-acceptance-testing", "--ticket", "PPS-123")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(1, json.loads(self.invoke("status", "--ticket", "PPS-123", "--json").stdout)["gates_crossed"])

    def test_report_reopen_after_window_discharge(self):
        entries = [
            {"ts": "2026-01-01T00:00:00Z", "project": "PPS", "ticket": "PPS-1", "gate": "g", "obligation": "o", "text": "O", "event": "obligation_opened"},
            {"ts": "2026-02-01T00:00:00Z", "project": "PPS", "ticket": "PPS-1", "gate": "g", "obligation": "o", "event": "obligation_discharged"},
            {"ts": "2026-02-02T00:00:00Z", "project": "PPS", "ticket": "PPS-1", "gate": "g", "event": "gate_reopened"},
        ]
        group = status.report("2026-02-01", "2026-02-28", "PPS", entries)["gates"]["g"]
        self.assertEqual((1, 1, 1, 1, 0.5), (group["open_at_start"], group["opened"], group["reopened"], group["open_at_end"], group["discharge_rate"]))

    def test_report_defaults_to_manifest_project(self):
        self.ledger.write_text("\n".join(json.dumps(e) for e in [
            {"ts": "2026-02-01T00:00:00Z", "project": "PPS", "ticket": "PPS-1", "gate": "g", "event": "gate_declared"},
            {"ts": "2026-02-01T00:00:00Z", "project": "OTHER", "ticket": "OTHER-1", "gate": "g", "event": "gate_declared"},
        ]) + "\n")
        report = json.loads(self.invoke("report", "--since", "2026-02-01", "--json").stdout)
        self.assertEqual("PPS", report["project"])
        self.assertEqual(1, report["gates"]["g"]["crossings"])

    def test_unsafe_branch_pattern_warning(self):
        self.manifest["conventions"]["branch_pattern"] = "^(a+)+$"
        self.write_manifest()
        from process_lab import manifest
        data, _ = manifest.load_manifest(self.repo)
        self.assertIsNone(data["conventions"]["branch_pattern"])
        self.assertIn("Unsafe branch_pattern", data["warnings"][0])


if __name__ == "__main__":
    unittest.main()
