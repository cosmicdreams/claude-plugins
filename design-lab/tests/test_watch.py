"""workflow.py watch: where a run is, summarised from the files the run writes."""
import datetime as dt
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import figma_runner  # noqa: E402
import workflow  # noqa: E402

HOME = tempfile.TemporaryDirectory()


def setUpModule():
    # The person's design-lab folder, for these tests only: never the real one.
    figma_runner.HOME = Path(HOME.name) / ".design-lab"


def tearDownModule():
    HOME.cleanup()


def ago(seconds: float) -> str:
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=seconds)).replace(microsecond=0).isoformat()


class WatchTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.w = Path(temp.name) / "run"
        (self.w / "figma").mkdir(parents=True)
        (self.w / "project.json").write_text(json.dumps({
            "createdAt": "2026-10-02T09:00:00+00:00", "run": {"siteLabel": "Example site"},
            "phases": {"capture": {"status": "complete"}, "plan": {"status": "approved"},
                       "components": {"status": "pending"}, "verify": {"status": "pending"}}}))

    def progress(self, **fields):
        base = {"state": "building", "stepsDone": 112, "stepsTotal": 158, "step": "component:card",
                "stepKind": "use_figma", "message": None, "inflight": False,
                "lastSeen": ago(5), "at": ago(2), "serverPid": 1}
        (self.w / "figma" / "progress.json").write_text(json.dumps({**base, **fields}))

    def log(self, *entries):
        (self.w / workflow.PHASE_LOG).write_text("".join(json.dumps(e) + "\n" for e in entries))

    def test_a_building_run_shows_its_steps_and_a_connected_runner(self):
        self.progress()
        text = workflow.render_watch(workflow.watch_summary(self.w))
        self.assertIn("design-lab · Example site", text)
        self.assertIn("steps 112/158, use_figma", text)
        self.assertIn("runner connected", text)
        self.assertIn("▸ components", text)
        self.assertIn("✓ plan", text)

    def test_a_runner_gone_quiet_is_reported_with_how_long(self):
        self.progress(lastSeen=ago(300))
        summary = workflow.watch_summary(self.w)
        self.assertFalse(summary["runner"]["connected"])
        self.assertIn("runner not seen for 5m", workflow.render_watch(summary))

    def test_a_slow_step_in_flight_counts_as_connected_while_the_server_beats(self):
        self.progress(lastSeen=ago(300), inflight=True)
        self.assertTrue(workflow.watch_summary(self.w)["runner"]["connected"])

    def test_a_stale_heartbeat_overrides_in_flight(self):
        # The server died mid-request: its last word was "in flight", but nobody is serving.
        self.progress(lastSeen=ago(300), inflight=True, at=ago(600))
        summary = workflow.watch_summary(self.w)
        self.assertFalse(summary["runner"]["serverAlive"])
        self.assertFalse(summary["runner"]["connected"])
        self.assertIn("runner server not responding", workflow.render_watch(summary))

    def test_the_blocker_comes_from_the_phase_log_and_clears_when_the_runner_returns(self):
        message = "Open Figma desktop, open the file, and start the design-lab runner."
        self.log({"phase": "components", "status": "running"},
                 {"phase": "components", "status": "stopped", "reason": "runner not connected", "message": message})
        self.progress(lastSeen=ago(300))
        self.assertIn(f"Needs you: {message}", workflow.render_watch(workflow.watch_summary(self.w)))
        self.progress()
        self.assertIsNone(workflow.watch_summary(self.w)["blocker"])

    def test_connect_wait_is_shown_and_clears_when_the_runner_connects(self):
        message = "Open the target file and start the design-lab runner."
        self.log({"phase": "connect", "status": "waiting", "reason": "runner connection", "message": message})
        self.progress(lastSeen=ago(300))
        summary = workflow.watch_summary(self.w)
        self.assertEqual(summary["waiting"], message)
        self.assertIsNone(summary["blocker"])
        text = workflow.render_watch(summary)
        self.assertIn(f"Needs you: {message}", text)
        self.assertNotIn("resume", text.lower())
        self.progress()
        self.assertIsNone(workflow.watch_summary(self.w)["waiting"])

    def test_a_runner_not_needed_yet_is_idle_and_one_the_build_waits_for_is_awaited(self):
        self.progress(state="waiting", stepsDone=None, stepsTotal=None, stepKind=None, lastSeen=ago(600))
        self.assertIn("runner idle until the build", workflow.render_watch(workflow.watch_summary(self.w)))
        self.log({"phase": "connect", "status": "waiting", "message": "Start the runner."})
        self.assertIn("waiting for the runner to start", workflow.render_watch(workflow.watch_summary(self.w)))

    def test_waiting_shows_the_servers_message(self):
        self.progress(state="waiting", stepsDone=None, stepsTotal=None, stepKind=None,
                      message="Build complete. Waiting for the next build.")
        self.assertIn("Build complete. Waiting for the next build.",
                      workflow.render_watch(workflow.watch_summary(self.w)))

    def score(self, build_created_at):
        (self.w / "benchmark").mkdir(exist_ok=True)
        (self.w / "benchmark" / "scorecard.json").write_text(json.dumps({"run": {"buildCreatedAt": build_created_at}}))
        (self.w / "benchmark" / "completion.md").write_text("done")

    def test_the_recap_is_named_once_the_scorer_has_written_it(self):
        self.assertIsNone(workflow.watch_summary(self.w)["recap"])
        self.score("2026-10-02T09:00:00+00:00")
        self.assertIn("Recap:", workflow.render_watch(workflow.watch_summary(self.w)))

    def test_an_earlier_builds_recap_is_not_this_builds(self):
        self.score("2026-09-30T09:00:00+00:00")
        self.assertIsNone(workflow.watch_summary(self.w)["recap"])

    def test_an_unstamped_recap_counts_once_the_benchmark_is_complete(self):
        (self.w / "benchmark").mkdir()
        (self.w / "benchmark" / "completion.md").write_text("done")
        self.assertIsNone(workflow.watch_summary(self.w)["recap"])
        project = json.loads((self.w / "project.json").read_text())
        project["phases"]["benchmark"] = {"status": "complete"}
        (self.w / "project.json").write_text(json.dumps(project))
        self.assertIsNotNone(workflow.watch_summary(self.w)["recap"])

    def test_half_written_or_missing_files_still_summarise(self):
        (self.w / "figma" / "progress.json").write_text('{"state": "build')
        (self.w / workflow.PHASE_LOG).write_text('{"phase": ')
        summary = workflow.watch_summary(self.w)
        self.assertIsNone(summary["runner"])
        self.assertIsNone(summary["blocker"])
        self.assertIn("No design-lab run", workflow.render_watch(workflow.watch_summary(self.w / "missing")))

    def test_the_active_run_pointer_names_the_run_and_its_server(self):
        workflow.write_active_run(self.w, 4242)
        pointer = json.loads((figma_runner.HOME / workflow.ACTIVE_RUN).read_text())
        self.assertEqual(pointer["workspace"], str(self.w.resolve()))
        self.assertEqual(pointer["serverPid"], 4242)
        self.assertEqual(workflow.active_run(), self.w.resolve())


if __name__ == "__main__":
    unittest.main()
