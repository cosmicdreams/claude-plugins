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
        import figma_runner
        patches = [mock.patch.dict(os.environ, {"DESIGN_LAB_CONFIG": str(self.config),
                                                "DESIGN_LAB_CACHE": str(self.root / "cache")}),
                   mock.patch.object(Path, "home", return_value=self.home),
                   mock.patch.object(figma_runner, "HOME", self.home / ".design-lab")]
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
        self.assertTrue(first.is_dir(), "the folder is taken when it is chosen, so no other run can take it")
        (first / "project.json").write_text(json.dumps({"createdAt": "2026-10-03T09:00:00+00:00"}))
        second = lab_config.next_run(repo, "2026-10-03")
        self.assertEqual(second.name, "2026-10-03-2")
        (second / "project.json").write_text(json.dumps({"createdAt": "2026-10-03T15:00:00+00:00"}))
        self.assertEqual(lab_config.current_run(repo), (second, self.root / "Sites/EXAMPLE/design"))


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
        self.assertEqual(lab_config.current_run(repo)[0], newest)

    def test_reports_summarise_a_run_in_plain_lines(self):
        run = self.root / "run"
        (run / "capture").mkdir(parents=True)
        (run / "figma").mkdir()
        for name in ("configs", "records"):
            (run / "capture" / name).mkdir()
        for cid, status in (("a", "complete"), ("b", "failed")):
            (run / "capture" / "configs" / f"{cid}.json").write_text("{}")
            (run / "capture" / "records" / f"{cid}.json").write_text(json.dumps(
                {"componentId": cid, "status": status, "problems": ["no visible match"] if status == "failed" else []}))
        (run / "capture" / "selector-check.json").write_text(json.dumps(
            [{"componentId": "a", "chosen": "/x"}, {"componentId": "b", "chosen": None, "pages": [{"path": "/y", "matches": 0, "visible": 0}]}]))
        (run / "plan.json").write_text(json.dumps({"plans": [{"verdict": "build"}, {"verdict": "refuse", "refuseReason": "schema-only"}]}))
        (run / "verify-report.json").write_text(json.dumps({"open": [{"severity": "blocker", "check": "c", "detail": "d"}]}))
        (run / "figma" / "state.json").write_text(json.dumps({"steps": [{"id": 1}, {"id": 2}], "done": [1]}))
        (run / "figma" / "runner.log").write_text("serving x\nFAILED x: broke\n")
        lines = {topic: "\n".join(workflow.report_lines(run, topic)) for topic in workflow.REPORT_TOPICS}
        self.assertIn("2 of 2 component(s) captured: 1 complete, 1 failed", lines["capture"])
        self.assertIn("b: failed - no visible match", lines["capture"])
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
        self.assertIn("ms-playwright", found["playwright"]["needsApproval"], "it says where the browser really goes")

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
        self.assertEqual(found["claude-settings"]["status"], "missing", "runs cannot go unattended until it is settled")
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


class AllowFoldersTests(Sandbox):
    def test_allowing_design_labs_folders_keeps_the_setting_and_ends_the_need_to_approve(self):
        claude = self.home / ".claude"
        (claude / "plugins/cache/local/design-lab/0.19.0").mkdir(parents=True)
        real = self.root / "real-settings.json"
        real.write_text(json.dumps({"permissions": {lab_setup.READ_BLOCK: True}}))
        (claude / "settings.json").symlink_to(real)      # one account's settings link to another's
        self.configure(runs={"convention": "project"})
        with mock.patch.object(lab_setup, "claude_version", return_value=(2, 1, 288)), \
                mock.patch.object(lab_setup, "playwright_ready", return_value=(True, "/chromium")):
            before = {c["id"]: c for c in lab_setup.checks()}["claude-settings"]
            self.assertEqual(before["status"], "missing")
            self.assertIn("the folders you keep projects in", before["detail"])
            result = lab_setup.allow_folders([str(self.root / "Sites")])
            after = {c["id"]: c for c in lab_setup.checks()}["claude-settings"]
        self.assertTrue(result["restart"])
        self.assertEqual(after["status"], "ok")
        value = json.loads(real.read_text())
        self.assertTrue(value["permissions"][lab_setup.READ_BLOCK], "the setting stays on")
        allowed = value["permissions"]["additionalDirectories"]
        self.assertIn(str((claude / "plugins/cache/local/design-lab").resolve()), allowed)
        self.assertIn(str((self.root / "Sites").resolve()), allowed)
        self.assertTrue((claude / "settings.json").is_symlink(), "the link is kept; its target is updated")
        self.assertEqual(lab_setup.allow_folders([])["changed"], [], "running it again changes nothing")


class ReviewTests(Sandbox):
    def test_runs_never_land_inside_a_working_copy(self):
        repo = self.repo("Sites/EXAMPLE/worktrees/main")
        (repo / "design").mkdir()
        (self.root / "Sites/EXAMPLE/design").symlink_to(repo / "design")   # the runs folder leads into the checkout
        self.configure(runs={"convention": "project"})
        with self.assertRaises(ValueError) as raised:
            lab_config.next_run(repo, "2026-10-03")
        self.assertIn("inside the working copy", str(raised.exception))
        args = argparse.Namespace(repo=str(repo), workspace=str(repo / "runs/one"), force=False, site_label=None,
                                  site_url=None, operator=None, model=None)
        with self.assertRaises(ValueError), contextlib.redirect_stderr(io.StringIO()):
            workflow.init_command(args)

    def test_two_runs_started_at_once_get_two_folders(self):
        repo = self.repo("Sites/EXAMPLE/worktrees/main")
        self.configure(runs={"convention": "project"})
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(8) as pool:
            folders = list(pool.map(lambda _: lab_config.next_run(repo, "2026-10-03"), range(8)))
        self.assertEqual(len(set(folders)), 8)

    def test_an_empty_runs_folder_is_this_projects_not_the_pointers(self):
        repo = self.repo("Sites/EXAMPLE/worktrees/main")
        (self.root / "Sites/EXAMPLE/design").mkdir()
        self.configure(runs={"convention": "project"})
        with mock.patch.object(workflow, "active_run", return_value=self.root / "OTHER/run"), \
                mock.patch.object(Path, "cwd", return_value=repo), self.assertRaises(ValueError) as raised:
            workflow.watch_command(argparse.Namespace(project=None))
        self.assertIn("no design-lab run yet in", str(raised.exception))

    def test_runs_that_began_in_the_same_second_are_ordered_by_name(self):
        folder = self.root / "design"
        for name in ("2026-10-03-2", "2026-10-03"):
            (folder / name).mkdir(parents=True)
            (folder / name / "project.json").write_text(json.dumps({"createdAt": "2026-10-03T09:00:00+00:00"}))
        self.assertEqual([r.name for r in lab_config.runs_in(folder)], ["2026-10-03", "2026-10-03-2"])

    def test_capture_finds_the_shared_playwright_even_when_setup_did_not_record_it(self):
        import capture_all
        (lab_setup.playwright_folder() / "node_modules" / "playwright").mkdir(parents=True)
        with mock.patch.object(capture_all, "run_capture", create=True), \
                contextlib.redirect_stderr(io.StringIO()) as err, contextlib.redirect_stdout(io.StringIO()):
            try:
                capture_all.main(["--project", str(self.root / "nowhere"), "--site-url", "http://x",
                                  "--canonical-base-url", "http://x", "--theme-root", "t"])
            except (SystemExit, Exception):
                pass
        self.assertNotIn("--node-cwd is needed", err.getvalue())
