"""Rebuild saved captures in this project's runs folder, then verify and benchmark."""
import contextlib
import io
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import corpus
import figma_build
import figma_runner
import lab_config
import lab_setup
import rebuild
import score_report
import score_run
import workflow
from artifact_contracts import now, write_json


class Sandbox(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.home = self.root / "home"
        self.home.mkdir()
        self.config = self.root / "config.json"
        self.repo = self.root / "PROJECT/worktrees/main"
        self.repo.mkdir(parents=True)
        subprocess.run(["git", "init", "--initial-branch=main", str(self.repo)],
                       capture_output=True, check=True)
        write_json(self.config, {"runs": {"convention": "project"}, "operator": "A. Person",
                                 "corpus": str(self.root / "corpus"), "scoreboard": {
                                     "ledger": str(self.root / "ledger.jsonl"),
                                     "dashboard": str(self.root / "dashboard.html")}})
        patches = [mock.patch.dict(os.environ, {"DESIGN_LAB_CONFIG": str(self.config),
                                                "DESIGN_LAB_HOME": str(self.home / ".design-lab")}),
                   mock.patch.object(Path, "home", return_value=self.home),
                   mock.patch.object(figma_runner, "HOME", self.home / ".design-lab")]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.source = self.root / "old run"
        self.workspace = self.root / "new run"
        self.project = {"schemaVersion": 1, "standardVersion": workflow.standard_version(),
                        "pluginVersion": "0.16.0", "createdAt": "2026-01-01T09:00:00+00:00",
                        "repository": {"root": str(self.repo), "commit": None, "dirty": False},
                        "run": {"siteLabel": "Saved site"},
                        "target": {"figmaFileKey": "OLD", "figmaUrl": "https://www.figma.com/design/OLD"},
                        "decisions": {}, "phases": {
                            name: {"status": "approved" if name == "plan" else "complete",
                                   "updatedAt": "2026-01-01T10:00:00+00:00"}
                            for name in ("discovery", "inventory", "usage", "capture", "tokens", "plan",
                                         "preflight", "foundation", "components", "index", "verify", "connect", "benchmark")},
                        "artifacts": {"inventory": {"kind": "components", "path": "components.json"},
                                      **{kind: {"kind": kind, "path": "stale.json"}
                                         for kind in ("build-record", "foundation", "index", "verify-report")}}}
        write_json(self.source / "project.json", self.project)
        write_json(self.source / "components.json", {"components": []})
        write_json(self.source / "plan.json", {"plans": []})
        write_json(self.source / "tokens.json", {})
        write_json(self.source / "capture-evidence.json", {"canonicalBaseUrl": "https://saved.invalid",
                   "captures": {}, "paths": [str(self.source / "capture/shots/saved.png")]})
        write_json(self.source / "capture/measurements/spec.json", {"measurements": {}})
        write_json(self.source / "fonts.json", {"saved": True})
        write_json(self.source / "figma/images/images.json", {"file": str(self.source / "figma/images/saved.png")})
        (self.source / "figma/images/saved.png").write_bytes(b"saved image")
        (self.source / "capture/shots").mkdir()
        (self.source / "capture/shots/saved.png").write_bytes(b"saved capture")
        for name in ("benchmark/scorecard.json", "builds/card.json", "figma/results/build.json",
                     "figma/verify/state.json", "figma/dump/page.json", "figma/trees/card.json",
                     "verify-report.json", "preflight-checks.json", "replays/old/project.json"):
            write_json(self.source / name, {"old": True})
        write_json(self.source / "figma/state.json", {"fileKey": "OLD", "siteUrl": "http://localhost:1234",
                                                    "canonicalBaseUrl": "https://canonical.invalid"})
        (self.source / "phase-log.jsonl").write_text('{"phase":"capture","at":"2026-01-01T09:00:00+00:00"}\n')
        self.identity = {"startedAt": now(), "operator": "A. Person", "siteLabel": None,
                         "plugin": workflow.plugin_source(), "claude": {"model": "example"}}

    def prepare(self, **extra):
        return rebuild.prepare(self.source, self.workspace, "NEW", "https://www.figma.com/design/NEW",
                               identity=self.identity, **extra)

    def cli(self, *extra):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            workflow.main(["figma-build", "--from", str(self.source), "--repo", str(self.repo),
                           "--figma-url", "https://www.figma.com/design/NEW/Library", *extra])
        return json.loads(out.getvalue()), err.getvalue()


class PrepareTests(Sandbox):
    def test_manifest_is_published_last_and_is_never_copied(self):
        writes = []
        def writing(path, value):
            if Path(path).name != "project.json":
                self.assertFalse((self.workspace / "project.json").exists())
            writes.append(Path(path).relative_to(self.workspace))
            return write_json(path, value)
        with mock.patch.object(rebuild, "write_json", side_effect=writing):
            self.prepare()
        self.assertEqual(writes[-2:], [Path("figma/state.json"), Path("project.json")])

    def test_relocation_failure_never_exposes_source_manifest(self):
        def broken(*args):
            self.assertTrue((self.workspace / "components.json").exists())
            self.assertFalse((self.workspace / "project.json").exists())
            raise ValueError("relocation failed")
        with mock.patch.object(rebuild, "relocate", side_effect=broken), \
             self.assertRaisesRegex(ValueError, "relocation failed"):
            self.prepare()
        self.assertFalse((self.workspace / "project.json").exists())

    def test_copy_relocates_inputs_and_skips_old_build_output_before_copying(self):
        before = {str(p.relative_to(self.source)): p.read_bytes() for p in self.source.rglob("*") if p.is_file()}
        copied = []
        copy = shutil.copytree

        def copying(source, destination, *args, **kwargs):
            if args:
                return copy(source, destination, *args, **kwargs)
            def copy_file(src, dst):
                copied.append(str(Path(src).relative_to(self.source)))
                return shutil.copy2(src, dst)
            return copy(source, destination, copy_function=copy_file, **kwargs)

        with mock.patch.object(rebuild.shutil, "copytree", side_effect=copying):
            result = self.prepare()
        self.assertEqual(before, {str(p.relative_to(self.source)): p.read_bytes() for p in self.source.rglob("*") if p.is_file()})
        for path in copied:
            self.assertFalse(path.startswith(("benchmark/", "builds/", "replays/")), path)
            self.assertFalse(path.startswith("figma/") and not path.startswith("figma/images/"), path)
            self.assertNotIn(path, ("project.json", "phase-log.jsonl", "verify-report.json", "preflight-checks.json"))
        self.assertEqual((self.workspace / "figma/images/saved.png").read_bytes(), b"saved image")
        self.assertEqual((self.workspace / "capture/shots/saved.png").read_bytes(), b"saved capture")
        self.assertEqual(json.loads((self.workspace / "fonts.json").read_text()), {"saved": True})
        evidence = json.loads((self.workspace / "capture-evidence.json").read_text())
        self.assertEqual(evidence["paths"], [str(self.workspace / "capture/shots/saved.png")])
        project = json.loads((self.workspace / "project.json").read_text())
        self.assertEqual(project["target"], {"figmaFileKey": "NEW", "figmaUrl": result["figmaUrl"]})
        self.assertNotEqual(project["createdAt"], self.project["createdAt"])
        self.assertEqual(project["pluginVersion"], workflow.plugin_version())
        self.assertEqual(project["artifacts"], {"inventory": self.project["artifacts"]["inventory"]})
        self.assertEqual(project["run"]["operator"], "A. Person")
        self.assertEqual(project["run"]["siteLabel"], "Saved site")
        self.assertEqual(project["run"]["evaluationTier"], 2)
        self.assertEqual(project["run"]["rebuiltFrom"], {"run": str(self.source),
                         "createdAt": self.project["createdAt"], "pluginVersion": "0.16.0", "corpusLabel": None})
        for name in ("discovery", "inventory", "usage", "capture", "tokens", "plan", "preflight"):
            original = self.project["phases"][name]
            self.assertEqual(project["phases"][name], {"status": original["status"], "from": str(self.source),
                                                     "sourceUpdatedAt": original["updatedAt"]})
        for name in ("foundation", "components", "index", "verify"):
            self.assertEqual(project["phases"][name], {"status": "pending"})
        self.assertNotIn("connect", project["phases"])
        self.assertNotIn("benchmark", project["phases"])
        self.assertEqual(json.loads((self.workspace / "figma/state.json").read_text()), {"fileKey": "NEW"})
        self.assertEqual((result["siteUrl"], result["canonicalBaseUrl"]),
                         ("http://localhost:1234", "https://canonical.invalid"))

    def test_corpus_paths_and_label_are_kept_without_copying_the_manifest(self):
        corpus.freeze(self.source, "Corpus label")
        site = self.root / "corpus/Corpus label"
        project = json.loads((site / "project.json").read_text())
        project["run"].pop("siteLabel")
        write_json(site / "project.json", project)
        result = rebuild.prepare(site, self.workspace, "NEW", "https://www.figma.com/design/NEW",
                                 identity=self.identity)
        project = json.loads((self.workspace / "project.json").read_text())
        self.assertEqual(project["run"]["siteLabel"], "Corpus label")
        self.assertEqual(result["rebuiltFrom"]["corpusLabel"], "Corpus label")
        self.assertFalse((self.workspace / "corpus.json").exists())
        self.assertEqual(json.loads((self.workspace / "capture-evidence.json").read_text())["paths"],
                         [str(self.workspace / "capture/shots/saved.png")])

    def test_same_file_is_refused_before_copying(self):
        with self.assertRaisesRegex(ValueError, "must differ"):
            rebuild.prepare(self.source, self.workspace, "OLD", "https://www.figma.com/design/OLD",
                            identity=self.identity)
        self.assertFalse(self.workspace.exists())

    def test_unapproved_plan_is_refused(self):
        self.project["phases"]["plan"]["status"] = "pending"
        self.project["phases"]["benchmark"]["status"] = "pending"
        write_json(self.source / "project.json", self.project)
        with self.assertRaisesRegex(ValueError, "approve the plan"):
            self.prepare()
        self.assertFalse(self.workspace.exists())

    def test_an_approval_the_phase_log_kept_or_a_scored_build_counts(self):
        # A recapture sets the plan phase back; the approval it rested on is still in the log.
        self.project["phases"]["plan"]["status"] = "pending"
        write_json(self.source / "project.json", self.project)
        (self.source / "phase-log.jsonl").write_text(json.dumps({"phase": "plan", "status": "approved"}) + "\n")
        self.prepare()
        project = json.loads((self.workspace / "project.json").read_text())
        self.assertEqual("approved", project["phases"]["plan"]["status"])
        self.assertEqual(str(self.source.resolve()), project["phases"]["plan"]["from"])

    def test_a_plan_already_built_and_scored_counts_as_approved(self):
        self.project["phases"]["plan"]["status"] = "pending"
        self.project["phases"]["benchmark"] = {"status": "complete"}
        write_json(self.source / "project.json", self.project)
        self.prepare()
        self.assertTrue((self.workspace / "project.json").is_file())

    def test_each_required_input_is_checked(self):
        for name in ("components.json", "plan.json", "tokens.json", "capture-evidence.json", "capture/measurements"):
            path = self.source / name
            moved = self.root / "held"
            path.rename(moved)
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, name):
                self.prepare()
            moved.rename(path)
        self.assertFalse(self.workspace.exists())

    def test_nested_or_used_workspaces_are_refused(self):
        for workspace in (self.source, self.source / "nested", self.source / "replays/new"):
            with self.subTest(workspace=workspace), self.assertRaisesRegex(ValueError, "outside"):
                rebuild.prepare(self.source, workspace, "NEW", "https://www.figma.com/design/NEW",
                                identity=self.identity)
        self.workspace.mkdir()
        (self.workspace / "keep").write_text("someone else's work")
        with self.assertRaisesRegex(ValueError, "new or empty"):
            self.prepare()
        self.assertEqual((self.workspace / "keep").read_text(), "someone else's work")

    def test_site_addresses_fall_back_to_capture_and_missing_is_plain(self):
        (self.source / "figma/state.json").unlink()
        self.assertEqual(rebuild.site_urls(self.source), ("https://saved.invalid", "https://saved.invalid"))
        write_json(self.source / "capture-evidence.json", {})
        with self.assertRaisesRegex(ValueError, "missing saved siteUrl or canonicalBaseUrl"):
            rebuild.site_urls(self.source)


class WaitTests(Sandbox):
    def setUp(self):
        super().setUp()
        self.prepare()
        self.incomplete = subprocess.CompletedProcess([], 0, json.dumps({"done": 1, "total": 2, "next": "build:card"}))
        self.complete = subprocess.CompletedProcess([], 0, json.dumps({"done": 2, "total": 2, "next": None}))

    def test_figma_error_publishes_latch_and_a_new_server_resumes_failed_step(self):
        write_json(self.workspace / "figma/state.json", {"fileKey": "NEW", "steps": [{"id": "pages"}, {"id": "variables"}],
                                                        "done": ["pages"]})
        build = figma_runner.Build(self.workspace)
        handler_type = figma_runner.make_handler({"NEW": build}, "test-token")
        handler = object.__new__(handler_type)
        body = json.dumps({"step": "variables", "message": "font missing"}).encode()
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body)
        handler.reply = mock.Mock()
        with contextlib.redirect_stdout(io.StringIO()):
            handler.serve(build, "POST", mock.Mock(path="/error"), {})
        self.assertEqual(build.progress["state"], "failed")
        self.assertEqual(build.progress["message"], "font missing")
        self.assertEqual(build.failed["step"], "variables")
        self.assertEqual(build.next()["kind"], "wait")
        resumed = figma_runner.Build(self.workspace)
        payload = self.workspace / "figma/variables.js"
        payload.write_text("// variables payload")
        step = {"kind": "use_figma", "step": "variables", "done": 1, "total": 2, "payload": str(payload)}
        with mock.patch.object(resumed, "driver", return_value=step), contextlib.redirect_stdout(io.StringIO()):
            result = resumed.next()
        self.assertEqual((result["step"], result["done"], result["code"]), ("variables", 1, payload.read_text()))
        self.assertIsNone(resumed.failed)

    def test_server_exception_is_structured_and_recovery_clears_it(self):
        build = figma_runner.Build(self.workspace)
        handler_type = figma_runner.make_handler({"NEW": build}, "test-token")
        handler = object.__new__(handler_type)
        handler.reply = mock.Mock()
        with mock.patch.object(build, "next", side_effect=RuntimeError("server exception")), \
             contextlib.redirect_stdout(io.StringIO()):
            handler.serve(build, "GET", mock.Mock(path="/next"), {})
        self.assertEqual(build.progress["state"], "failed")
        self.assertEqual(build.progress["message"], "server exception")
        build.note({"kind": "use_figma", "step": "variables", "done": 1, "total": 2})
        self.assertEqual(build.progress["state"], "building")
        self.assertIsNone(build.progress["message"])

    def test_current_figma_and_server_failures_are_prompt(self):
        for event in ("FAILED missing font", "error: server exception"):
            log = self.workspace / "figma/runner.log"
            log.write_text("")
            def report(*args):
                log.write_text("2026-10-05T09:00:00 " + event + "\n")
                return self.incomplete
            with self.subTest(event=event), mock.patch.object(rebuild, "command", side_effect=report), \
                 mock.patch.object(rebuild.time, "sleep") as sleep, \
                 contextlib.redirect_stderr(io.StringIO()), self.assertRaisesRegex(RuntimeError, event):
                rebuild.wait_for_build(self.workspace, 1)
            sleep.assert_not_called()

    def test_historical_failure_does_not_stop_resumed_wait(self):
        (self.workspace / "figma/runner.log").write_text("2026-01-01T09:00:00 error: historical error\n"
                                                       "2026-01-01T09:00:01 FAILED old failure\n")
        write_json(self.workspace / "figma/progress.json", {"state": "building", "stepsDone": 1})
        with mock.patch.object(rebuild, "command", side_effect=[self.incomplete, self.complete]), \
             mock.patch.object(figma_runner.Build, "dump_step", return_value=None), \
             mock.patch.object(rebuild.time, "sleep") as sleep, contextlib.redirect_stderr(io.StringIO()):
            rebuild.wait_for_build(self.workspace, 1)
        sleep.assert_called_once()

    def test_new_failure_followed_by_recorded_progress_is_recovered(self):
        calls = 0
        def progress(*args):
            nonlocal calls
            calls += 1
            if calls > 1:
                return self.complete
            (self.workspace / "figma/runner.log").write_text("2026-10-05T09:00:00 error: recovered\n"
                                                           "2026-10-05T09:00:01 recorded build:card (1 remaining)\n")
            return self.incomplete
        with mock.patch.object(rebuild, "command", side_effect=progress), \
             mock.patch.object(figma_runner.Build, "dump_step", return_value=None), \
             mock.patch.object(rebuild.time, "sleep"), contextlib.redirect_stderr(io.StringIO()):
            rebuild.wait_for_build(self.workspace, 1)

    def test_existing_latch_in_structured_progress_fails_even_before_wait(self):
        for state, message in (("failed", "font failed"), ("waiting", "Stopped at variables. Waiting for a fix.")):
            write_json(self.workspace / "figma/progress.json", {"state": state, "message": message})
            with self.subTest(state=state), mock.patch.object(rebuild, "command", return_value=self.incomplete), \
                 contextlib.redirect_stderr(io.StringIO()), self.assertRaisesRegex(RuntimeError, message):
                rebuild.wait_for_build(self.workspace, 1)

    def test_failed_heartbeat_from_previous_server_is_ignored(self):
        write_json(self.workspace / "figma/progress.json", {"state": "failed", "message": "old latch", "serverPid": 1})
        (self.workspace / "figma" / figma_runner.PID_FILE).write_text("2\n")
        with mock.patch.object(rebuild, "command", side_effect=[self.incomplete, self.complete]), \
             mock.patch.object(figma_runner.Build, "dump_step", return_value=None), \
             mock.patch.object(rebuild.time, "sleep"), contextlib.redirect_stderr(io.StringIO()):
            rebuild.wait_for_build(self.workspace, 1)


class WorkflowTests(Sandbox):
    def setUp(self):
        super().setUp()
        # Waiter unit tests never start a real detached server.
        for name in ("ensure_server", "stop_server"):
            patch = mock.patch.object(figma_runner, name, return_value={})
            setattr(self, "ensure" if name == "ensure_server" else "stop", patch.start())
            self.addCleanup(patch.stop)

    def test_failed_prepare_removes_allocated_run_or_empties_given_workspace(self):
        for given in (False, True):
            if given:
                self.workspace.mkdir()
            extra = ("--workspace", str(self.workspace)) if given else ()
            with self.subTest(given=given), mock.patch.object(rebuild, "relocate", side_effect=ValueError("mid-copy")), \
                 self.assertRaises(SystemExit) as raised:
                self.cli(*extra)
            self.assertEqual(raised.exception.code, 2)
            if given:
                self.assertEqual(list(self.workspace.iterdir()), [])
            else:
                self.assertEqual(list((self.root / "PROJECT/design").iterdir()), [])

    def test_failed_initial_log_also_cleans_prepared_workspace(self):
        with mock.patch.object(workflow, "append_jsonl", side_effect=OSError("log write failed")), \
             self.assertRaises(SystemExit):
            self.cli()
        self.assertEqual(list((self.root / "PROJECT/design").iterdir()), [])

    def test_used_explicit_workspace_is_preserved_on_refusal(self):
        self.workspace.mkdir()
        (self.workspace / "keep").write_text("existing work")
        with self.assertRaises(SystemExit):
            self.cli("--workspace", str(self.workspace))
        self.assertEqual((self.workspace / "keep").read_text(), "existing work")

    def test_await_stops_server_before_logging_and_ensures_again_on_retry(self):
        self.prepare()
        calls = []
        original = workflow.append_jsonl
        def logging(*args):
            calls.append("log")
            return original(*args)
        self.ensure.side_effect = lambda *args: calls.append("ensure")
        self.stop.side_effect = lambda *args: calls.append("stop")
        with mock.patch.object(rebuild, "wait_for_build", side_effect=RuntimeError("failed step")), \
             mock.patch.object(workflow, "append_jsonl", side_effect=logging), \
             contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            workflow.main(["await-build", "--project", str(self.workspace)])
        with mock.patch.object(rebuild, "wait_for_build"):
            workflow.main(["await-build", "--project", str(self.workspace)])
        self.assertEqual(calls, ["ensure", "stop", "log", "ensure"])

    def test_watch_uses_this_runs_time_for_copied_preflight(self):
        self.prepare()
        project = json.loads((self.workspace / "project.json").read_text())
        # Handle older prepared manifests which still have both provenance and updatedAt.
        project["phases"]["preflight"]["updatedAt"] = self.project["phases"]["preflight"]["updatedAt"]
        write_json(self.workspace / "project.json", project)
        with mock.patch.object(workflow, "seconds_since", side_effect=lambda at: 61 if at == project["createdAt"] else 999999):
            summary = workflow.watch_summary(self.workspace)
        self.assertEqual(summary["startedAt"], project["createdAt"])
        self.assertEqual(summary["elapsedSeconds"], 61)
        self.assertIn("Elapsed: 1m", workflow.render_watch(summary))

    def test_runs_lists_newest_first_and_filters_using_current_recap(self):
        folder = self.root / "PROJECT/design"
        for name, stamp, card, complete in (
            ("old", "2026-01-01", None, True),
            ("finished", "2026-02-01", "2026-02-01", False),
            ("abandoned", "2026-03-01", "2026-01-01", True),
            ("new", "2026-04-01", None, False),
        ):
            write_json(folder / name / "project.json", {"createdAt": stamp, "run": {"siteLabel": "Saved site"},
                       "phases": {"benchmark": {"status": "complete" if complete else "pending"}}})
            (folder / name / "benchmark").mkdir()
            (folder / name / "benchmark/completion.md").write_text("done")
            if card:
                write_json(folder / name / "benchmark/scorecard.json", {"run": {"buildCreatedAt": card}})
        for cwd in (self.repo, self.root / "PROJECT"):
            out = io.StringIO()
            with mock.patch.object(workflow.Path, "cwd", return_value=cwd), contextlib.redirect_stdout(out):
                workflow.main(["runs", "--json"])
            rows = json.loads(out.getvalue())
            self.assertEqual([Path(row["folder"]).name for row in rows], ["new", "abandoned", "finished", "old"])
            self.assertEqual([row["finished"] for row in rows], [False, False, True, True])
            out = io.StringIO()
            with mock.patch.object(workflow.Path, "cwd", return_value=cwd), contextlib.redirect_stdout(out):
                workflow.main(["runs", "--finished"])
            lines = out.getvalue().splitlines()
            self.assertEqual(len(lines), 2)
            self.assertTrue(lines[0].startswith(str(folder / "finished")))
            self.assertIn("\tSaved site\t2026-02-01\tfinished", lines[0])

    def test_runs_exits_one_with_plain_message_when_empty(self):
        (self.root / "PROJECT/design").mkdir()
        for flags in ([], ["--finished", "--json"]):
            err = io.StringIO()
            with mock.patch.object(workflow.Path, "cwd", return_value=self.repo), \
                 contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as raised:
                workflow.main(["runs", *flags])
            self.assertEqual(raised.exception.code, 1)
            self.assertTrue(err.getvalue().startswith("No "))


    def test_cli_uses_project_convention_and_prints_runnable_commands_in_order(self):
        result, err = self.cli("--model", "claude-example")
        workspace = Path(result["workspace"])
        self.assertEqual(workspace.parent, self.root / "PROJECT/design")
        self.assertEqual(workspace.name, now()[:10])
        self.assertIn(f"design-lab run folder: {workspace}", err)
        project = json.loads((workspace / "project.json").read_text())
        self.assertEqual(project["run"]["claude"]["model"], "claude-example")
        self.assertEqual(project["run"]["operator"], "A. Person")
        log = [json.loads(line) for line in (workspace / workflow.PHASE_LOG).read_text().splitlines()]
        self.assertEqual(len(log), 1)
        self.assertEqual((log[0]["phase"], log[0]["status"]), ("init", "complete"))
        self.assertEqual(log[0]["rebuiltFrom"], result["rebuiltFrom"])
        pointer = json.loads((figma_runner.HOME / workflow.ACTIVE_RUN).read_text())
        self.assertEqual(pointer["workspace"], str(workspace))
        commands = [shlex.split(command) for command in result["next"]]
        self.assertEqual([command[2] for command in commands], ["connect", "init", "await-build", "finish"])
        for command in commands:
            self.assertTrue(Path(command[0]).is_absolute())
            self.assertTrue(Path(command[1]).is_absolute())
            self.assertEqual(command[command.index("--project") + 1], str(workspace))
        self.assertIn("--offline-images", commands[1])
        self.assertNotIn("--rebuild", commands[1])
        self.assertNotIn("--iterate", commands[1])
        self.assertEqual(commands[-1][-2:], ["--session", "current"])
        self.assertEqual(self.cli()[0]["workspace"], str(workspace) + "-2")

    def test_explicit_workspace_and_label(self):
        result, _ = self.cli("--workspace", str(self.workspace), "--site-label", "Another label")
        self.assertEqual(result["workspace"], str(self.workspace))
        self.assertEqual(json.loads((self.workspace / "project.json").read_text())["run"]["siteLabel"], "Another label")

    def test_cli_refuses_workspace_in_repository_and_bad_url(self):
        for extra in (("--workspace", str(self.repo / "design")), ("--figma-url", "invalid")):
            with self.subTest(extra=extra), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
                self.cli(*extra)
            self.assertEqual(raised.exception.code, 2)
        self.assertFalse((self.repo / "design").exists())

    def test_seeded_state_still_connects_as_an_empty_file(self):
        self.prepare()
        with mock.patch.object(figma_runner, "install_runner", return_value={"firstInstall": False, "updated": False}), \
             mock.patch.object(figma_runner, "ensure_server", return_value={}), \
             mock.patch.object(figma_runner, "request_handshake") as request, \
             mock.patch.object(figma_runner, "wait_for_handshake", return_value={"ok": True}), \
             contextlib.redirect_stderr(io.StringIO()):
            workflow.runner_handshake(self.workspace, "NEW", "https://www.figma.com/design/NEW", 1,
                                      json.loads((self.workspace / "project.json").read_text()))
        self.assertFalse(request.call_args.kwargs["connection_only"])

    def test_runner_waits_on_seeded_state_until_init_and_preserves_the_target_key(self):
        self.prepare()
        build = figma_runner.Build(self.workspace)
        with mock.patch.object(build, "driver") as driver:
            step = build.next()
            self.assertIsNone(build.resume("pages"))
        self.assertEqual(build.key, "NEW")
        self.assertEqual(step["kind"], "wait")
        self.assertIn("Waiting for the build to start", step["message"])
        driver.assert_not_called()

    def test_init_after_connect_reuses_the_cover_without_wiping_and_dumps_every_page(self):
        self.prepare()
        path = self.workspace / "project.json"
        project = json.loads(path.read_text())
        project["target"]["connection"] = {"fileKey": "NEW", "coverPageId": "cover-page"}
        write_json(path, project)
        with contextlib.redirect_stdout(io.StringIO()), mock.patch.object(sys, "argv", ["figma_build.py", "init", "--project", str(self.workspace), "--file-key", "NEW",
                              "--site-url", "http://localhost:1234", "--canonical-base-url", "https://saved.invalid",
                              "--offline-images"]):
            self.assertEqual(figma_build.main(), 0)
        state = json.loads((self.workspace / "figma/state.json").read_text())
        self.assertEqual(state["preflightCover"], "cover-page")
        self.assertTrue(state["offlineImages"])
        self.assertFalse(state["iterate"])
        self.assertEqual(state["steps"][0]["id"], "pages")
        write_json(self.workspace / "figma/results/pages.json", {"pages": {"Cover": "cover-page"}})
        build = figma_runner.Build(self.workspace)
        self.assertEqual(build.dump_step()["step"], "dump:Cover")

    def test_await_build_logs_runner_error_with_action_before_reason(self):
        self.prepare()
        status = subprocess.CompletedProcess([], 0, json.dumps({"done": 1, "total": 3, "next": "variables"}))
        def failing(*args):
            (self.workspace / "figma/runner.log").write_text("2026-10-05T09:00:00 error: failed font load\n")
            return status
        err = io.StringIO()
        with mock.patch.object(rebuild, "command", side_effect=failing), \
             contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as raised:
            workflow.main(["await-build", "--project", str(self.workspace)])
        self.assertEqual(raised.exception.code, 1)
        entry = json.loads((self.workspace / workflow.PHASE_LOG).read_text().splitlines()[-1])
        self.assertEqual((entry["phase"], entry["status"]), ("foundation", "stopped"))
        self.assertIn("failed font load", entry["reason"])
        self.assertTrue(entry["message"].startswith("Fix what "))
        self.assertIn("then run the build again", entry["message"])
        self.assertIn("keeps retrying", entry["message"])
        self.ensure.assert_called_once_with(self.workspace)
        self.stop.assert_called_once_with(self.workspace)
        self.assertIn(entry["message"], err.getvalue())

    def test_stop_names_the_current_build_step_phase_before_receipts_complete_the_manifest(self):
        self.prepare()
        write_json(self.workspace / "figma/state.json", {"steps": [{"id": "pages"}, {"id": "cover"}],
                                                        "done": ["pages"]})
        with mock.patch.object(rebuild, "wait_for_build", side_effect=RuntimeError("runner stopped")), \
             contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            workflow.main(["await-build", "--project", str(self.workspace)])
        entry = json.loads((self.workspace / workflow.PHASE_LOG).read_text().splitlines()[-1])
        self.assertEqual(entry["phase"], "index")

    def test_await_build_timeout_is_logged_and_success_does_not_log_a_stop(self):
        self.prepare()
        with mock.patch.object(rebuild, "wait_for_build", side_effect=RuntimeError("replay timed out after 1s")), \
             contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
            workflow.main(["await-build", "--project", str(self.workspace), "--timeout", "1"])
        self.assertEqual(raised.exception.code, 1)
        log = (self.workspace / workflow.PHASE_LOG).read_text()
        self.assertIn('"status": "stopped"', log)
        with mock.patch.object(rebuild, "wait_for_build") as wait:
            workflow.main(["await-build", "--project", str(self.workspace), "--timeout", "12"])
        wait.assert_called_once_with(self.workspace, 12)
        self.assertEqual((self.workspace / workflow.PHASE_LOG).read_text(), log)

    def test_finish_scores_findings_with_session_and_does_not_repeat_receipt_phase_logs(self):
        self.prepare()
        write_json(self.workspace / "figma/state.json", {"steps": [{"id": "pages"}], "done": ["pages"]})
        write_json(self.workspace / "figma/verify/state.json", {})
        calls = []

        def execute(script, *args, **kwargs):
            calls.append((script, list(map(str, args))))
            if script == "figma_build.py":
                path = self.workspace / "project.json"
                project = json.loads(path.read_text())
                workflow.set_phase(path, project, "foundation", "complete")
                workflow.set_phase(path, project, "index", "complete")
            if script == "verify.py":
                write_json(self.workspace / "verify-report.json", {"open": [{"severity": "major"}]})
                self.assertEqual(kwargs["allowed"], (0, 1))
                return subprocess.CompletedProcess([], 1, "findings")
            if script == "workflow.py":
                with contextlib.redirect_stdout(io.StringIO()):
                    workflow.main(list(map(str, args)))
            return subprocess.CompletedProcess([], 0, "")

        out = io.StringIO()
        with mock.patch.object(rebuild, "command", side_effect=execute), contextlib.redirect_stdout(out):
            workflow.main(["finish", "--project", str(self.workspace), "--session", "current"])
        result = json.loads(out.getvalue())
        self.assertEqual(result["verifyExit"], 1)
        self.assertEqual(result["completion"], str(self.workspace / "benchmark/completion.md"))
        self.assertEqual(result["report"], str(self.workspace / "benchmark/report.html"))
        self.assertEqual(calls[-1], ("score_run.py", [str(self.workspace), "--out", str(self.workspace / "benchmark"), "--session", "current"]))
        self.assertEqual(calls[-2], ("workflow.py", ["record", "--project", str(self.workspace), "--phase", "benchmark", "--status", "running"]))
        log = [json.loads(line) for line in (self.workspace / workflow.PHASE_LOG).read_text().splitlines()]
        for phase in ("foundation", "components", "index"):
            self.assertEqual(len([row for row in log if row["phase"] == phase and row["status"] == "complete"]), 1)
        self.assertEqual(log[-1]["phase"], "benchmark")
        self.assertEqual(log[-1]["status"], "running")
        self.assertTrue((self.workspace / "figma/compare/corrected.json").is_file())
        self.assertTrue((self.workspace / "figma/verify/measurements.json").is_file())

    def test_finish_without_session_still_records_benchmark_start(self):
        self.prepare()
        write_json(self.workspace / "figma/verify/state.json", {})
        calls = []

        def execute(script, *args, **kwargs):
            calls.append((script, list(map(str, args))))
            if script == "verify.py":
                write_json(self.workspace / "verify-report.json", {"open": []})
            return subprocess.CompletedProcess([], 0, "")

        with mock.patch.object(rebuild, "command", side_effect=execute), contextlib.redirect_stdout(io.StringIO()):
            workflow.main(["finish", "--project", str(self.workspace)])
        self.assertEqual(calls[-2][0], "workflow.py")
        self.assertNotIn("--session", calls[-1][1])

    def test_scoring_writes_completion_and_stops_the_server_after_a_recorded_benchmark_start(self):
        result, _ = self.cli()
        workspace = Path(result["workspace"])
        with contextlib.redirect_stdout(io.StringIO()):
            workflow.main(["record", "--project", str(workspace), "--phase", "benchmark", "--status", "running"])
        with mock.patch.object(figma_runner, "stop_server", return_value={"stopped": False}) as stop, \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(score_run.main([str(workspace)]), 0)
        stop.assert_called_once_with(workspace)
        for name in ("completion.md", "report.html", "scorecard.json"):
            self.assertTrue((workspace / "benchmark" / name).is_file())
        project = json.loads((workspace / "project.json").read_text())
        self.assertEqual(project["phases"]["benchmark"]["status"], "complete")
        card = json.loads((workspace / "benchmark/scorecard.json").read_text())
        self.assertEqual(score_run.validate_scorecard(card), [])
        self.assertEqual(card["sections"]["identity"]["fields"]["rebuiltFrom"], result["rebuiltFrom"])
        self.assertIn("This run rebuilt an earlier run&#x27;s capture and plan",
                      (workspace / "benchmark/report.html").read_text())

    def test_copied_phases_do_not_count_as_production_time_and_report_names_reused_inputs(self):
        result, _ = self.cli()
        workspace = Path(result["workspace"])
        path, project = workflow.load_project(workspace)
        workflow.set_phase(path, project, "foundation", "complete")
        timings = score_run.phase_timings(workspace, project)
        self.assertEqual(timings["source"], "phase log")
        self.assertEqual([row["phase"] for row in timings["phases"]], ["foundation"])
        self.assertGreaterEqual(timings["totalSeconds"], 0)
        self.assertLess(timings["totalSeconds"], 10)
        identity = score_run.score_identity(workspace, project, None)
        report = score_report.identity_section(identity)
        self.assertIn("This run rebuilt an earlier run&#x27;s capture and plan", report)
        self.assertIn(str(self.source), report)
        (workspace / workflow.PHASE_LOG).unlink()
        fallback = score_run.phase_timings(workspace, project)
        self.assertEqual([row["phase"] for row in fallback["checkpoints"]], ["foundation"])


class RunsFolderTests(Sandbox):
    def setup_cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = lab_setup.main(list(args))
        return code, out.getvalue().strip(), err.getvalue()

    def test_prints_then_creates_runs_folder_and_defaults_to_cwd(self):
        expected = self.root / "PROJECT/design"
        code, out, err = self.setup_cli("runs-folder", "--from", str(self.repo))
        self.assertEqual((code, out, err), (0, str(expected), ""))
        self.assertFalse(expected.exists())
        with mock.patch.object(Path, "cwd", return_value=self.repo):
            self.assertEqual(self.setup_cli("runs-folder", "--create"), (0, str(expected), ""))
        self.assertTrue(expected.is_dir())

    def test_create_refuses_a_runs_folder_linked_into_a_repository(self):
        (self.root / "PROJECT/design").symlink_to(self.repo, target_is_directory=True)
        code, _, err = self.setup_cli("runs-folder", "--from", str(self.repo), "--create")
        self.assertEqual(code, 1)
        self.assertIn("inside the working copy", err)

    def test_no_convention_or_project_exits_one_with_configuration_message(self):
        self.config.write_text("{}")
        code, _, err = self.setup_cli("runs-folder", "--from", str(self.repo))
        self.assertEqual(code, 1)
        self.assertIn("design-lab:init", err)
        write_json(self.config, {"runs": {"convention": "project"}})
        code, _, err = self.setup_cli("runs-folder", "--from", str(self.home))
        self.assertEqual(code, 1)
        self.assertIn("cannot tell which folder", err)

    def test_check_reports_project_as_advice_in_json_and_text_and_omits_it_outside_project(self):
        with mock.patch.object(Path, "cwd", return_value=self.repo), \
             mock.patch.object(lab_setup, "run", return_value=None), \
             mock.patch.object(lab_setup, "claude_config_dirs", return_value=[]):
            code, out, _ = self.setup_cli("check", "--json")
            item = next(row for row in json.loads(out)["checks"] if row["id"] == "project")
            self.assertEqual(item["status"], "advice")
            self.assertEqual(item["label"], "This project's runs")
            self.assertIn(str(self.root / "PROJECT/design"), item["detail"])
            self.assertIn("does not exist yet", item["detail"])
            self.assertEqual(item["fix"], "lab_setup.py runs-folder --create")
            self.assertIsNone(item["needsApproval"])
            _, text, _ = self.setup_cli("check")
            self.assertIn("! This project's runs:", text)
        with mock.patch.object(Path, "cwd", return_value=self.home), \
             mock.patch.object(lab_setup, "run", return_value=None), \
             mock.patch.object(lab_setup, "claude_config_dirs", return_value=[]):
            _, out, _ = self.setup_cli("check", "--json")
            self.assertFalse(any(row["id"] == "project" for row in json.loads(out)["checks"]))
