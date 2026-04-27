#!/usr/bin/env python3
"""
acquia_api.py — Lightweight Acquia Cloud API v2 client using stdlib only.

Replaces all `acli` CLI usage in drover with direct REST calls.
Reads credentials from ~/.acquia/cloud_api.conf (same file acli uses).

Usage as a module:
    from acquia_api import AcquiaClient
    client = AcquiaClient()
    envs = client.list_environments("fa5e7770-...")
    client.request_log_download(env_id, "apache-access")

Environment overrides (for tests):
    ACQUIA_CONFIG_PATH    override credential file path
    ACQUIA_TOKEN_URL      override OAuth2 endpoint
    ACQUIA_API_BASE       override Cloud API base URL
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

TOKEN_URL = os.environ.get(
    "ACQUIA_TOKEN_URL",
    "https://accounts.acquia.com/api/auth/oauth/token",
)
API_BASE = os.environ.get(
    "ACQUIA_API_BASE",
    "https://cloud.acquia.com/api",
)

_RETRY_STATUSES = {429, 500, 502, 503, 504}
_MAX_RETRIES = 3
_BACKOFF_BASE = 1.0


class AcquiaAPIError(Exception):
    """Non-retryable Acquia API failure carrying status + parsed error slug.

    `error_slug` comes from the JSON body's `error` field (e.g. 'forbidden_ip',
    'invalid_grant') and lets callers branch on the specific failure mode
    rather than parsing the human-readable message.
    """

    def __init__(self, status: int, url: str, body: str, error_slug: str = ""):
        self.status = status
        self.url = url
        self.body = body
        self.error_slug = error_slug
        super().__init__(f"HTTP {status} ({error_slug or 'unknown'}) from {url}")


def _extract_error_slug(body: str) -> str:
    try:
        parsed = json.loads(body)
        if isinstance(parsed, dict):
            return str(parsed.get("error") or parsed.get("message_key") or "")
    except Exception:
        pass
    return ""


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
            raise AcquiaAPIError(
                status=e.code,
                url=req.full_url,
                body=body,
                error_slug=_extract_error_slug(body),
            ) from e
        except urllib.error.URLError as e:
            if attempt < _MAX_RETRIES - 1:
                time.sleep(_BACKOFF_BASE * (2 ** attempt))
                last_exc = e
                continue
            raise
    if last_exc:
        raise last_exc
    raise RuntimeError("urlopen retry loop exited without result")


class AcquiaClient:
    def __init__(self, config_path: str | None = None):
        path = config_path or os.environ.get(
            "ACQUIA_CONFIG_PATH",
            os.path.expanduser("~/.acquia/cloud_api.conf"),
        )
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"Acquia credentials not found at {path}. "
                "Run /drover:setup to configure API credentials."
            )
        conf = json.load(open(path))
        self._key = conf["acli_key"]
        self._secret = conf["keys"][self._key]["secret"]
        self._token: str | None = None
        self._token_expires: float = 0

    def _get_token(self) -> str:
        if self._token and time.time() < self._token_expires:
            return self._token
        data = urllib.parse.urlencode({
            "client_id": self._key,
            "client_secret": self._secret,
            "grant_type": "client_credentials",
        }).encode()
        req = urllib.request.Request(TOKEN_URL, data=data)
        with _urlopen_with_retry(req, timeout=15) as r:
            body = json.loads(r.read())
        self._token = body["access_token"]
        self._token_expires = time.time() + body.get("expires_in", 300) - 30
        return self._token

    def _get(self, path: str) -> Any:
        token = self._get_token()
        req = urllib.request.Request(
            f"{API_BASE}{path}",
            headers={"Authorization": f"Bearer {token}"},
        )
        with _urlopen_with_retry(req, timeout=30) as r:
            return json.loads(r.read())

    def _post(self, path: str, body: dict | None = None) -> Any:
        token = self._get_token()
        data = json.dumps(body or {}).encode()
        req = urllib.request.Request(
            f"{API_BASE}{path}",
            data=data,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with _urlopen_with_retry(req, timeout=30) as r:
            return json.loads(r.read())

    # --- Applications ---

    def list_applications(self) -> list[dict]:
        resp = self._get("/applications")
        return resp.get("_embedded", {}).get("items", [])

    # --- Environments ---

    def list_environments(self, app_uuid: str) -> list[dict]:
        resp = self._get(f"/applications/{app_uuid}/environments")
        return resp.get("_embedded", {}).get("items", [])

    def resolve_env_id(self, app_uuid: str, env_name: str) -> str:
        envs = self.list_environments(app_uuid)
        match = next((e for e in envs if e["name"] == env_name), None)
        if not match:
            names = [e["name"] for e in envs]
            raise ValueError(
                f"Environment '{env_name}' not found. Available: {names}"
            )
        return match["id"]

    # --- Logs ---

    def list_log_types(self, env_id: str) -> list[dict]:
        resp = self._get(f"/environments/{env_id}/logs")
        return resp.get("_embedded", {}).get("items", [])

    def get_logstream_params(self, env_id: str) -> dict:
        resp = self._get(f"/environments/{env_id}/logstream")
        return resp["logstream"]

    def request_log_download(
        self,
        env_id: str,
        log_type: str,
        from_iso: str | None = None,
        to_iso: str | None = None,
    ) -> dict:
        """POST a log-snapshot request to Acquia.

        Without from_iso/to_iso the snapshot captures the live buffer
        (legacy behavior). With both, Acquia slices a 24-hour window
        anywhere within the last 30 days. Returns a notification envelope
        whose `_links.notification.href` polls until status=completed.
        """
        body: dict = {}
        if from_iso:
            body["from"] = from_iso
        if to_iso:
            body["to"] = to_iso
        return self._post(
            f"/environments/{env_id}/logs/{log_type}",
            body=body or None,
        )

    def check_log_download(self, notification_url: str) -> dict:
        token = self._get_token()
        req = urllib.request.Request(
            notification_url,
            headers={"Authorization": f"Bearer {token}"},
        )
        with _urlopen_with_retry(req, timeout=30) as r:
            return json.loads(r.read())

    def get_log_download_url(self, env_id: str, log_type: str) -> str:
        """Return the presigned S3 URL for the most recently created snapshot.

        GET /environments/{env_id}/logs/{type} responds with a 301 whose
        Location header is the S3 URL. We must NOT follow the redirect with
        the Acquia Bearer header attached — S3 rejects unrecognized auth
        with HTTP 400. Capture Location, return it; the caller GETs S3
        directly with no auth header.

        Caller must invoke this after `check_log_download` reports
        status=completed for the corresponding notification, and before
        the presigned URL's 10-minute TTL expires.
        """
        token = self._get_token()
        req = urllib.request.Request(
            f"{API_BASE}/environments/{env_id}/logs/{log_type}",
            headers={"Authorization": f"Bearer {token}"},
        )

        class _NoRedirect(urllib.request.HTTPRedirectHandler):
            def http_error_301(self, *_args, **_kwargs):  # type: ignore[override]
                return None
            http_error_302 = http_error_303 = http_error_307 = http_error_301

        opener = urllib.request.build_opener(_NoRedirect())
        try:
            r = opener.open(req, timeout=30)
            raise RuntimeError(
                f"expected 301 redirect to S3, got HTTP {r.status}"
            )
        except urllib.error.HTTPError as e:
            if e.code not in (301, 302, 303, 307):
                body = ""
                try:
                    body = e.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
                raise AcquiaAPIError(
                    status=e.code,
                    url=req.full_url,
                    body=body,
                    error_slug=_extract_error_slug(body),
                ) from e
            location = e.headers.get("Location") or e.headers.get("location")
            if not location:
                raise RuntimeError(
                    f"no Location header on HTTP {e.code} from {req.full_url}"
                )
            return location

    # --- Auth verification ---

    def verify_credentials(self) -> bool:
        try:
            self._get_token()
            return True
        except Exception:
            return False


def write_credentials(api_key: str, api_secret: str, path: str | None = None):
    """Write Acquia API credentials in the format acli expects."""
    path = path or os.path.expanduser("~/.acquia/cloud_api.conf")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conf = {}
    if os.path.exists(path):
        try:
            conf = json.load(open(path))
        except Exception:
            pass
    conf["acli_key"] = api_key
    conf.setdefault("keys", {})[api_key] = {"uuid": api_key, "secret": api_secret}
    with open(path, "w") as f:
        json.dump(conf, f, indent=2)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Acquia Cloud API client")
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("verify", help="Verify API credentials")

    p_envs = sub.add_parser("envs", help="List environments for an app")
    p_envs.add_argument("app_uuid")

    p_logs = sub.add_parser("log-types", help="List log types for an environment")
    p_logs.add_argument("app_uuid")
    p_logs.add_argument("env_name")

    p_apps = sub.add_parser("apps", help="List applications")

    args = parser.parse_args()
    client = AcquiaClient()

    if args.cmd == "verify":
        ok = client.verify_credentials()
        print("OK" if ok else "FAILED")
        raise SystemExit(0 if ok else 1)
    elif args.cmd == "apps":
        for app in client.list_applications():
            print(f"  {app['name']:30s}  {app['uuid']}")
    elif args.cmd == "envs":
        for env in client.list_environments(args.app_uuid):
            print(f"  {env['label']:15s}  id={env['id']}  name={env['name']}")
    elif args.cmd == "log-types":
        env_id = client.resolve_env_id(args.app_uuid, args.env_name)
        for lt in client.list_log_types(env_id):
            print(f"  {lt['type']:25s}  {lt.get('label', '')}")
    else:
        parser.print_help()
