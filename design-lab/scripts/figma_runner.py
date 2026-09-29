#!/usr/bin/env python3
"""Serve figma_build.py steps to the design-lab runner plugin, so no model relays a build.

  figma_runner.py serve  --project W [--project W2 ...]   serve in the foreground
  figma_runner.py start  --project W                      reuse a live server, or start one detached
  figma_runner.py status --project W                      whether this run's server is alive

The plugin (design-lab/runner/, imported once into Figma desktop as a development plugin)
asks for the next step with the open file's key; the server picks the run whose target file
(`W/figma/state.json`, or before the build `W/project.json` target) has that key, so one
server drives several runs, each in its own file. The same `next` and `record` commands a
relaying model would call are called here, so the build is identical either way; `skip`
steps are recorded without asking the plugin. Before the build has steps the server answers
`wait`, and the plugin stays open and asks again; at preflight it serves one `check` step that
proves the file is the target, is empty and can be written (the handshake).

It listens on 127.0.0.1:8765, the one address the plugin's manifest allows. Every request
carries `token=T`, a random token kept in `W/figma/runner-token` (mode 600), which the plugin
asks for once and keeps; a restarted server reuses it, so a restart never needs the person.
Without it a web page that learned a file key could read steps or forge results. Cross-origin
reads are allowed only for the `null` origin of a plugin iframe.

  GET  /health?token=T                         the projects this server serves, and its process id
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
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
BUILD = HERE / "figma_build.py"
PORT = 8765  # runner/manifest.json and runner/code.js allow this port and no other
ORIGIN = "null"  # a Figma plugin's fetch comes from a sandboxed iframe with an opaque origin
DRIVER_TIMEOUT = 900  # seconds; longer than figma_build.py's own 600-second image fetch
WAIT_MS = 5000  # how long the plugin pauses before asking again while there is nothing to build
TOKEN_FILE = "runner-token"
PID_FILE = "runner.pid"
SERVER_LOG = "runner-server.log"
HANDSHAKE_REQUEST = "handshake-request.json"
HANDSHAKE = "handshake.json"
CHECK_STEP = "preflight:check"
PAGE_STEP = "preflight:page"
COVER_STEP = "preflight:cover"
HANDSHAKE_STEPS = (CHECK_STEP, PAGE_STEP, COVER_STEP)
# Preflight proves the file can be written by drawing a name-only Cover through the real render
# path, in three steps. First, which file is open and whether it is empty (one page with nothing
# on it) or holds only the preflight Cover this run drew before (the same page id, with nothing
# on it but the node tagged as the Cover). Nothing is written by this step.
CHECK_CODE = """
const expected = __EXPECTED__;
const pages = figma.root.children;
let empty = false, preflightCover = false;
if (pages.length === 1) {
  await pages[0].loadAsync();
  const kids = pages[0].children;
  empty = kids.length === 0;
  preflightCover = !empty && pages[0].id === expected
    && kids.every((n) => n.getSharedPluginData('designlab', 'role') === 'cover');
}
return { fileKey: figma.fileKey, fileName: figma.root.name, pages: pages.length, empty, preflightCover };
"""
# Second, the file's first page becomes the Cover page, keyed as pages.js keys it, so the build's
# pages step reuses it rather than adding a second Cover page.
PAGE_CODE = """
const page = figma.root.children[0];
await page.loadAsync();
page.name = 'Cover';
page.setSharedPluginData('designlab', 'page', 'Cover');
return { pageId: page.id };
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def figma_dir(project: Path) -> Path:
    folder = Path(project) / "figma"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def load_or_create_token(projects: list[Path]) -> str:
    """The runner token, kept in each run's figma/runner-token (mode 600). A restarted server
    reads it back, so the plugin's saved token keeps working and nobody pastes it again."""
    token = next((f.read_text().strip() for f in (Path(p) / "figma" / TOKEN_FILE for p in projects)
                  if f.is_file() and f.read_text().strip()), None) or secrets.token_urlsafe(16)
    for project in projects:
        path = figma_dir(project) / TOKEN_FILE
        if not path.is_file() or path.read_text().strip() != token:
            path.write_text(token + "\n")
        os.chmod(path, 0o600)
    return token


def write_handshake(project: Path, result: dict) -> None:
    """The handshake's outcome, which preflight waits for; the request is then answered."""
    folder = figma_dir(project)
    (folder / HANDSHAKE).write_text(json.dumps({"at": utc_now(), **result}, indent=1) + "\n")
    (folder / HANDSHAKE_REQUEST).unlink(missing_ok=True)


def check_outcome(target: str, result: dict) -> dict:
    """Judge the check step: the target file, and empty or holding only this run's preflight
    Cover. Writing is proved by the steps that follow."""
    outcome = {"runnerConnected": True, "fileKey": result.get("fileKey"), "fileName": result.get("fileName"),
               "fileKeyMatches": result.get("fileKey") == target,
               "empty": bool(result.get("empty") or result.get("preflightCover")),
               "onlyPreflightCover": bool(result.get("preflightCover"))}
    if not outcome["fileKeyMatches"]:
        failure = (f"the runner is open in a different file ({result.get('fileName')!r}, key {result.get('fileKey')}); "
                   f"open the target file (key {target}) in Figma desktop and start the runner there")
    elif not outcome["empty"]:
        failure = (f"the target file {result.get('fileName')!r} is not empty ({result.get('pages')} page(s), or content "
                   "on its first page that this run's preflight did not draw); give the run a new, empty Figma file")
    else:
        failure = None
    return {**outcome, "ok": failure is None, **({"failure": failure} if failure else {})}


def handshake_request(project: Path) -> dict:
    path = Path(project) / "figma" / HANDSHAKE_REQUEST
    return json.loads(path.read_text()) if path.is_file() else {}


class Build:
    """One workspace: its current step, and a lock so a file is driven by one loop at a time."""

    def __init__(self, project: Path):
        self.project = project
        self.lock = threading.Lock()
        self.current: dict | None = None

    @property
    def state(self) -> dict:
        return json.loads((self.project / "figma" / "state.json").read_text())

    @property
    def key(self) -> str | None:
        """The target file: the build's, once figma_build.py init has run, else the run's target."""
        state = self.project / "figma" / "state.json"
        if state.is_file():
            return json.loads(state.read_text()).get("fileKey")
        manifest = self.project / "project.json"
        target = (json.loads(manifest.read_text()).get("target") or {}) if manifest.is_file() else {}
        return target.get("figmaFileKey")

    def handshake_pending(self) -> bool:
        return (self.project / "figma" / HANDSHAKE_REQUEST).is_file()

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
        if self.handshake_pending():
            self.current = self.handshake_step()
            self.log(f"serving {self.current['step']}")
            return self.current
        if not (self.project / "figma" / "state.json").is_file():
            # Nothing to build yet: the plugin stays open, shows it is connected, and asks again.
            return {"kind": "wait", "step": "wait", "retryMs": WAIT_MS,
                    "message": "Connected. Waiting for the build to start."}
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

    def handshake_step(self) -> dict:
        """The next preflight step: check the file, claim its first page as the Cover page, then
        draw the name-only Cover there with the real cover.js."""
        request = handshake_request(self.project)
        stage = request.get("stage", "check")
        if stage == "check":
            expected = json.dumps(request.get("expectedCoverPageId"))
            return {"kind": "check", "step": CHECK_STEP, "code": CHECK_CODE.replace("__EXPECTED__", expected)}
        if stage == "page":
            return {"kind": "check", "step": PAGE_STEP, "code": PAGE_CODE}
        import render_payload
        args = {**request["cover"], "pageId": request["pageId"], "tiers": []}
        return {"kind": "check", "step": COVER_STEP, "code": render_payload.call_payload("cover", args)}

    def handshake_record(self, step: str, result: dict) -> dict:
        request = handshake_request(self.project)
        path = self.project / "figma" / HANDSHAKE_REQUEST
        if step == CHECK_STEP:
            outcome = check_outcome(self.key, result)
            if not outcome["ok"]:
                write_handshake(self.project, outcome)
            else:
                path.write_text(json.dumps({**request, "stage": "page", "check": outcome}) + "\n")
        elif step == PAGE_STEP:
            path.write_text(json.dumps({**request, "stage": "cover", "pageId": result.get("pageId")}) + "\n")
            outcome = {"ok": True}
        else:
            outcome = {**request.get("check", {}), "ok": bool(result.get("coverId")) and bool(result.get("pluginData")),
                       "writable": bool(result.get("coverId")), "coverPageId": result.get("pageId") or request.get("pageId"),
                       "coverId": result.get("coverId"), "font": result.get("font"),
                       "fontLoaded": bool(result.get("fontLoaded")), "pluginData": bool(result.get("pluginData"))}
            if not outcome["ok"]:
                outcome["failure"] = ("the name-only Cover was drawn but its plugin data did not read back; "
                                      "the file may not accept design-lab's data")
            write_handshake(self.project, outcome)
        self.current = None
        self.log(f"recorded {step}: {'ok' if outcome['ok'] else outcome['failure']}")
        return {"recorded": step}

    def handshake_error(self, message: str) -> None:
        """A preflight step failed in Figma: stop the handshake with the exact cause."""
        step = (self.current or {}).get("step")
        what = {CHECK_STEP: "the target file could not be inspected",
                PAGE_STEP: "the Cover page could not be created",
                COVER_STEP: "the name-only Cover could not be drawn"}.get(step, "the preflight check failed")
        write_handshake(self.project, {"runnerConnected": True, "ok": False, "writable": False,
                                       "failure": f"{what}: {message}"})
        self.current = None

    def resume(self, step: str) -> dict | None:
        """After a server restart, the step the plugin is finishing is still the build's next one."""
        if not (self.project / "figma" / "state.json").is_file():
            return None
        try:
            pending = self.driver("next")
        except (RuntimeError, ValueError, subprocess.TimeoutExpired):
            return None
        if pending.get("step") == step and pending["kind"] not in ("skip", "done"):
            self.current = pending
        elif pending["kind"] == "done":
            dump = self.dump_step()
            if dump and dump["step"] == step:
                self.current = dump
        return self.current

    def file(self, step: str, i: int) -> tuple[bytes, str]:
        cur = self.current
        if not cur or cur["step"] != step or cur["kind"] != "upload":
            raise RuntimeError(f"{step} is not the current upload step")
        f = cur["files"][i]
        return Path(f["file"]).read_bytes(), f["contentType"]

    def record(self, step: str, result: dict) -> dict:
        cur = self.current
        if (not cur or cur["step"] != step) and step not in HANDSHAKE_STEPS:
            # A restarted server has lost the step it served; figma_build.py's state has not.
            cur = self.resume(step)
        if not cur or cur["step"] != step:
            raise RuntimeError(f"{step} is not the current step")
        if cur["kind"] == "check":
            return self.handshake_record(step, result)
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


def find_build(builds: dict[str, Build], key: str) -> Build | None:
    return builds.get(key) or next((b for b in builds.values() if b.key == key), None)


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
                for b in builds.values():   # a handshake in progress reports the rejected token
                    if b.handshake_pending() and q.get("fileKey") in (b.key, None, ""):
                        write_handshake(b.project, {"runnerConnected": True, "ok": False, "fileKey": q.get("fileKey"),
                                                    "failure": "the runner's token was rejected; paste the token "
                                                               "preflight printed into the runner, then run preflight again"})
                return self.reply(401, b"missing or wrong runner token; use the one preflight or figma_runner.py printed", "text/plain")
            if url.path == "/health":
                return self.reply(200, json.dumps({"pid": os.getpid(), "projects": [str(b.project) for b in builds.values()],
                                                   "files": [b.key for b in builds.values()]}).encode())
            build = find_build(builds, q.get("fileKey", ""))
            if not build:
                for b in builds.values():   # the runner was started in a file that is not the target
                    if b.handshake_pending():
                        write_handshake(b.project, {"runnerConnected": True, "ok": False, "fileKey": q.get("fileKey"),
                                                    "fileKeyMatches": False,
                                                    "failure": f"the runner is open in a different file (key {q.get('fileKey')}); "
                                                               f"open the target file (key {b.key}) in Figma desktop and "
                                                               "start the runner there"})
                return self.reply(404, f"no build for file {q.get('fileKey')!r}; serving {sorted(b.key or '?' for b in builds.values())}".encode(), "text/plain")
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
                        if (build.current or {}).get("kind") == "check" and build.handshake_pending():
                            build.handshake_error(str(body.get("message", body)))
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
        key = b.key
        if not key:
            raise SystemExit(f"{b.project} has no target Figma file yet; record it with workflow.py preflight")
        if key in builds and builds[key].project != b.project:
            raise SystemExit(f"{builds[key].project} and {b.project} both build file {key}; "
                             "serve one of them, or give each its own file")
        builds[key] = b
    return builds


def health(token: str, timeout: float = 2) -> dict | None:
    """What the server on 127.0.0.1:8765 serves, if one answers with this token."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health?token={token}", timeout=timeout) as res:
            return json.loads(res.read())
    except (urllib.error.URLError, OSError, ValueError):
        return None


def port_in_use() -> bool:
    with socket.socket() as sock:
        sock.settimeout(1)
        return sock.connect_ex(("127.0.0.1", PORT)) == 0


def server_status(project: Path) -> dict:
    """Whether a server is alive and serving this run, from its pid file and its answer."""
    project = Path(project).resolve()
    folder = project / "figma"
    token = (folder / TOKEN_FILE).read_text().strip() if (folder / TOKEN_FILE).is_file() else None
    pid = int((folder / PID_FILE).read_text()) if (folder / PID_FILE).is_file() else None
    answer = health(token) if token else None
    serving = bool(answer) and str(project) in answer.get("projects", [])
    return {"alive": serving, "pid": (answer or {}).get("pid", pid), "portInUse": serving or port_in_use(),
            "log": str(folder / SERVER_LOG)}


def ensure_server(project: Path, wait: float = 10) -> dict:
    """Reuse the server serving this run, or start one detached with the run's stored token. It
    outlives the command that started it: its own session, its pid in figma/runner.pid and its
    output in figma/runner-server.log."""
    project = Path(project).resolve()
    token = load_or_create_token([project])
    status = server_status(project)
    if status["alive"]:
        return {**status, "token": token, "started": False}
    if status["portInUse"]:
        raise RuntimeError(f"127.0.0.1:{PORT} is in use by another program or another run's server; stop it "
                           "(or serve both runs from one server with figma_runner.py serve --project A --project B)")
    folder = figma_dir(project)
    # The log carries the token the server prints, so only this user can read it.
    with os.fdopen(os.open(folder / SERVER_LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600), "a") as log:
        os.chmod(folder / SERVER_LOG, 0o600)
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "serve", "--project", str(project)],
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True, close_fds=True)
    (folder / PID_FILE).write_text(f"{process.pid}\n")
    deadline = time.monotonic() + wait
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"the runner server exited at once; see {folder / SERVER_LOG}")
        if server_status(project)["alive"]:
            return {**server_status(project), "token": token, "started": True}
        time.sleep(0.2)
    raise RuntimeError(f"the runner server did not answer within {wait:g} seconds; see {folder / SERVER_LOG}")


def request_handshake(project: Path, cover: dict | None = None, expected_cover_page: str | None = None) -> None:
    """Ask the server to run the handshake the next time the runner asks for a step. `cover`
    holds the name-only Cover's arguments (ground, headline, subtitle, provenance, version)."""
    folder = figma_dir(Path(project))
    (folder / HANDSHAKE).unlink(missing_ok=True)
    (folder / HANDSHAKE_REQUEST).write_text(json.dumps({
        "requestedAt": utc_now(), "stage": "check", "expectedCoverPageId": expected_cover_page,
        "cover": cover or {"ground": "#001B67", "headline": "Library", "subtitle": "Component Library",
                           "provenance": {"stage": "preflight"}, "version": ""}}) + "\n")


def wait_for_handshake(project: Path, timeout: float, poll: float = 1) -> dict:
    """The handshake's outcome, or a timeout failure; the request is withdrawn either way."""
    folder = figma_dir(Path(project))
    deadline = time.monotonic() + timeout
    while True:
        if (folder / HANDSHAKE).is_file():
            return json.loads((folder / HANDSHAKE).read_text())
        if time.monotonic() >= deadline:
            (folder / HANDSHAKE_REQUEST).unlink(missing_ok=True)
            return {"at": utc_now(), "runnerConnected": False, "ok": False,
                    "failure": f"no runner connected within {timeout:g} seconds; open the target file in Figma "
                               "desktop, start the design-lab runner (Plugins, Development, design-lab runner), "
                               "and run preflight again"}
        time.sleep(poll)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--project", action="append", required=True)
    for name in ("start", "status"):
        sub.add_parser(name).add_argument("--project", required=True)
    ns = ap.parse_args()
    if ns.cmd == "status":
        print(json.dumps(server_status(Path(ns.project)), indent=2))
        return 0
    if ns.cmd == "start":
        try:
            print(json.dumps(ensure_server(Path(ns.project)), indent=2))
        except RuntimeError as error:
            print(f"error: {error}", file=sys.stderr)
            return 1
        return 0
    builds = load_builds(ns.project)
    for key, b in builds.items():
        print(f"serving {b.project} for file {key}", flush=True)
    token = load_or_create_token([b.project for b in builds.values()])
    print(f"runner token: {token}\n(kept in each run's figma/{TOKEN_FILE}; a restarted server reuses it)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), make_handler(builds, token)).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
