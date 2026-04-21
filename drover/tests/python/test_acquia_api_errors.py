"""Tests for structured HTTP error handling in acquia_api.py.

Uses a stub http.server to simulate Acquia API responses — no network,
no credentials required. Verifies:
  - 403 forbidden_ip body → AcquiaAPIError with error_slug='forbidden_ip'
  - 500 → retried, eventual success returns parsed JSON
  - 400 non-retryable → AcquiaAPIError raised without retry
"""
import http.server
import importlib.util
import json
import pathlib
import tempfile
import threading
import unittest

HERE = pathlib.Path(__file__).resolve()
MOD_PATH = HERE.parents[2] / "scripts" / "monitors" / "acquia_api.py"


def load_module(config_path: str, api_base: str, token_url: str):
    """Load acquia_api with env pointing at a stub server + temp config."""
    import os
    os.environ["ACQUIA_CONFIG_PATH"] = config_path
    os.environ["ACQUIA_API_BASE"] = api_base
    os.environ["ACQUIA_TOKEN_URL"] = token_url
    spec = importlib.util.spec_from_file_location("acquia_api_test", MOD_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class StubHandler(http.server.BaseHTTPRequestHandler):
    # Per-path response queue populated by the test. Each queue entry is
    # (status, body_bytes). The handler pops the next entry on each request,
    # letting tests simulate 500-then-200 retry sequences.
    responses: dict = {}

    def log_message(self, *a, **kw):
        pass

    def _respond(self):
        queue = self.responses.get(self.path, [])
        if not queue:
            self.send_response(404)
            self.end_headers()
            return
        status, body = queue.pop(0)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._respond()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        self._respond()


class AcquiaAPIErrorHandlingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), StubHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.port}"

        cls.tmp = tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False,
        )
        json.dump({
            "acli_key": "k",
            "keys": {"k": {"secret": "s", "uuid": "k"}},
        }, cls.tmp)
        cls.tmp.flush()
        cls.tmp.close()

        cls.mod = load_module(
            config_path=cls.tmp.name,
            api_base=cls.base,
            token_url=cls.base + "/token",
        )

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        StubHandler.responses.clear()
        # Valid token response seeded on every test.
        StubHandler.responses["/token"] = [(
            200,
            json.dumps({"access_token": "t", "expires_in": 300}).encode(),
        )]

    def test_403_forbidden_ip_maps_to_structured_error(self):
        StubHandler.responses["/applications"] = [(
            403,
            json.dumps({
                "error": "forbidden_ip",
                "message": "IP not on allowlist.",
            }).encode(),
        )]
        client = self.mod.AcquiaClient()
        with self.assertRaises(self.mod.AcquiaAPIError) as ctx:
            client.list_applications()
        self.assertEqual(ctx.exception.status, 403)
        self.assertEqual(ctx.exception.error_slug, "forbidden_ip")

    def test_500_retried_then_success(self):
        StubHandler.responses["/applications"] = [
            (500, b'{"error":"server_error"}'),
            (200, json.dumps({"_embedded": {"items": [{"name": "a"}]}}).encode()),
        ]
        # Disable real backoff delays during the test.
        self.mod._BACKOFF_BASE = 0
        client = self.mod.AcquiaClient()
        apps = client.list_applications()
        self.assertEqual(apps, [{"name": "a"}])

    def test_400_not_retried(self):
        StubHandler.responses["/applications"] = [
            (400, b'{"error":"bad_request"}'),
        ]
        client = self.mod.AcquiaClient()
        with self.assertRaises(self.mod.AcquiaAPIError) as ctx:
            client.list_applications()
        self.assertEqual(ctx.exception.status, 400)
        self.assertEqual(ctx.exception.error_slug, "bad_request")
        # Queue should still have zero retries-consumed entries — exactly one
        # request went out.
        self.assertEqual(StubHandler.responses["/applications"], [])


if __name__ == "__main__":
    unittest.main()
