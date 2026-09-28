"""The runner's local HTTP server: token, origin lock, request errors, workspace keys."""
import json
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import figma_runner  # noqa: E402

TOKEN = "test-token"


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

    def request(self, path, *, token=TOKEN, origin="null", body=None):
        query = "fileKey=KEY" + (f"&token={token}" if token is not None else "")
        url = f"http://127.0.0.1:{self.server.server_address[1]}{path}{'&' if '?' in path else '?'}{query}"
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

    def test_two_workspaces_for_one_file_are_refused(self):
        a = workspace(self.root / "a", "SAME")
        b = workspace(self.root / "b", "SAME")
        with self.assertRaisesRegex(SystemExit, "both build file SAME"):
            figma_runner.load_builds([str(a), str(b)])
        self.assertEqual(list(figma_runner.load_builds([str(a), str(a)])), ["SAME"])

    def test_port_is_fixed(self):
        done = subprocess.run([sys.executable, str(SCRIPTS / "figma_runner.py"), "serve",
                               "--project", str(self.root / "w"), "--port", "9999"],
                              capture_output=True, text=True, timeout=30)
        self.assertEqual(done.returncode, 2)
        self.assertIn("--port", done.stderr)
        self.assertEqual(figma_runner.PORT, 8765)


if __name__ == "__main__":
    unittest.main()
