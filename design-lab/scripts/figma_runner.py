#!/usr/bin/env python3
"""Serve figma_build.py steps to the design-lab runner plugin, so no model relays a build.

  figma_runner.py serve --project W [--project W2 ...]

The plugin (design-lab/runner/, imported once into Figma desktop as a development plugin)
asks for the next step with the open file's key; the server picks the build whose
`W/figma/state.json` has that key, so one server drives several runs, each in its own file.
The same `next` and `record` commands a relaying model would call are called here, so the
build is identical either way; `skip` steps are recorded without asking the plugin.

It listens on 127.0.0.1:8765, the one address the plugin's manifest allows. Every request
carries `token=T`, a random token printed when the server starts, which the plugin asks for
once and keeps; without it a web page that learned a file key could read steps or forge
results. Cross-origin reads are allowed only for the `null` origin of a plugin iframe.

  GET  /next?fileKey=K&token=T                 next step; use_figma steps carry their code inline
  GET  /file?fileKey=K&step=S&i=N&token=T      bytes of the Nth file of an upload step
  POST /record?fileKey=K&step=S&token=T        the step's result (a screenshot arrives as base64 PNG)
  POST /error?fileKey=K&token=T                a failed step, logged to W/figma/runner.log
"""
from __future__ import annotations

import argparse
import base64
import hmac
import json
import secrets
import subprocess
import sys
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
BUILD = HERE / "figma_build.py"
PORT = 8765  # runner/manifest.json and runner/code.js allow this port and no other
ORIGIN = "null"  # a Figma plugin's fetch comes from a sandboxed iframe with an opaque origin
DRIVER_TIMEOUT = 900  # seconds; longer than figma_build.py's own 600-second image fetch


class Build:
    """One workspace: its current step, and a lock so a file is driven by one loop at a time."""

    def __init__(self, project: Path):
        self.project = project
        self.lock = threading.Lock()
        self.current: dict | None = None

    @property
    def state(self) -> dict:
        return json.loads((self.project / "figma" / "state.json").read_text())

    def driver(self, *args: str) -> dict:
        p = subprocess.run([sys.executable, str(BUILD), *args, "--project", str(self.project)],
                           capture_output=True, text=True, timeout=DRIVER_TIMEOUT)
        if p.returncode != 0:
            raise RuntimeError((p.stderr or p.stdout).strip() or f"figma_build.py {args[0]} failed")
        return json.loads(p.stdout)

    def log(self, line: str) -> None:
        with (self.project / "figma" / "runner.log").open("a") as f:
            f.write(f"{datetime.now().isoformat(timespec='seconds')} {line}\n")
        print(f"[{self.project.name}] {line}", flush=True)

    def next(self) -> dict:
        while True:
            step = self.driver("next")
            if step["kind"] != "skip":
                break
            self.driver("record", "--step", step["step"])
            self.log(f"skipped {step['step']}: {step.get('reason', '')}")
        if step["kind"] == "done":
            step = self.dump_step() or step
            self.current = step
            if step["kind"] == "dump":
                self.log(f"serving {step['step']}")
            return step
        state = self.state
        step.update(done=len(state["done"]), total=len(state["steps"]))
        self.current = step
        self.log(f"serving {step['step']} ({step['done'] + 1}/{step['total']})")
        if step["kind"] == "use_figma":
            step = {k: v for k, v in step.items() if k != "payload"} | {"code": Path(step["payload"]).read_text()}
        elif step["kind"] == "upload":
            step = {k: v for k, v in step.items() if k != "files"}
        return step

    def dump_step(self) -> dict | None:
        """After the build, export each design-lab page's node tree to W/figma/dump/ so
        compare_runs.py can compare runs; one page per step, skipped once written."""
        pages = json.loads((self.project / "figma" / "results" / "pages.json").read_text())["pages"]
        out = self.project / "figma" / "dump"
        for name, page_id in sorted(pages.items()):
            target = out / f"{name.replace('/', '-')}.json"
            if not target.exists():
                code = (HERE / "figma_dump_tree.js").read_text().replace("__PAGE_ID__", page_id)
                return {"kind": "dump", "step": f"dump:{name}", "code": code, "out": str(target)}
        return None

    def file(self, step: str, i: int) -> tuple[bytes, str]:
        cur = self.current
        if not cur or cur["step"] != step or cur["kind"] != "upload":
            raise RuntimeError(f"{step} is not the current upload step")
        f = cur["files"][i]
        return Path(f["file"]).read_bytes(), f["contentType"]

    def record(self, step: str, result: dict) -> dict:
        cur = self.current
        if not cur or cur["step"] != step:
            raise RuntimeError(f"{step} is not the current step")
        if cur["kind"] == "dump":
            Path(cur["out"]).parent.mkdir(exist_ok=True)
            Path(cur["out"]).write_text(json.dumps(result, indent=1, sort_keys=True) + "\n")
            self.current = None
            self.log(f"recorded {step}")
            return {"recorded": step}
        if cur["kind"] == "screenshot":
            Path(cur["out"]).write_bytes(base64.b64decode(result["png"]))
            result = {"file": cur["out"]}
        inbox = self.project / "figma" / "inbox.json"
        inbox.write_text(json.dumps(result))
        out = self.driver("record", "--step", step, "--result", str(inbox))
        self.current = None
        self.log(f"recorded {step} ({out['remaining']} remaining)")
        return out


def make_handler(builds: dict[str, Build], token: str):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):  # the builds log their own progress
            pass

        def reply(self, status: int, body: bytes, ctype: str = "application/json") -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", ORIGIN)
            self.end_headers()
            self.wfile.write(body)

        def route(self, method: str) -> None:
            url = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            origin = self.headers.get("Origin")
            if origin is not None and origin != ORIGIN:
                return self.reply(403, f"origin {origin} is not a Figma plugin".encode(), "text/plain")
            if not hmac.compare_digest(q.get("token", "").encode(), token.encode()):
                return self.reply(401, b"missing or wrong runner token; use the one figma_runner.py printed", "text/plain")
            build = builds.get(q.get("fileKey", ""))
            if not build:
                return self.reply(404, f"no build for file {q.get('fileKey')!r}; serving {sorted(builds)}".encode(), "text/plain")
            with build.lock:
                try:
                    body = None
                    if method == "POST":
                        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                        if not isinstance(body, dict):
                            raise ValueError("the request body must be a JSON object")
                    if method == "GET" and url.path == "/next":
                        return self.reply(200, json.dumps(build.next()).encode())
                    if method == "GET" and url.path == "/file":
                        data, ctype = build.file(q["step"], int(q["i"]))
                        return self.reply(200, data, ctype)
                    if method == "POST" and url.path == "/record":
                        return self.reply(200, json.dumps(build.record(q["step"], body)).encode())
                    if method == "POST" and url.path == "/error":
                        build.log(f"FAILED {body.get('message', body)}")
                        return self.reply(200, b"{}")
                    return self.reply(404, b"unknown route", "text/plain")
                except Exception as e:  # reported to the plugin, which stops without recording
                    build.log(f"error: {e}")
                    return self.reply(500, str(e).encode(), "text/plain")

        def do_OPTIONS(self):  # preflight, in case a client sends a non-simple request
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", ORIGIN)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self):
            self.route("GET")

        def do_POST(self):
            self.route("POST")

    return Handler


def load_builds(projects: list[str]) -> dict[str, Build]:
    """One Build per file key. Two workspaces naming the same file would take turns writing
    into it, so that is refused rather than letting the later one silently win."""
    builds: dict[str, Build] = {}
    for p in projects:
        b = Build(Path(p).resolve())
        key = b.state["fileKey"]
        if key in builds and builds[key].project != b.project:
            raise SystemExit(f"{builds[key].project} and {b.project} both build file {key}; "
                             "serve one of them, or give each its own file")
        builds[key] = b
    return builds


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--project", action="append", required=True)
    ns = ap.parse_args()
    builds = load_builds(ns.project)
    for key, b in builds.items():
        print(f"serving {b.project} for file {key}", flush=True)
    token = secrets.token_urlsafe(16)
    print(f"runner token: {token}\n(the plugin asks for it once; a restarted server prints a new one)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), make_handler(builds, token)).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
