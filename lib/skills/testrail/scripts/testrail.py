#!/usr/bin/env python3
"""Read-only TestRail client. Credentials stay in memory and curl's stdin."""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote, urlsplit


class Error(Exception):
    pass


def config_file(path):
    """Read the template's flat, non-secret fields without a YAML dependency."""
    try:
        text = Path(path).expanduser().read_text()
    except FileNotFoundError:
        return {}
    except OSError:
        raise Error("Cannot read TestRail config.") from None
    config = {}
    for line in text.splitlines():
        match = re.fullmatch(r"([a-z][a-z0-9_]*):\s*(.*?)\s*", line)
        if match:
            config[match[1]] = match[2].strip("\"'")
    return config


def command(args, timeout, input_text=None):
    # Never echo subprocess output on failure: op/curl diagnostics may contain secrets.
    try:
        environment = {key: value for key, value in os.environ.items() if key != "TESTRAIL_API_KEY"}
        return subprocess.run(args, input=input_text, text=True, capture_output=True,
                              timeout=timeout, check=False, env=environment)
    except FileNotFoundError:
        raise Error(f"Required command not found: {args[0]}.") from None
    except subprocess.TimeoutExpired:
        if args[0] == "op":
            raise Error("1Password locked or not signed in (lookup timed out).") from None
        raise Error(f"{args[0]} timed out.") from None


def op_read(reference, field, timeout):
    result = command(["op", "read", f"{reference}/{field}"], timeout)
    if result.returncode:
        diagnostic = result.stderr.lower()
        if any(word in diagnostic for word in ("not found", "isn't an item", "is not an item",
                                                "does not exist", "invalid secret reference")):
            raise Error("1Password item or field not found; check the vault, item ID, username and password fields.")
        raise Error("1Password locked or not signed in, or item is inaccessible; unlock/sign in and check the item ID.")
    value = result.stdout.rstrip("\r\n")
    if not value:
        raise Error(f"1Password item has an empty {field} field.")
    return value


def base_url(value):
    if not value:
        raise Error("TestRail URL missing; configure host or TESTRAIL_URL.")
    value = value.strip().rstrip("/")
    if "://" not in value:
        value = "https://" + value
    # QA-AI may supply either the instance URL or the API base URL.
    value = re.sub(r"/index\.php\?/api/v2$", "", value)
    try:
        parsed = urlsplit(value)
    except ValueError:
        raise Error("Invalid TestRail URL.") from None
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.query or parsed.fragment
            or any(char.isspace() for char in value)):
        raise Error("TestRail URL must be an HTTPS instance URL without credentials, query or fragment.")
    return value + "/index.php?/api/v2/"


def credentials(config, account, timeout):
    if not re.fullmatch(r"[a-z][a-z0-9_]*", account):
        raise Error("Invalid account name.")
    reference = config.get(f"op_item_{account}")
    if account == "default":
        reference = reference or config.get("op_item")
    elif not reference:
        raise Error(f"Account {account} is not configured; set op_item_{account}.")
    if reference:
        if not re.fullmatch(r"op://[^/\s]+/[a-z0-9]{26}", reference):
            raise Error("op_item must be op://<vault>/<26-character-item-id>, never an item title or field path.")
        base = base_url(config.get("host") or os.environ.get("TESTRAIL_URL"))
        username = op_read(reference, "username", timeout)
        secret = op_read(reference, "password", timeout)
        source = "1Password"
    elif any(os.environ.get(key) for key in ("TESTRAIL_URL", "TESTRAIL_USERNAME", "TESTRAIL_API_KEY")):
        if not all(os.environ.get(key) for key in ("TESTRAIL_URL", "TESTRAIL_USERNAME", "TESTRAIL_API_KEY")):
            raise Error("Incomplete environment credentials; set TESTRAIL_URL, TESTRAIL_USERNAME and TESTRAIL_API_KEY together.")
        base = base_url(os.environ["TESTRAIL_URL"])
        username = os.environ["TESTRAIL_USERNAME"]
        secret = os.environ["TESTRAIL_API_KEY"]
        source = "environment"
    else:
        if not config.get("host") or not config.get("username"):
            raise Error("lib:testrail is not configured; set op_item and host, all three TESTRAIL_* variables, or host and email username for Keychain.")
        base = base_url(config["host"])
        username = config["username"]
        validate_username(username)
        result = command(["security", "find-generic-password", "-s", "testrail", "-a", username, "-w"], timeout)
        secret = result.stdout.rstrip("\r\n")
        if result.returncode or not secret:
            raise Error("No TestRail Keychain key found for the configured email username.")
        source = "Keychain"
    validate_username(username)
    if not secret or any(char in secret for char in "\r\n\x00"):
        raise Error("TestRail secret is empty or contains unsupported control characters.")
    return base, username, secret, source


def validate_username(username):
    if not re.fullmatch(r"[^\s:@]+@[^\s:@]+", username):
        raise Error("TestRail username must be the login email address.")


def curl_quote(value):
    return value.replace("\\", "\\\\").replace('"', '\\"')


def validate_endpoint(endpoint):
    if not re.fullmatch(r"get_[a-z_]+(?:/[0-9]+)?(?:&[a-z_]+=[A-Za-z0-9_%.,+-]*)*", endpoint):
        raise Error("Use a read-only get_* endpoint with numeric IDs and URL-encoded query values.")
    return endpoint


class Client:
    def __init__(self, base, username, secret):
        self.base = base
        self.username = username
        self.secret = secret

    def get(self, endpoint):
        validate_endpoint(endpoint)
        # -q first disables ~/.curlrc (which could enable tracing or redirects).
        # URL and auth both go through stdin. Do not follow redirects with credentials.
        settings = (f'user = "{curl_quote(self.username + ":" + self.secret)}"\n'
                    f'url = "{curl_quote(self.base + endpoint)}"\n')
        for attempt in range(2):
            result = command(["curl", "-q", "--silent", "--show-error", "--path-as-is",
                              "--proto", "=https", "--connect-timeout", "10", "--max-time", "30",
                              "--write-out", "\n%{http_code}", "-K", "-"], 35, settings)
            if result.returncode:
                raise Error("TestRail request failed (network/TLS error or timeout).")
            body, separator, status = result.stdout.rpartition("\n")
            if not separator or not status.isdigit():
                raise Error("Invalid HTTP response from TestRail.")
            status = int(status)
            if status == 429 and attempt == 0:
                print("TestRail rate limited; retrying once in 60 seconds.", file=sys.stderr)
                time.sleep(60)
                continue
            if status == 401:
                raise Error(f"TestRail HTTP 401: authentication rejected for {self.username}; check the selected item's credentials.")
            if status == 403:
                raise Error(f"TestRail HTTP 403: {self.username} lacks permission for {endpoint.split('&')[0]}.")
            if status == 404:
                raise Error(f"TestRail HTTP 404: {endpoint.split('&')[0]} was not found or is inaccessible to {self.username}.")
            if status != 200:
                raise Error(f"TestRail HTTP {status}; request failed.")
            try:
                data = json.loads(body)
            except ValueError:
                raise Error("TestRail returned invalid JSON.") from None
            if isinstance(data, dict) and "error" in data:
                raise Error("TestRail returned an API error; check the selected account and endpoint.")
            return redact(data, self.secret)
        raise Error("TestRail is still rate limited after one retry.")

    def projects(self):
        endpoint = "get_projects"
        projects = []
        seen = set()
        while endpoint:
            if endpoint in seen:
                raise Error("TestRail returned a repeating projects pagination link.")
            seen.add(endpoint)
            data = self.get(endpoint)
            if isinstance(data, list):
                projects.extend(data)
                break
            if not isinstance(data, dict) or not isinstance(data.get("projects"), list):
                raise Error("TestRail returned an invalid projects response.")
            projects.extend(data["projects"])
            links = data.get("_links") or {}
            if not isinstance(links, dict):
                raise Error("TestRail returned invalid projects pagination metadata.")
            next_link = links.get("next")
            if next_link:
                if not isinstance(next_link, str) or not next_link.startswith("/api/v2/get_projects"):
                    raise Error("TestRail returned an unexpected projects pagination link.")
                endpoint = validate_endpoint(next_link.removeprefix("/api/v2/"))
                if endpoint.split("&")[0] != "get_projects":
                    raise Error("TestRail returned an unexpected projects pagination endpoint.")
            else:
                endpoint = None
        return projects


def redact(data, secret):
    """Redact after decoding JSON, including escaped secrets and object keys."""
    if isinstance(data, str):
        return data.replace(secret, "[REDACTED]")
    if isinstance(data, list):
        return [redact(value, secret) for value in data]
    if isinstance(data, dict):
        return {redact(key, secret): redact(value, secret) for key, value in data.items()}
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("endpoint", help="whoami or a quoted get_* endpoint")
    parser.add_argument("--account", default="default", help="config account suffix, e.g. shared")
    parser.add_argument("--config", default="~/.claude/office-testrail.local.md")
    parser.add_argument("--op-timeout", type=float, default=15, help="credential lookup timeout in seconds")
    parser.add_argument("--project", type=int, help="verify visibility of this project ID before reading")
    args = parser.parse_args(argv)
    try:
        if not 0 < args.op_timeout <= 60:
            raise Error("Credential timeout must be greater than zero and at most 60 seconds.")
        if args.endpoint != "whoami":
            validate_endpoint(args.endpoint)
        config = config_file(args.config)
        base, username, secret, source = credentials(config, args.account, args.op_timeout)
        print(f"TestRail account={args.account}, source={source}, login={username}", file=sys.stderr)
        client = Client(base, username, secret)
        user = client.get("get_user_by_email&email=" + quote(username, safe=""))
        projects = client.projects()
        print(f"Authenticated as {username}; {len(projects)} visible projects.", file=sys.stderr)
        project = args.project
        # Project-scoped routes always check membership before requesting data.
        match = re.match(r"get_(?:project|suites|plans|sections|cases|runs|milestones)/(\d+)", args.endpoint)
        if match:
            project = int(match[1])
        if project is not None and not any(p.get("id") == project for p in projects):
            raise Error(f"Authenticated as {username}, which can't see project {project}.")
        if args.endpoint == "whoami":
            data = {"account": args.account, "source": source, "user": user,
                    "project_count": len(projects), "project_ids": [p["id"] for p in projects]}
        elif args.endpoint == "get_projects":
            data = projects
        else:
            data = client.get(args.endpoint)
        print(json.dumps(data, ensure_ascii=False))
        return 0
    except Error as error:
        print(f"lib:testrail: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
