"""Unit tests for drover.scripts.jira_api (slice 12)."""
from __future__ import annotations

import http.server
import importlib.util
import json
import pathlib
import sys
import tempfile
import threading
import unittest

HERE = pathlib.Path(__file__).resolve()
SCRIPTS = HERE.parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

spec = importlib.util.spec_from_file_location(
    "drover_jira_api", SCRIPTS / "jira_api.py",
)
jira_api = importlib.util.module_from_spec(spec)
sys.modules["drover_jira_api"] = jira_api
spec.loader.exec_module(jira_api)


# --- jira-cli config reader -----------------------------------------------

class ReadJiraCliConfigTests(unittest.TestCase):
    def test_extracts_top_level_keys(self):
        with tempfile.TemporaryDirectory() as td:
            p = pathlib.Path(td) / ".config.yml"
            p.write_text(
                "auth_type: basic\n"
                "server: https://x.atlassian.net\n"
                "login: a@b.com\n"
                "board:\n"
                "    id: 2304\n"
            )
            out = jira_api._read_jira_cli_config(p)
            self.assertEqual(out["server"], "https://x.atlassian.net")
            self.assertEqual(out["login"], "a@b.com")
            self.assertEqual(out["auth_type"], "basic")

    def test_handles_missing_file(self):
        out = jira_api._read_jira_cli_config(
            pathlib.Path("/nonexistent/path"),
        )
        self.assertEqual(out, {})

    def test_strips_quoted_values(self):
        with tempfile.TemporaryDirectory() as td:
            p = pathlib.Path(td) / ".config.yml"
            p.write_text("server: 'https://quoted.example'\n")
            out = jira_api._read_jira_cli_config(p)
            self.assertEqual(out["server"], "https://quoted.example")


# --- Credential resolution ------------------------------------------------

class ResolveCredentialsTests(unittest.TestCase):
    def setUp(self):
        # Save & clear JIRA_API_TOKEN so tests don't pick up the host's value
        self._save = jira_api.os.environ.pop("JIRA_API_TOKEN", None)

    def tearDown(self):
        if self._save is not None:
            jira_api.os.environ["JIRA_API_TOKEN"] = self._save
        else:
            jira_api.os.environ.pop("JIRA_API_TOKEN", None)

    def test_reads_from_jira_cli_config(self):
        with tempfile.TemporaryDirectory() as td:
            cli = pathlib.Path(td) / ".config.yml"
            cli.write_text(
                "server: https://x.atlassian.net\n"
                "login: a@b.com\n"
            )
            jira_api.os.environ["JIRA_API_TOKEN"] = "tok123"
            creds = jira_api.resolve_credentials(
                cli_config_path=cli,
                drover_config_path=pathlib.Path("/nonexistent"),
            )
            self.assertEqual(creds["server"], "https://x.atlassian.net")
            self.assertEqual(creds["email"], "a@b.com")
            self.assertEqual(creds["token"], "tok123")

    def test_manifest_overrides_cli(self):
        with tempfile.TemporaryDirectory() as td:
            cli = pathlib.Path(td) / ".config.yml"
            cli.write_text(
                "server: https://default.example\n"
                "login: default@x.com\n"
            )
            jira_api.os.environ["JIRA_API_TOKEN"] = "tok"
            creds = jira_api.resolve_credentials(
                manifest_jira={
                    "server": "https://override.example",
                    "email": "override@x.com",
                },
                cli_config_path=cli,
                drover_config_path=pathlib.Path("/nonexistent"),
            )
            self.assertEqual(creds["server"], "https://override.example")
            self.assertEqual(creds["email"], "override@x.com")

    def test_drover_user_config_supplies_token(self):
        with tempfile.TemporaryDirectory() as td:
            cli = pathlib.Path(td) / ".config.yml"
            cli.write_text(
                "server: https://x.example\n"
                "login: a@b.com\n"
            )
            drover_user = pathlib.Path(td) / "jira.json"
            drover_user.write_text(json.dumps({"token": "from-disk"}))
            creds = jira_api.resolve_credentials(
                cli_config_path=cli, drover_config_path=drover_user,
            )
            self.assertEqual(creds["token"], "from-disk")

    def test_missing_credentials_raises_helpful_error(self):
        with tempfile.TemporaryDirectory() as td:
            cli = pathlib.Path(td) / ".config.yml"
            cli.write_text("")
            with self.assertRaises(FileNotFoundError) as ctx:
                jira_api.resolve_credentials(
                    cli_config_path=cli,
                    drover_config_path=pathlib.Path("/nonexistent"),
                )
            self.assertIn("server", str(ctx.exception))
            self.assertIn("token", str(ctx.exception))

    def test_trailing_slash_stripped_from_server(self):
        with tempfile.TemporaryDirectory() as td:
            cli = pathlib.Path(td) / ".config.yml"
            cli.write_text(
                "server: https://x.example/\n"
                "login: a@b.com\n"
            )
            jira_api.os.environ["JIRA_API_TOKEN"] = "tok"
            creds = jira_api.resolve_credentials(
                cli_config_path=cli,
                drover_config_path=pathlib.Path("/nonexistent"),
            )
            self.assertEqual(creds["server"], "https://x.example")


# --- HTTP client (against a stub server) ---------------------------------

class StubHandler(http.server.BaseHTTPRequestHandler):
    routes: dict = {}        # path -> queue of (status, body_bytes)
    last_method: str = ""
    last_path: str = ""
    last_body: bytes = b""
    last_auth: str = ""

    def log_message(self, *a, **kw):
        pass

    def _serve(self):
        type(self).last_method = self.command
        type(self).last_path = self.path
        type(self).last_auth = self.headers.get("Authorization", "")
        length = int(self.headers.get("Content-Length") or 0)
        type(self).last_body = self.rfile.read(length) if length else b""
        queue = self.routes.get(self.path, [])
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

    do_GET = do_POST = do_PUT = _serve


class JiraClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), StubHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(
            target=cls.server.serve_forever, daemon=True,
        )
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        StubHandler.routes = {}
        StubHandler.last_body = b""
        StubHandler.last_auth = ""

    def _client(self):
        return jira_api.JiraClient(creds={
            "server": self.base, "email": "x@y.com", "token": "tok",
        })

    def test_create_issue_posts_correct_payload(self):
        StubHandler.routes["/rest/api/2/issue"] = [(
            201,
            json.dumps({"key": "PPS-100", "id": "1", "self": "..."}).encode(),
        )]
        c = self._client()
        out = c.create_issue(
            project_key="PPS", issue_type="Chore",
            summary="Title", description="Body",
            labels=["a", "b"], priority="High",
        )
        self.assertEqual(out["key"], "PPS-100")
        body = json.loads(StubHandler.last_body)
        self.assertEqual(body["fields"]["project"]["key"], "PPS")
        self.assertEqual(body["fields"]["issuetype"]["name"], "Chore")
        self.assertEqual(body["fields"]["summary"], "Title")
        self.assertEqual(body["fields"]["labels"], ["a", "b"])
        self.assertEqual(body["fields"]["priority"]["name"], "High")

    def test_create_issue_omits_priority_when_none(self):
        StubHandler.routes["/rest/api/2/issue"] = [(
            201, json.dumps({"key": "PPS-101"}).encode(),
        )]
        c = self._client()
        c.create_issue(
            project_key="PPS", issue_type="Bug",
            summary="t", description="b",
        )
        body = json.loads(StubHandler.last_body)
        self.assertNotIn("priority", body["fields"])

    def test_basic_auth_header_sent(self):
        StubHandler.routes["/rest/api/2/myself"] = [(
            200, b'{"emailAddress":"x@y.com"}',
        )]
        c = self._client()
        c.myself()
        # base64("x@y.com:tok") = "eEB5LmNvbTp0b2s="
        self.assertEqual(
            StubHandler.last_auth, "Basic eEB5LmNvbTp0b2s=",
        )

    def test_assign_sprint_uses_agile_root(self):
        StubHandler.routes["/rest/agile/1.0/sprint/12345/issue"] = [(
            204, b"",
        )]
        c = self._client()
        c.assign_sprint(["PPS-1", "PPS-2"], 12345)
        body = json.loads(StubHandler.last_body)
        self.assertEqual(body["issues"], ["PPS-1", "PPS-2"])

    def test_link_issues_payload(self):
        StubHandler.routes["/rest/api/2/issueLink"] = [(201, b"")]
        c = self._client()
        c.link_issues("PPS-100", "PPS-99", link_type="Relates")
        body = json.loads(StubHandler.last_body)
        self.assertEqual(body["type"]["name"], "Relates")
        self.assertEqual(body["outwardIssue"]["key"], "PPS-100")
        self.assertEqual(body["inwardIssue"]["key"], "PPS-99")

    def test_4xx_raises_jira_api_error(self):
        StubHandler.routes["/rest/api/2/issue"] = [(
            400, json.dumps({"errors": {"issuetype": "invalid"}}).encode(),
        )]
        c = self._client()
        with self.assertRaises(jira_api.JiraAPIError) as ctx:
            c.create_issue(
                project_key="PPS", issue_type="Bogus",
                summary="t", description="b",
            )
        self.assertEqual(ctx.exception.status, 400)
        self.assertIn("issuetype", ctx.exception.body)

    def test_5xx_retried(self):
        StubHandler.routes["/rest/api/2/myself"] = [
            (500, b'{"err":"down"}'),
            (200, b'{"emailAddress":"x@y.com"}'),
        ]
        c = self._client()
        # Should retry once and succeed
        out = c.myself()
        self.assertEqual(out["emailAddress"], "x@y.com")


if __name__ == "__main__":
    unittest.main()
