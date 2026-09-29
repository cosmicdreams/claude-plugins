"""The runner's local HTTP server: token, origin lock, request errors, workspace keys."""
import contextlib
import io
import json
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import figma_runner  # noqa: E402

TOKEN = "test-token"
HOME = tempfile.TemporaryDirectory()


def setUpModule():
    # The person's design-lab folder, for these tests only: never the real ~/.design-lab.
    figma_runner.HOME = Path(HOME.name) / ".design-lab"


def tearDownModule():
    HOME.cleanup()


def workspace(root: Path, key: str) -> Path:
    (root / "figma").mkdir(parents=True)
    (root / "figma" / "state.json").write_text(json.dumps({"fileKey": key, "steps": [], "done": []}))
    return root


class RunnerServerTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        builds = figma_runner.load_builds([str(workspace(self.root / "w", "KEY"))])
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), figma_runner.make_handler(builds, TOKEN))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, path, *, token=TOKEN, origin="null", body=None, key="KEY", server=None,
                version=figma_runner.plugin_version()):
        query = (f"fileKey={key}" + (f"&token={token}" if token is not None else "")
                 + (f"&version={version}" if version is not None else ""))
        port = (server or self.server).server_address[1]
        url = f"http://127.0.0.1:{port}{path}{'&' if '?' in path else '?'}{query}"
        req = urllib.request.Request(url, data=body, headers={"Origin": origin} if origin else {},
                                     method="POST" if body is not None else "GET")
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return res.status, res.headers, res.read().decode()
        except urllib.error.HTTPError as e:
            with e:
                return e.code, e.headers, e.read().decode()

    def test_requests_without_the_token_are_refused(self):
        for token in (None, "wrong"):
            status, _, text = self.request("/next", token=token)
            self.assertEqual(status, 401, token)
            self.assertIn("token", text)
        status, _, _ = self.request("/record?step=pages", token=None, body=b"{}")
        self.assertEqual(status, 401)
        self.assertFalse((self.root / "w" / "figma" / "inbox.json").exists())

    def test_only_the_plugin_origin_is_allowed(self):
        status, headers, _ = self.request("/next", origin="https://attacker.example")
        self.assertEqual(status, 403)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "null")
        # With the token and the plugin's opaque origin the request reaches the build; there
        # is no current step, so recording is refused by the build, not by the gate.
        status, headers, text = self.request("/record?step=pages", body=b"{}")
        self.assertEqual(status, 500)
        self.assertIn("not the current step", text)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "null")

    def test_malformed_json_gets_an_error_reply(self):
        status, _, text = self.request("/record?step=pages", body=b"{not json")
        self.assertEqual(status, 500)
        self.assertIn("Expecting property name", text)
        status, _, text = self.request("/error", body=b"[1, 2]")
        self.assertEqual(status, 500)
        self.assertIn("JSON object", text)

    def test_a_server_serves_exactly_one_run(self):
        a = workspace(self.root / "a", "KEYA")
        b = workspace(self.root / "b", "KEYB")
        with self.assertRaisesRegex(SystemExit, "one run at a time"):
            figma_runner.load_builds([str(a), str(b)])
        self.assertEqual(list(figma_runner.load_builds([str(a), str(a)])), ["KEYA"])

    def test_an_outdated_runner_is_told_to_restart(self):
        for version in (None, "0.1.0", "source"):
            status, _, text = self.request("/next", version=version)
            self.assertEqual(status, 426, version)
            answer = json.loads(text)
            self.assertTrue(answer["outdated"])
            self.assertEqual(answer["message"], f"Close the design-lab runner in Figma and start it again; it was "
                             f"updated to {figma_runner.plugin_version()} and Figma loads the new code when it starts.")

    def test_each_request_notes_when_the_runner_last_asked(self):
        self.request("/next")
        self.assertTrue((self.root / "w" / "figma" / figma_runner.SEEN_FILE).is_file())

    def test_port_is_fixed(self):
        done = subprocess.run([sys.executable, str(SCRIPTS / "figma_runner.py"), "serve",
                               "--project", str(self.root / "w"), "--port", "9999"],
                              capture_output=True, text=True, timeout=30)
        self.assertEqual(done.returncode, 2)
        self.assertIn("--port", done.stderr)
        self.assertEqual(figma_runner.PORT, 8765)


def preflight_workspace(root: Path, key: str) -> Path:
    """A run at preflight: a target Figma file in project.json, no build steps yet."""
    root.mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"target": {"figmaFileKey": key}}))
    return root


class HandshakeTests(unittest.TestCase):
    """The runner waits before the build, and preflight's check proves the target can be written."""

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.ws = preflight_workspace(Path(temp.name) / "w", "KEY")
        builds = figma_runner.load_builds([str(self.ws)])
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), figma_runner.make_handler(builds, TOKEN))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.call = RunnerServerTests.request.__get__(self)

    def step(self, expected_kind="check"):
        status, _, text = self.call("/next")
        step = json.loads(text)
        self.assertEqual((status, step["kind"]), (200, expected_kind), text)
        return step

    def record(self, step, result):
        status, _, text = self.call(f"/record?step={step}", body=json.dumps(result).encode())
        self.assertEqual(status, 200, text)

    def check(self, probe=None, cover=None, expected=None):
        """Drive the three preflight steps as the runner would, with the results Figma returns."""
        figma_runner.request_handshake(self.ws, {"ground": "#001B67", "headline": "Example", "subtitle": "Component Library",
                                                 "provenance": {"stage": "preflight"}, "version": "4.1.0"}, expected)
        first = self.step()
        self.assertEqual(first["step"], figma_runner.CHECK_STEP)
        self.assertNotIn("createRectangle", first["code"])
        self.record(first["step"], {"fileKey": "KEY", "fileName": "Library", "pages": 1, "empty": True,
                                    "preflightCover": False} | (probe or {}))
        if not (self.ws / "figma" / figma_runner.HANDSHAKE).exists():
            page = self.step()
            self.assertEqual(page["step"], figma_runner.PAGE_STEP)
            self.record(page["step"], {"pageId": "0:1"})
            draw = self.step()
            self.assertEqual(draw["step"], figma_runner.COVER_STEP)
            # The real cover.js, in its name-only form: the run's name and nothing computed.
            self.assertIn('"pageId":"0:1"', draw["code"])
            self.assertIn('"tiers":[]', draw["code"])
            self.assertNotIn('"total"', draw["code"])
            self.assertIn("const nameOnly = !ARGS.total;", draw["code"])
            if cover is None:
                cover = {"coverId": "1:2", "pageId": "0:1", "font": "IBM Plex Sans", "fontLoaded": True,
                         "pluginData": True, "nameOnly": True}
            if cover == "error":
                status, _, _ = self.call("/error", body=json.dumps(
                    {"step": draw["step"], "message": "IBM Plex Sans could not load and the fallback failed to load: x"}).encode())
                self.assertEqual(status, 200)
            else:
                self.record(draw["step"], cover)
        return figma_runner.wait_for_handshake(self.ws, timeout=1, poll=0.05)

    def test_the_runner_waits_before_there_are_build_steps(self):
        status, _, text = self.call("/next")
        step = json.loads(text)
        self.assertEqual((status, step["kind"], step["retryMs"]), (200, "wait", 5000))
        self.assertEqual(step["message"], "Connected. Waiting for the build to start.")

    def test_handshake_draws_a_name_only_cover(self):
        outcome = self.check()
        self.assertTrue(outcome["ok"], outcome)
        self.assertTrue(all(outcome[k] for k in ("runnerConnected", "fileKeyMatches", "empty", "writable", "pluginData")))
        self.assertEqual((outcome["coverPageId"], outcome["font"], outcome["fontLoaded"]), ("0:1", "IBM Plex Sans", True))
        self.assertFalse((self.ws / "figma" / figma_runner.HANDSHAKE_REQUEST).exists())
        self.assertEqual(self.step("wait")["kind"], "wait")                    # the runner stays open

    def test_a_file_holding_only_this_runs_preflight_cover_counts_as_empty(self):
        outcome = self.check(probe={"empty": False, "preflightCover": True}, expected="0:1")
        self.assertTrue(outcome["ok"])
        self.assertTrue(outcome["onlyPreflightCover"])

    def test_a_file_that_is_not_empty_fails(self):
        outcome = self.check(probe={"empty": False, "pages": 3})
        self.assertFalse(outcome["ok"])
        self.assertIn("not empty", outcome["failure"])

    def test_a_cover_that_cannot_be_drawn_fails_with_its_cause(self):
        outcome = self.check(cover="error")
        self.assertFalse(outcome["ok"])
        self.assertIn("the name-only Cover could not be drawn: IBM Plex Sans could not load and the fallback failed",
                      outcome["failure"])

    def test_a_page_that_cannot_be_created_fails(self):
        figma_runner.request_handshake(self.ws)
        self.record(self.step()["step"], {"fileKey": "KEY", "fileName": "Library", "pages": 1, "empty": True})
        page = self.step()
        self.call("/error", body=json.dumps({"step": page["step"], "message": "read-only file"}).encode())
        outcome = figma_runner.wait_for_handshake(self.ws, timeout=1, poll=0.05)
        self.assertIn("the Cover page could not be created: read-only file", outcome["failure"])

    def test_a_cover_whose_plugin_data_does_not_read_back_fails(self):
        outcome = self.check(cover={"coverId": "1:2", "pageId": "0:1", "fontLoaded": False, "font": "Inter",
                                    "pluginData": False})
        self.assertFalse(outcome["ok"])
        self.assertIn("plugin data", outcome["failure"])

    def test_a_different_open_file_fails(self):
        figma_runner.request_handshake(self.ws)
        status, _, _ = self.call("/next", key="OTHER")
        self.assertEqual(status, 404)
        outcome = figma_runner.wait_for_handshake(self.ws, timeout=1, poll=0.05)
        self.assertFalse(outcome["ok"])
        self.assertIn("different file (key OTHER)", outcome["failure"])

    def test_a_rejected_token_fails(self):
        figma_runner.request_handshake(self.ws)
        status, _, _ = self.call("/next", token="stale")
        self.assertEqual(status, 401)
        outcome = figma_runner.wait_for_handshake(self.ws, timeout=1, poll=0.05)
        self.assertFalse(outcome["ok"])
        self.assertIn("token was rejected", outcome["failure"])

    def test_no_runner_within_the_timeout_fails(self):
        figma_runner.request_handshake(self.ws)
        outcome = figma_runner.wait_for_handshake(self.ws, timeout=0.2, poll=0.05)
        self.assertEqual((outcome["ok"], outcome["runnerConnected"]), (False, False))
        self.assertIn("no runner connected within", outcome["failure"])
        self.assertFalse((self.ws / "figma" / figma_runner.HANDSHAKE_REQUEST).exists())
        self.assertEqual(json.loads(self.call("/next")[2])["kind"], "wait")     # the request was withdrawn

    def test_the_token_belongs_to_the_person_not_the_run(self):
        first = figma_runner.person_token()
        path = figma_runner.HOME / figma_runner.TOKEN_FILE
        self.assertEqual((path.stat().st_mode & 0o777, figma_runner.HOME.stat().st_mode & 0o777), (0o600, 0o700))
        self.assertEqual(figma_runner.person_token(), first)             # every server, every restart, every run
        self.assertFalse((self.ws / "figma" / figma_runner.TOKEN_FILE).exists())

    def test_a_handshake_reports_an_outdated_runner(self):
        figma_runner.request_handshake(self.ws)
        status, _, _ = self.call("/next", version="0.1.0")
        self.assertEqual(status, 426)
        outcome = figma_runner.wait_for_handshake(self.ws, timeout=1, poll=0.05)
        self.assertFalse(outcome["ok"])
        self.assertTrue(outcome["failure"].startswith("Close the design-lab runner in Figma and start it again"))

    def test_a_check_recorded_after_preflight_gave_up_is_ignored(self):
        figma_runner.request_handshake(self.ws)
        step = self.step()
        (self.ws / "figma" / figma_runner.HANDSHAKE_REQUEST).unlink()      # preflight timed out and withdrew
        self.record(step["step"], {"fileKey": "KEY", "fileName": "F", "pages": 1, "empty": True})
        self.assertFalse((self.ws / "figma" / figma_runner.HANDSHAKE_REQUEST).exists())
        self.assertEqual(self.step("wait")["kind"], "wait")                  # /next is not wedged

    def test_a_handshake_request_without_cover_arguments_still_draws(self):
        (self.ws / "figma").mkdir(exist_ok=True)
        (self.ws / "figma" / figma_runner.HANDSHAKE_REQUEST).write_text(json.dumps({"stage": "cover", "pageId": "0:1"}))
        self.assertIn('"headline":"Library"', self.step()["code"])

    def test_a_resumed_build_proves_only_the_connection(self):
        figma_runner.request_handshake(self.ws, connection_only=True)
        self.record(self.step()["step"], {"fileKey": "KEY", "fileName": "F", "pages": 9, "empty": False})
        outcome = figma_runner.wait_for_handshake(self.ws, timeout=1, poll=0.05)
        self.assertEqual((outcome["ok"], outcome["connectionOnly"], outcome["fileKeyMatches"]), (True, True, True))
        figma_runner.request_handshake(self.ws, connection_only=True)
        self.record(self.step()["step"], {"fileKey": "OTHER", "fileName": "F", "pages": 1, "empty": True})
        self.assertFalse(figma_runner.wait_for_handshake(self.ws, timeout=1, poll=0.05)["ok"])

    def test_a_slow_step_is_reported_in_flight(self):
        from unittest import mock
        (self.ws / "figma").mkdir(exist_ok=True)
        (self.ws / "figma" / "state.json").write_text(json.dumps({"fileKey": "KEY", "steps": [{"id": "images:a"}], "done": []}))
        slow = threading.Event()

        def driver(this, *args):
            slow.wait(5)                                   # an image fetch that takes a while
            return {"kind": "done"}
        with mock.patch.object(figma_runner.Build, "driver", driver), \
                mock.patch.object(figma_runner.Build, "dump_step", lambda this: None):
            worker = threading.Thread(target=lambda: self.call("/next"))
            worker.start()
            for _ in range(50):
                status, _, text = self.call("/health", version=None)
                if json.loads(text)["inflight"]:
                    break
                time.sleep(0.05)
            self.assertTrue(json.loads(text)["inflight"])
            slow.set()
            worker.join(5)
        self.assertFalse(json.loads(self.call("/health", version=None)[2])["inflight"])

    def test_preflight_stops_the_server_a_finished_run_left_behind(self):
        from unittest import mock
        finished = preflight_workspace(self.ws.parent / "done", "KEYD")
        (finished / "figma").mkdir()
        (finished / "figma" / "state.json").write_text(json.dumps({"steps": [{"id": "pages"}], "done": ["pages"]}))
        busy = {"alive": False, "pid": 7, "portInUse": True, "otherRun": str(finished), "otherPid": 7, "log": ""}
        mine = {"alive": True, "pid": 8, "portInUse": True, "otherRun": None, "otherPid": None, "log": ""}
        with mock.patch.object(figma_runner, "server_status", side_effect=[busy, mine]), \
                mock.patch.object(figma_runner, "stop_server") as stop, \
                mock.patch.object(figma_runner, "port_in_use", return_value=False), \
                contextlib.redirect_stderr(io.StringIO()) as said:
            self.assertEqual(figma_runner.ensure_server(self.ws)["started"], False)
        stop.assert_called_once_with(finished)
        self.assertIn("stopped the runner server of a finished run", said.getvalue())

    def test_another_active_run_is_refused_by_name(self):
        from unittest import mock
        busy = {"alive": False, "pid": None, "portInUse": True, "otherRun": "/runs/other", "otherPid": 4321, "log": ""}
        with mock.patch.object(figma_runner, "server_status", return_value=busy):
            with self.assertRaises(RuntimeError) as caught:
                figma_runner.ensure_server(self.ws)
        text = str(caught.exception)
        self.assertIn("another run is active: /runs/other (server process 4321)", text)
        self.assertIn("stop --project /runs/other", text)

    def test_the_runner_is_copied_to_a_stable_folder_with_its_version(self):
        first = figma_runner.install_runner()
        folder = figma_runner.HOME / "runner"
        self.assertEqual(first["manifest"], str(folder / "manifest.json"))
        self.assertTrue(first["firstInstall"])
        code = (folder / "code.js").read_text()
        self.assertIn(f"const RUNNER_VERSION = '{figma_runner.plugin_version()}';", code)
        again = figma_runner.install_runner()
        self.assertEqual((again["firstInstall"], again["updated"]), (False, False))
        (folder / "code.js").write_text("old code")
        self.assertTrue(figma_runner.install_runner()["updated"])       # an update refreshes the same folder


if __name__ == "__main__":
    unittest.main()
