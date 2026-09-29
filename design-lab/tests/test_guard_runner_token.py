import json
import subprocess
import sys
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parents[1] / "hooks" / "guard_runner_token.py"


def run(tool, tool_input):
    event = {"tool_name": tool, "tool_input": tool_input}
    return subprocess.run([sys.executable, str(HOOK)], input=json.dumps(event),
                          capture_output=True, text=True)


class GuardRunnerTokenTest(unittest.TestCase):
    def test_blocks_every_way_of_reaching_the_token(self):
        for tool, tool_input in [
            ("Read", {"file_path": "/Users/someone/.design-lab/runner-token"}),
            ("Bash", {"command": "pbcopy < ~/.design-lab/runner-token"}),
            ("Bash", {"command": "cat ~/.design-lab/runner-token | pbcopy"}),
            ("Bash", {"command": "cat ~/.design-lab/*"}),
            ("Bash", {"command": "grep -r . ~/.design-lab"}),
            ("Bash", {"command": "cat \"$HOME/.design-lab/runner-t\"oken"}),
            ("Grep", {"pattern": "x", "path": "/Users/someone/.design-lab"}),
            ("Glob", {"pattern": "**/*", "path": "/Users/someone/.design-lab/"}),
            ("Write", {"file_path": "/Users/someone/.design-lab/runner-token", "content": "x"}),
            ("Edit", {"file_path": "/Users/someone/.design-lab/runner-token"}),
        ]:
            with self.subTest(tool=tool, tool_input=tool_input):
                result = run(tool, tool_input)
                self.assertEqual(result.returncode, 2)
                self.assertIn("pbcopy < ~/.design-lab/runner-token", result.stderr)

    def test_allows_the_runner_plugin_and_everything_else(self):
        for tool, tool_input in [
            ("Read", {"file_path": "/Users/someone/.design-lab/runner/manifest.json"}),
            ("Bash", {"command": "ls ~/.design-lab/runner"}),
            ("Bash", {"command": "python3 scripts/workflow.py preflight --project W"}),
            ("Read", {"file_path": "/repo/design-lab/skills/run/SKILL.md"}),
            ("Grep", {"pattern": "runner-token", "path": "/repo/design-lab"}),
        ]:
            with self.subTest(tool=tool, tool_input=tool_input):
                self.assertEqual(run(tool, tool_input).returncode, 0)


if __name__ == "__main__":
    unittest.main()
