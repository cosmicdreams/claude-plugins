"""drover.jira_api — stdlib-only Atlassian Cloud REST client.

Mirrors the design of scripts/monitors/acquia_api.py: pure urllib,
configurable via env vars + the same jira-cli config files most
operators already have, plus drover's per-project manifest for
project/board/sprint context.

Credential resolution order (most-specific first):
  1. JIRA_API_TOKEN env (token from id.atlassian.com)
  2. ~/.drover/jira.json (drover-specific user config; future-friendly)
  3. ~/.config/.jira/.config.yml (jira-cli's default; has server + login)

If multiple JIRA Cloud instances are in play (e.g. velir + a client's
own tenant), drover prefers per-project overrides in the project's
manifest.jira block (server, email).
"""
from __future__ import annotations

import base64
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


_RETRY_STATUSES = {429, 500, 502, 503, 504}
_MAX_RETRIES = 3
_BACKOFF_BASE = 1.0


class JiraAPIError(Exception):
    """Non-retryable JIRA API failure with parsed body for diagnosis."""

    def __init__(self, status: int, url: str, body: str):
        self.status = status
        self.url = url
        self.body = body
        super().__init__(f"HTTP {status} from {url}: {body[:200]}")


# --- Tiny YAML reader (stdlib-only) for the jira-cli config -------------
# We need only `server:` and `login:` from a flat top-level section, so
# a line-based reader is enough — we don't pull PyYAML.

def _read_jira_cli_config(path: Path) -> dict:
    if not path.exists():
        return {}
    out: dict = {}
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return {}
    for line in text.splitlines():
        m = re.match(r"^([a-z_]+):\s*(\S.*)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        # Strip surrounding quotes if present
        if val and val[0] in ("'", '"') and val[-1] == val[0]:
            val = val[1:-1]
        out[key] = val
    return out


# --- Credential resolution ----------------------------------------------

def resolve_credentials(
    manifest_jira: dict | None = None,
    *,
    cli_config_path: Path | None = None,
    drover_config_path: Path | None = None,
) -> dict:
    """Return {server, email, token} or raise FileNotFoundError.

    Sources, most-specific first:
      - manifest.jira.server / manifest.jira.email override everything
      - $JIRA_API_TOKEN env var (token only)
      - ~/.drover/jira.json (server, email, token)
      - ~/.config/.jira/.config.yml (server, login)
    """
    manifest_jira = manifest_jira or {}
    if cli_config_path is None:
        cli_config_path = Path.home() / ".config" / ".jira" / ".config.yml"
    if drover_config_path is None:
        drover_config_path = Path.home() / ".drover" / "jira.json"

    drover_user: dict = {}
    if drover_config_path.exists():
        try:
            drover_user = json.loads(drover_config_path.read_text())
        except (OSError, json.JSONDecodeError):
            drover_user = {}

    cli = _read_jira_cli_config(cli_config_path)

    server = (
        manifest_jira.get("server")
        or drover_user.get("server")
        or cli.get("server")
    )
    email = (
        manifest_jira.get("email")
        or drover_user.get("email")
        or cli.get("login")
    )
    token = (
        os.environ.get("JIRA_API_TOKEN")
        or drover_user.get("token")
    )

    missing = [k for k, v in (("server", server),
                              ("email", email),
                              ("token", token)) if not v]
    if missing:
        raise FileNotFoundError(
            f"JIRA credential resolution failed; missing: {missing}. "
            "Either set JIRA_API_TOKEN + ensure ~/.config/.jira/.config.yml "
            "has server + login, or write ~/.drover/jira.json with "
            "{server, email, token}."
        )

    return {"server": server.rstrip("/"), "email": email, "token": token}


# --- HTTP client --------------------------------------------------------

def _basic_auth_header(email: str, token: str) -> str:
    raw = f"{email}:{token}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def _urlopen_with_retry(req: urllib.request.Request, timeout: int):
    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:
                body = ""
            if e.code in _RETRY_STATUSES and attempt < _MAX_RETRIES - 1:
                time.sleep(_BACKOFF_BASE * (2 ** attempt))
                last_exc = e
                continue
            raise JiraAPIError(
                status=e.code, url=req.full_url, body=body,
            ) from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            if attempt < _MAX_RETRIES - 1:
                time.sleep(_BACKOFF_BASE * (2 ** attempt))
                last_exc = e
                continue
            raise
    if last_exc:
        raise last_exc
    raise RuntimeError("urlopen retry loop exited without result")


class JiraClient:
    """Thin REST client. All methods raise JiraAPIError on 4xx, retry
    transient 5xx with exponential backoff."""

    def __init__(self, creds: dict | None = None,
                 manifest_jira: dict | None = None):
        creds = creds or resolve_credentials(manifest_jira)
        self.server = creds["server"]
        self.email = creds["email"]
        self.token = creds["token"]
        self._auth_header = _basic_auth_header(self.email, self.token)

    # --- HTTP plumbing ---

    def _request(
        self,
        method: str,
        path: str,
        body: dict | None = None,
        *,
        api_root: str = "/rest/api/2",
    ) -> Any:
        url = f"{self.server}{api_root}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Authorization": self._auth_header,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method=method,
        )
        with _urlopen_with_retry(req, timeout=30) as r:
            raw = r.read()
            if not raw:
                return {}
            return json.loads(raw)

    # --- Diagnostics ---

    def myself(self) -> dict:
        """GET /myself — verifies auth + returns the authenticated user."""
        return self._request("GET", "/myself")

    # --- Issue creation ---

    def create_issue(
        self,
        *,
        project_key: str,
        issue_type: str,
        summary: str,
        description: str,
        labels: list[str] | None = None,
        priority: str | None = None,
        extra_fields: dict | None = None,
    ) -> dict:
        """POST /issue. Returns {id, key, self}."""
        fields: dict = {
            "project": {"key": project_key},
            "summary": summary,
            "description": description,
            "issuetype": {"name": issue_type},
        }
        if labels:
            fields["labels"] = list(labels)
        if priority:
            fields["priority"] = {"name": priority}
        if extra_fields:
            fields.update(extra_fields)
        return self._request("POST", "/issue", body={"fields": fields})

    def link_issues(
        self,
        from_key: str,
        to_key: str,
        link_type: str = "Relates",
    ) -> dict:
        """POST /issueLink. Atlassian-defined link types include
        'Relates', 'Blocks', 'Cloners', 'Duplicate'."""
        return self._request(
            "POST", "/issueLink",
            body={
                "type": {"name": link_type},
                "inwardIssue": {"key": to_key},
                "outwardIssue": {"key": from_key},
            },
        )

    # --- Sprint management ---

    def assign_sprint(
        self, issue_keys: list[str], sprint_id: int,
    ) -> dict:
        """POST /sprint/{id}/issue on the agile API."""
        return self._request(
            "POST", f"/sprint/{sprint_id}/issue",
            body={"issues": issue_keys},
            api_root="/rest/agile/1.0",
        )

    def list_sprints(
        self, board_id: int, *, state: str = "active,future",
    ) -> list[dict]:
        """GET /board/{id}/sprint?state=...."""
        resp = self._request(
            "GET", f"/board/{board_id}/sprint?state={state}",
            api_root="/rest/agile/1.0",
        )
        return resp.get("values", [])

    def find_active_sprint(self, board_id: int) -> dict | None:
        """Return the currently-active sprint for a board, or None."""
        sprints = self.list_sprints(board_id, state="active")
        return sprints[0] if sprints else None

    # --- Issue lookup ---

    def get_issue_types(self, project_key: str) -> list[str]:
        """Return the names of issue types valid for the project."""
        proj = self._request("GET", f"/project/{project_key}")
        return [t.get("name") for t in proj.get("issueTypes", []) if t.get("name")]
