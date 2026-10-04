"""design-lab:init: where runs live, the person's settings, and the machine checks."""
import argparse
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import lab_config  # noqa: E402
import lab_setup  # noqa: E402
import workflow  # noqa: E402


class Sandbox(unittest.TestCase):
    """A home folder, a configuration file and projects of their own, never the person's."""

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.home = self.root / "home"
        self.home.mkdir()
        self.config = self.root / "design-lab.json"
        patches = [mock.patch.dict(os.environ, {"DESIGN_LAB_CONFIG": str(self.config)}),
                   mock.patch.object(Path, "home", return_value=self.home)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def configure(self, **value):
        self.config.write_text(json.dumps(value))

    def repo(self, path):
        repo = self.root / path
        repo.mkdir(parents=True)
        (repo / ".git").write_text("gitdir: elsewhere\n")
        return repo


class ConventionTests(Sandbox):
    def test_project_folder_from_the_worktrees_layout(self):
        repo = self.repo("Sites/EXAMPLE/worktrees/main")
        (repo / "frontend").mkdir()
        self.assertEqual(lab_config.project_folder(repo / "frontend"), self.root / "Sites/EXAMPLE")
        self.assertEqual(lab_config.project_folder(self.root / "Sites/EXAMPLE"), self.root / "Sites/EXAMPLE")
        self.configure(runs={"convention": "project"})
        self.assertEqual(lab_config.runs_folder(repo), self.root / "Sites/EXAMPLE/design")

    def test_project_folder_from_a_folder_of_plans_above_a_plain_checkout(self):
        repo = self.repo("Work/PROJECT/code")
        (self.root / "Work/PROJECT/plans").mkdir()
        self.assertEqual(lab_config.project_folder(repo), self.root / "Work/PROJECT")

    def test_no_project_folder_is_said_plainly_and_home_needs_none(self):
        repo = self.repo("Work/plain")
        self.configure(runs={"convention": "project"})
        with self.assertRaises(ValueError) as raised:
            lab_config.runs_folder(repo)
        self.assertIn("home convention", str(raised.exception))
        self.configure(runs={"convention": "home"})
        self.assertEqual(lab_config.runs_folder(repo), self.home / ".design/plain")

    def test_without_setup_it_points_to_design_lab_init(self):
        with self.assertRaises(ValueError) as raised:
            lab_config.runs_folder(self.repo("Work/plain"))
        self.assertIn("design-lab:init", str(raised.exception))

    def test_runs_are_numbered_by_day_and_the_newest_is_found(self):
        repo = self.repo("Sites/EXAMPLE/worktrees/main")
        self.configure(runs={"convention": "project"})
        first = lab_config.next_run(repo, "2026-10-03")
        self.assertEqual(first.name, "2026-10-03")
        first.mkdir(parents=True)
        (first / "project.json").write_text(json.dumps({"createdAt": "2026-10-03T09:00:00+00:00"}))
        second = lab_config.next_run(repo, "2026-10-03")
        self.assertEqual(second.name, "2026-10-03-2")
        second.mkdir()
        (second / "project.json").write_text(json.dumps({"createdAt": "2026-10-03T15:00:00+00:00"}))
        self.assertEqual(lab_config.current_run(repo / "frontend" if (repo / "frontend").exists() else repo), second)


class WorkflowTests(Sandbox):
    def init(self, repo, **extra):
        args = argparse.Namespace(repo=str(repo), workspace=None, force=False, site_label=None, site_url=None,
                                  operator=None, model=None, **extra)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as err:
            workflow.init_command(args)
        return err.getvalue()

    def test_init_makes_the_run_folder_by_convention_with_the_operator_from_setup(self):
        repo = self.repo("Sites/EXAMPLE/worktrees/main")
        self.configure(runs={"convention": "project"}, operator="A. Person")
        said = self.init(repo)
        runs = lab_config.runs_in(self.root / "Sites/EXAMPLE/design")
        self.assertEqual(len(runs), 1)
        self.assertIn(str(runs[0]), said)
        project = json.loads((runs[0] / "project.json").read_text())
        self.assertEqual(project["run"]["operator"], "A. Person")
        self.assertFalse(str(runs[0]).startswith(str(repo)), "runs never live inside the repository")

    def test_watch_with_no_folder_shows_this_projects_newest_run(self):
        repo = self.repo("Sites/EXAMPLE/worktrees/main")
        self.configure(runs={"convention": "project"})
        self.init(repo)
        newest = lab_config.runs_in(self.root / "Sites/EXAMPLE/design")[-1]
        out = io.StringIO()
        with mock.patch.object(Path, "cwd", return_value=repo), contextlib.redirect_stdout(out):
            workflow.watch_command(argparse.Namespace(project=None))
        self.assertIn("design-lab ·", out.getvalue())
        self.assertEqual(lab_config.current_run(repo), newest)

    def test_reports_summarise_a_run_in_plain_lines(self):
        run = self.root / "run"
        (run / "capture").mkdir(parents=True)
        (run / "figma").mkdir()
        (run / "capture" / "capture-run.log").write_text("[1/2] a: complete in 1s\n[2/2] b: complete in 1s\n")
        (run / "capture" / "selector-check.json").write_text(json.dumps(
            [{"componentId": "a", "chosen": "/x"}, {"componentId": "b", "chosen": None, "pages": [{"path": "/y", "matches": 0, "visible": 0}]}]))
        (run / "plan.json").write_text(json.dumps({"plans": [{"verdict": "build"}, {"verdict": "refuse", "refuseReason": "schema-only"}]}))
        (run / "verify-report.json").write_text(json.dumps({"open": [{"severity": "blocker", "check": "c", "detail": "d"}]}))
        (run / "figma" / "state.json").write_text(json.dumps({"steps": [{"id": 1}, {"id": 2}], "done": [1]}))
        (run / "figma" / "runner.log").write_text("serving x\nFAILED x: broke\n")
        lines = {topic: "\n".join(workflow.report_lines(run, topic)) for topic in workflow.REPORT_TOPICS}
        self.assertIn("[2/2] b", lines["capture"])
        self.assertIn("1 without a visible match", lines["selectors"])
        self.assertIn("1 build", lines["plan"])
        self.assertIn("1 open finding(s): 1 blocker", lines["verify"])
        self.assertIn("1 of 2 recorded", lines["build"])
        self.assertIn("failures in the runner log: 1", lines["build"])


class SetupTests(Sandbox):
    def statuses(self):
        with mock.patch.object(lab_setup, "claude_version", return_value=(2, 1, 288)), \
                mock.patch.object(lab_setup, "playwright_ready", return_value=(False, "Playwright does not resolve")):
            return {c["id"]: c for c in lab_setup.checks()}

    def test_a_new_machine_needs_the_choices_and_the_tools(self):
        found = self.statuses()
        self.assertEqual((found["runs"]["status"], found["operator"]["status"], found["playwright"]["status"]),
                         ("missing", "missing", "missing"))
        self.assertIn("150 MB", found["playwright"]["needsApproval"])

    def test_settings_are_kept_when_others_are_written(self):
        self.configure(corpus="/c", scoreboard={"ledger": "/l", "dashboard": "/d"})
        lab_setup.set_value("runs", ["home"])
        lab_setup.set_value("operator", ["A. Person"])
        value = json.loads(self.config.read_text())
        self.assertEqual((value["runs"], value["operator"], value["corpus"]), ({"convention": "home"}, "A. Person", "/c"))
        found = self.statuses()
        self.assertEqual((found["runs"]["status"], found["operator"]["status"], found["evaluation"]["status"]),
                         ("ok", "ok", "ok"))

    def test_the_read_blocking_setting_is_found_and_removed_only_when_asked(self):
        claude = self.home / ".claude"
        claude.mkdir()
        settings = claude / "settings.json"
        settings.write_text(json.dumps({"permissions": {"defaultMode": "auto", lab_setup.READ_BLOCK: True}, "model": "opus"}))
        found = self.statuses()
        self.assertEqual(found["claude-settings"]["status"], "advice")
        self.assertIn("restarting", found["claude-settings"]["needsApproval"])
        self.assertTrue(json.loads(settings.read_text())["permissions"][lab_setup.READ_BLOCK], "checking changes nothing")
        result = lab_setup.allow_reads()
        self.assertEqual((result["restart"], json.loads(settings.read_text())),
                         (True, {"permissions": {"defaultMode": "auto"}, "model": "opus"}))

    def test_python_packages_install_into_the_user_folder_even_on_homebrew_python(self):
        done = subprocess.CompletedProcess([], 0, "", "")
        with mock.patch.object(lab_setup.importlib.util, "find_spec", return_value=None), \
                mock.patch.object(lab_setup, "externally_managed", return_value=True), \
                mock.patch.object(lab_setup, "run", return_value=done) as run:
            lab_setup.install_python()
        command = run.call_args.args[0]
        self.assertIn("--user", command)
        self.assertIn("--break-system-packages", command)

    def test_capture_uses_the_shared_playwright_or_says_how_to_get_one(self):
        import capture_all
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()) as err:
            capture_all.main(["--project", str(self.root), "--site-url", "http://x", "--canonical-base-url", "http://x",
                              "--theme-root", "t"])
        self.assertIn("design-lab:init", err.getvalue())


if __name__ == "__main__":
    unittest.main()
