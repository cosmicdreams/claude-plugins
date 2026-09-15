"""Offline regression tests against the working-tree wrappers (stdlib only)."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
TASK_ID = "12345678-1234-1234-1234-123456789abc"
# Rendered compact output from _display_research_status in upstream
# jacob-bd/gemini-notebook-mcp-cli v0.9.11 and v0.11.4:
# src/notebooklm_tools/cli/commands/research.py (neither supports --json).
COMPLETED = (
    "\nResearch Status:\n"
    "  Status: completed\n"
    f"  Task ID: {TASK_ID}\n"
    "  Sources found: 2\n"
    "\nRun 'nlm research import nb <task-id>' to import sources.\n"
)


class WrapperTests(unittest.TestCase):
    def run_wrapper(self, script, args, replies):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "home").mkdir()
            binary = root / "bin"
            binary.mkdir()
            # Only these tools and the fake CLI are visible to the wrapper.
            for name, target in {
                "python3": sys.executable, "mktemp": "/usr/bin/mktemp",
                "cat": "/bin/cat", "rm": "/bin/rm", "grep": "/usr/bin/grep",
            }.items():
                (binary / name).symlink_to(target)
            (root / "replies.json").write_text(json.dumps(replies))
            fake = binary / "nlm"
            fake.write_text(f"#!{sys.executable}\n" + """
import json, os, pathlib, sys
root = pathlib.Path(os.environ["FAKE_ROOT"])
log = root / "calls.jsonl"
calls = log.read_text().splitlines() if log.exists() else []
with log.open("a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\\n")
replies = json.loads((root / "replies.json").read_text())
if len(calls) >= len(replies):
    print("unexpected extra CLI call", file=sys.stderr)
    sys.exit(99)
reply = replies[len(calls)]
sys.stdout.write(reply.get("out", ""))
sys.stderr.write(reply.get("err", ""))
sys.exit(reply.get("code", 0))
""")
            fake.chmod(0o755)
            result = subprocess.run(
                ["/bin/bash", str(SCRIPTS / script), *args],
                env={"PATH": str(binary), "HOME": str(root / "home"),
                     "TMPDIR": str(root), "FAKE_ROOT": str(root)},
                capture_output=True, text=True, timeout=10,
            )
            log = root / "calls.jsonl"
            calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
            return result, calls

    def ask(self, replies, *args):
        return self.run_wrapper("notebook-ask.sh", ["nb", "question", *args], replies)

    def test_query_permanent_failure_is_not_retried_or_saved(self):
        for error in ("authentication expired", "quota exceeded", "no answer found"):
            with self.subTest(error=error):
                result, calls = self.ask(
                    [{"code": 7, "err": error}], "--save-as-note")
                self.assertEqual(result.returncode, 7)
                self.assertEqual(result.stdout, "")
                self.assertIn(error, result.stderr)
                self.assertEqual(calls, [["notebook", "query", "nb", "question"]])

    def test_query_partial_stdout_on_error_is_not_success(self):
        result, calls = self.ask([{"code": 4, "out": "partial", "err": "failed"}])
        self.assertEqual(result.returncode, 4)
        self.assertEqual(result.stdout, "")
        self.assertEqual(len(calls), 1)

    def test_query_stdout_diagnostics_move_to_stderr(self):
        for output, flags in (
            ("Error: Profile 'default' not found. Run 'nlm login' first.\n", []),
            ('{"status":"error","error":"quota exceeded"}\n', ["--json"]),
        ):
            for first_attempt in ([], [{}]):
                with self.subTest(output=output, retry=bool(first_attempt)):
                    result, calls = self.ask(
                        first_attempt + [{"code": 1, "out": output}],
                        *flags, "--save-as-note")
                    self.assertEqual(result.returncode, 1)
                    self.assertEqual(result.stdout, "")
                    self.assertIn(output.strip(), result.stderr)
                    self.assertEqual(calls, [
                        ["notebook", "query", "nb", "question", *flags],
                    ] * (len(first_attempt) + 1))

    def test_query_empty_success_retries_once(self):
        result, calls = self.ask([{"out": " \n"}, {"out": "answer\n"}])
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "answer\n")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], calls[1])

    def test_query_explicit_degradation_retries_once(self):
        result, calls = self.ask([
            {"out": "degraded", "err": "no marked answer"}, {"out": "answer"},
        ])
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "answer\n")
        self.assertEqual(len(calls), 2)

    def test_query_empty_or_degraded_after_retry_fails_without_note(self):
        for reply in ({}, {"out": "bad", "err": "no answer found"}):
            with self.subTest(reply=reply):
                result, calls = self.ask([{}, reply], "--save-as-note")
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertEqual(len(calls), 2)

    def test_query_retry_error_propagates_without_note(self):
        result, calls = self.ask([{}, {"code": 8, "err": "quota"}], "--save-as-note")
        self.assertEqual(result.returncode, 8)
        self.assertEqual(result.stdout, "")
        self.assertEqual(len(calls), 2)

    def test_query_success_preserves_interface_and_best_effort_note(self):
        for note_code in (0, 3):
            with self.subTest(note_code=note_code):
                result, calls = self.ask(
                    [{"out": '{"answer":"prose"}'}, {"code": note_code}],
                    "--json", "-s", "one", "-s", "two",
                    "--save-as-note", "--note-title", "Title",
                )
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, '{"answer":"prose"}\n')
                self.assertEqual(calls, [
                    ["notebook", "query", "nb", "question", "--json", "--source-ids", "one,two"],
                    ["note", "create", "nb", "--content", "prose", "--title", "Title"],
                ])

    def wait(self, replies, *args):
        return self.run_wrapper("notebook-research-wait.sh", ["nb", *args], replies)

    def test_wait_completed_imports_exact_task_and_arguments(self):
        for args, max_wait, import_flags in (
            ((), "900", []),
            (("--max-wait", "37", "--cited-only"), "37", ["--cited-only"]),
        ):
            with self.subTest(args=args):
                result, calls = self.wait([{"out": COMPLETED}, {}], *args)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertEqual(calls, [
                    ["research", "status", "nb", "--max-wait", max_wait, "--compact"],
                    ["research", "import", "nb", TASK_ID, *import_flags],
                ])

    def test_wait_noncompleted_never_imports(self):
        for status in ("running", "pending", "in_progress", "failed", "unknown", "no_research"):
            with self.subTest(status=status):
                if status == "no_research":
                    output = (
                        "\nResearch Status:\n  Status: no research found\n"
                        "\nStart a research task with 'nlm research start'.\n"
                    )
                else:
                    output = (
                        f"\nResearch Status:\n  Status: {status}\n"
                        f"  Task ID: {TASK_ID}\n  Sources found: 2\n"
                    )
                result, calls = self.wait([{"out": output}])
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(len(calls), 1)
                self.assertEqual(result.stdout, "")

    def test_wait_malformed_or_ambiguous_never_imports(self):
        for output in (
            "", "completed", '{"status":"completed","task_id":"task"}',
            COMPLETED.replace("Research Status:", "Something else:"),
            COMPLETED.replace(f"  Task ID: {TASK_ID}\n", ""),
            COMPLETED.replace(TASK_ID, "--option"),
            COMPLETED.replace("  Sources found: 2", "  Sources found: unknown"),
            COMPLETED + "  Status: running\n",
            COMPLETED + f"  Task ID: {TASK_ID}\n",
            COMPLETED + COMPLETED,
            COMPLETED.replace("  Status: completed", "  Status: not completed"),
        ):
            with self.subTest(output=output):
                result, calls = self.wait([{"out": output}])
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(len(calls), 1)

    def test_wait_status_error_propagates_even_with_completed_stdout(self):
        result, calls = self.wait([{"out": COMPLETED, "err": "auth failed", "code": 7}])
        self.assertEqual(result.returncode, 7)
        self.assertIn("auth failed", result.stderr)
        self.assertEqual(len(calls), 1)

    def test_wait_import_error_propagates_without_retry(self):
        result, calls = self.wait([{"out": COMPLETED}, {"code": 9, "err": "import failed"}])
        self.assertEqual(result.returncode, 9)
        self.assertIn("import failed", result.stderr)
        self.assertEqual(len(calls), 2)

    def test_wait_unknown_argument_never_calls_cli(self):
        result, calls = self.wait([], "--unknown")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
