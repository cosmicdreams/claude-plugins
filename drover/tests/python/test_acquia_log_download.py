"""Tests for the date-range log download flow added in drover 2.0.

Covers:
  - request_log_download(from_iso, to_iso) sends both in the POST body
  - request_log_download() with no args sends an empty body (legacy)
  - get_log_download_url() captures the Location header from a 301
    response WITHOUT following the redirect (the auth header would
    poison an S3 GET)
  - get_log_download_url() raises if the response isn't a redirect
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
    import os
    os.environ["ACQUIA_CONFIG_PATH"] = config_path
    os.environ["ACQUIA_API_BASE"] = api_base
    os.environ["ACQUIA_TOKEN_URL"] = token_url
    spec = importlib.util.spec_from_file_location("acquia_api_test", MOD_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class StubHandler(http.server.BaseHTTPRequestHandler):
    # Per-test state — set in setUp on the class.
    last_post_body: bytes = b""
    redirect_to: str = ""
    redirect_status: int = 301
    serve_redirect: bool = False
    serve_200_for_logs_get: bool = False

    def log_message(self, *a, **kw):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        type(self).last_post_body = body
        if self.path == "/token":
            payload = json.dumps(
                {"access_token": "t", "expires_in": 300}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        # log-create POST returns a notification envelope
        payload = json.dumps({
            "message": "Log file is being created.",
            "_links": {
                "notification": {
                    "href": "https://example/notifications/abc",
                },
            },
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if type(self).serve_redirect:
            self.send_response(type(self).redirect_status)
            self.send_header("Location", type(self).redirect_to)
            self.end_headers()
            return
        if type(self).serve_200_for_logs_get:
            payload = b'{"items": []}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        self.send_response(404)
        self.end_headers()


class LogDownloadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), StubHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(
            target=cls.server.serve_forever, daemon=True
        )
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
        StubHandler.last_post_body = b""
        StubHandler.serve_redirect = False
        StubHandler.serve_200_for_logs_get = False
        StubHandler.redirect_to = ""
        StubHandler.redirect_status = 301

    # --- request_log_download body shape -----------------------------

    def test_request_log_download_with_from_and_to_sends_body(self):
        client = self.mod.AcquiaClient()
        client.request_log_download(
            "env-uuid",
            "drupal-watchdog",
            from_iso="2026-04-03T00:00:00+00:00",
            to_iso="2026-04-03T23:59:59+00:00",
        )
        body = json.loads(StubHandler.last_post_body)
        self.assertEqual(body["from"], "2026-04-03T00:00:00+00:00")
        self.assertEqual(body["to"], "2026-04-03T23:59:59+00:00")

    def test_request_log_download_without_dates_sends_empty_body(self):
        client = self.mod.AcquiaClient()
        client.request_log_download("env-uuid", "drupal-watchdog")
        # Empty dict serialized; Acquia treats this as "current buffer."
        self.assertEqual(StubHandler.last_post_body, b"{}")

    def test_request_log_download_partial_only_from(self):
        client = self.mod.AcquiaClient()
        client.request_log_download(
            "env-uuid",
            "drupal-watchdog",
            from_iso="2026-04-03T00:00:00+00:00",
        )
        body = json.loads(StubHandler.last_post_body)
        self.assertEqual(body, {"from": "2026-04-03T00:00:00+00:00"})

    # --- get_log_download_url redirect capture -----------------------

    def test_get_log_download_url_captures_301_location(self):
        StubHandler.serve_redirect = True
        StubHandler.redirect_status = 301
        StubHandler.redirect_to = (
            "https://s3.amazonaws.com/bucket/prod/foo/bar.gz"
            "?X-Amz-Signature=abc123"
        )
        client = self.mod.AcquiaClient()
        url = client.get_log_download_url("env-uuid", "drupal-watchdog")
        self.assertEqual(url, StubHandler.redirect_to)

    def test_get_log_download_url_captures_302_location(self):
        StubHandler.serve_redirect = True
        StubHandler.redirect_status = 302
        StubHandler.redirect_to = "https://s3.example/x.gz"
        client = self.mod.AcquiaClient()
        url = client.get_log_download_url("env-uuid", "drupal-watchdog")
        self.assertEqual(url, "https://s3.example/x.gz")

    def test_get_log_download_url_raises_on_unexpected_200(self):
        StubHandler.serve_200_for_logs_get = True
        client = self.mod.AcquiaClient()
        with self.assertRaises(RuntimeError):
            client.get_log_download_url("env-uuid", "drupal-watchdog")


if __name__ == "__main__":
    unittest.main()
