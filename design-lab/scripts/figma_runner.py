#!/usr/bin/env python3
"""Serve figma_build.py steps to the design-lab runner plugin, so no model relays a build.

  figma_runner.py serve  --project W   serve one run in the foreground
  figma_runner.py start  --project W   reuse this run's live server, or start one detached
  figma_runner.py status --project W   whether this run's server is alive
  figma_runner.py stop   --project W   stop this run's server

The plugin (design-lab/runner/, imported once into Figma desktop as a development plugin)
asks for the next step with the open file's key. One server serves exactly one run: design-lab
builds one library at a time, which gives Figma desktop its best results, so a second run's
server is refused while one is active. The run's target file is `W/figma/state.json`'s, or before
the build the `W/project.json` target. The same `next` and `record` commands a
relaying model would call are called here, so the build is identical either way; `skip`
steps are recorded without asking the plugin. Before the build has steps the server answers
`wait`, and the plugin stays open and asks again; at preflight it serves one `check` step that
proves the file is the target, is empty and can be written (the handshake).

It listens on 127.0.0.1:8765, the one address the plugin's manifest allows. Every request
carries `token=T`, the person's runner token in `~/.design-lab/runner-token` (mode 600), which
the plugin asks for once per machine and keeps; every server reads the same file, so a restart
or a new run never needs the person, and the token is never written into a run or a log. Its
only job is to stop a web page in the person's browser from talking to this server. Requests
also carry the runner's `version`; a runner older than this plugin is told it is outdated.
Cross-origin reads are allowed only for the `null` origin of a plugin iframe.

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
# The person's own design-lab folder: their runner token, and the stable copy of the runner that
# Figma desktop imports once, so a plugin update needs only a restart of the runner.
HOME = Path(os.environ.get("DESIGN_LAB_HOME") or Path.home() / ".design-lab")
TOKEN_FILE = "runner-token"
RUNNER_SOURCE = HERE.parent / "runner"
PID_FILE = "runner.pid"
SEEN_FILE = "runner-seen"
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


def person_token() -> str:
    """The person's runner token, created once in ~/.design-lab/runner-token (folder mode 700,
    file mode 600). Every server reads it, so the runner's saved copy keeps working across
    restarts and runs, and the person pastes it once per machine. The value is for this
    process's own use (the server's check, and its own /health call): it is never printed,
    no command-line path of this module outputs it, and no caller may print or log it."""
    HOME.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(HOME, 0o700)
    path = HOME / TOKEN_FILE
    if not path.is_file() or not path.read_text().strip():
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(secrets.token_urlsafe(16) + "\n")
    os.chmod(path, 0o600)
    return path.read_text().strip()


def plugin_version() -> str:
    manifest = HERE.parent / ".claude-plugin" / "plugin.json"
    return json.loads(manifest.read_text()).get("version", "0") if manifest.is_file() else "0"


def version_tuple(value: str | None) -> tuple:
    try:
        return tuple(int(part) for part in str(value).split("."))
    except ValueError:
        return ()


def outdated(runner_version: str | None) -> bool:
    return version_tuple(runner_version) < version_tuple(plugin_version())


def install_runner() -> dict:
    """Copy the runner into ~/.design-lab/runner/, the stable folder Figma desktop imports it
    from once. Its code carries this plugin's version, which it sends with every request.
    Later versions refresh these files; the person only restarts the runner."""
    target = HOME / "runner"
    first = not (target / "manifest.json").is_file()
    target.mkdir(parents=True, exist_ok=True)
    version = plugin_version()
    changed = False
    for source in sorted(RUNNER_SOURCE.iterdir()):
        if source.suffix not in (".json", ".js", ".html"):
            continue
        text = source.read_text()
        if source.name == "code.js":
            text = text.replace("const RUNNER_VERSION = 'source';", f"const RUNNER_VERSION = '{version}';")
        if not (target / source.name).is_file() or (target / source.name).read_text() != text:
            (target / source.name).write_text(text)
            changed = True
    return {"folder": str(target), "manifest": str(target / "manifest.json"), "version": version,
            "firstInstall": first, "updated": changed and not first}


def outdated_message(version: str) -> str:
    return (f"Close the design-lab runner in Figma and start it again; it was updated to {version} "
            "and Figma loads the new code when it starts. If it still says this after a restart, Figma is "
            "loading the runner from another folder: import ~/.design-lab/runner/manifest.json again "
            "(Plugins, Development, Import plugin from manifest).")


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
                           capture_output=True, text=True, timeout=DRIVER_TIMEOUT,
                           # The runner fetches code over its own connection; use_figma's size
                           # limit applies only when a model relays the payload.
                           env={**os.environ, "DESIGN_LAB_RUNNER": "1"})
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
            try:
                step = self.driver("next")
            except RuntimeError as error:
                if "renderer changed" not in str(error) or not self.state.get("iterate"):
                    raise
                # Templates edited mid-build: an iterating run waits for the next init rather
                # than closing the runner, so the fix-and-rebuild loop needs nobody in Figma.
                self.current = None
                return {"kind": "wait", "step": "wait", "retryMs": WAIT_MS,
                        "message": "The templates changed during the build. Waiting for the next build."}
            if step["kind"] != "skip":
                break
            self.driver("record", "--step", step["step"])
            self.log(f"skipped {step['step']}: {step.get('reason', '')}")
        if step["kind"] == "done":
            step = self.dump_step() or step
            if step["kind"] == "done" and self.state.get("iterate"):
                # An iterating run keeps the runner open for the next `init --rebuild`.
                self.current = None
                return {"kind": "wait", "step": "wait", "retryMs": WAIT_MS,
                        "message": "Build complete. Waiting for the next build."}
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
        results = self.project / "figma" / "results"
        if not (results / "pages.json").is_file():
            return None                      # nothing was built, so there is nothing to dump
        pages = json.loads((results / "pages.json").read_text())["pages"]
        # A dump older than the newest build result describes a file that has changed since,
        # so a fix-and-reverify loop must dump again rather than reread the first answer.
        built = max((path.stat().st_mtime for path in results.glob("*.json")), default=0)
        stale = lambda target: not target.exists() or target.stat().st_mtime < built
        out = self.project / "figma" / "dump"
        for name, page_id in sorted(pages.items()):
            target = out / f"{name.replace('/', '-')}.json"
            if stale(target):
                code = (HERE / "figma_dump_tree.js").read_text().replace("__PAGE_ID__", page_id)
                return {"kind": "dump", "step": f"dump:{name}", "code": code, "out": str(target)}
        # Then the read-only state design-lab:verify needs, so verification needs no model relay
        # either; verify_state.py merges these into verify/state.json.
        verify = self.project / "figma" / "verify"
        wanted = [("verify:root", verify / "root.json", (HERE / "figma_dump_root.js").read_text())]
        for name, page_id in sorted(pages.items()):
            wanted.append((f"verify:page:{name}", verify / f"page-{name.replace('/', '-')}.json",
                           (HERE / "figma_dump_page.js").read_text().replace("PAGE_ID", page_id)))
        started = next((page_id for name, page_id in pages.items() if name == "Getting Started"), None)
        if started:
            wanted.append(("verify:getting-started", verify / "getting-started.json",
                           (HERE / "figma_dump_getting_started.js").read_text()
                           .replace("PAGE_ID", started)))
        for step, target, code in wanted:
            if stale(target):
                return {"kind": "dump", "step": step, "code": code, "out": str(target)}
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
        args = {**(request.get("cover") or default_cover()), "pageId": request["pageId"], "tiers": []}
        return {"kind": "check", "step": COVER_STEP, "code": render_payload.call_payload("cover", args)}

    def handshake_record(self, step: str, result: dict) -> dict:
        request = handshake_request(self.project)
        path = self.project / "figma" / HANDSHAKE_REQUEST
        if not path.is_file():
            # Preflight stopped waiting and withdrew its request; nobody wants this answer now.
            self.current = None
            self.log(f"ignored {step}: preflight is no longer waiting for it")
            return {"recorded": step, "ignored": True}
        if step == CHECK_STEP:
            outcome = check_outcome(self.key, result)
            if request.get("connectionOnly") and outcome["fileKeyMatches"]:
                # The build has begun in this file, so it is no longer empty: prove only that the
                # runner is connected to it.
                outcome = {**outcome, "ok": True, "connectionOnly": True}
                outcome.pop("failure", None)
                write_handshake(self.project, outcome)
            elif not outcome["ok"]:
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
    # Requests from the runner being served right now. A slow step (an image fetch can take
    # minutes) is the runner working, not absent, so /health reports it and the run's check for
    # an absent runner treats it as connected.
    activity = {"inflight": 0}
    counter = threading.Lock()

    def seen(build: Build) -> None:
        (figma_dir(build.project) / SEEN_FILE).write_text(utc_now() + "\n")

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
                                                    "failure": "Paste your runner token into the runner when it asks "
                                                               f"(copy it with: pbcopy < {HOME / TOKEN_FILE}), then run "
                                                               "preflight again; the runner's saved token was rejected"})
                return self.reply(401, b"the runner token was rejected; paste the one in ~/.design-lab/runner-token", "text/plain")
            if url.path != "/health" and outdated(q.get("version")):
                message = outdated_message(plugin_version())
                for b in builds.values():
                    if b.handshake_pending():
                        write_handshake(b.project, {"runnerConnected": True, "ok": False, "outdated": True,
                                                    "runnerVersion": q.get("version"), "failure": message})
                return self.reply(426, json.dumps({"outdated": True, "version": plugin_version(),
                                                   "message": message}).encode())
            if url.path == "/health":
                return self.reply(200, json.dumps({"pid": os.getpid(), "projects": [str(b.project) for b in builds.values()],
                                                   "files": [b.key for b in builds.values()],
                                                   "inflight": activity["inflight"] > 0}).encode())
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
            with counter:
                activity["inflight"] += 1
            seen(build)   # when the runner last asked, so the run can tell it is still there
            try:
                with build.lock:
                    return self.serve(build, method, url, q)
            finally:
                with counter:
                    activity["inflight"] -= 1
                seen(build)

        def serve(self, build: Build, method: str, url, q: dict) -> None:
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
    """The one run this server serves, by its target file key. design-lab builds one library at
    a time, for the best results in Figma desktop, so a second run is refused."""
    runs = sorted({str(Path(p).resolve()) for p in projects})
    if len(runs) != 1:
        raise SystemExit("one run at a time: a runner server serves exactly one run; finish or stop "
                         f"the other before starting it ({', '.join(runs)})")
    b = Build(Path(runs[0]))
    if not b.key:
        raise SystemExit(f"{b.project} has no target Figma file yet; record it with workflow.py preflight")
    return {b.key: b}


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
    """Whether a server is alive and serving this run, from its answer; and if another run's
    server holds the port, which run that is."""
    project = Path(project).resolve()
    folder = project / "figma"
    pid = int((folder / PID_FILE).read_text()) if (folder / PID_FILE).is_file() else None
    token_file = HOME / TOKEN_FILE
    answer = health(token_file.read_text().strip()) if token_file.is_file() else None
    serving = bool(answer) and str(project) in answer.get("projects", [])
    other = [p for p in (answer or {}).get("projects", []) if p != str(project)]
    return {"alive": serving, "pid": (answer or {}).get("pid", pid), "portInUse": serving or bool(answer) or port_in_use(),
            "inflight": serving and bool(answer.get("inflight")),
            "otherRun": other[0] if other and not serving else None, "otherPid": (answer or {}).get("pid") if other else None,
            "log": str(folder / SERVER_LOG)}


def run_finished(project: Path) -> bool:
    """Whether a run's build has every step recorded (figma_build.py next would say done)."""
    try:
        state = json.loads((Path(project) / "figma" / "state.json").read_text())
    except (OSError, ValueError):
        return False
    return {s["id"] for s in state.get("steps") or []} <= set(state.get("done") or [])


def stop_server(project: Path) -> dict:
    """Stop this run's server, if it is the one serving."""
    import signal
    status = server_status(project)
    if status["alive"] and status["pid"]:
        os.kill(int(status["pid"]), signal.SIGTERM)
    return {"stopped": bool(status["alive"]), "pid": status["pid"]}


def ensure_server(project: Path, wait: float = 10) -> dict:
    """Reuse the server serving this run, or start one detached with the run's stored token. It
    outlives the command that started it: its own session, its pid in figma/runner.pid and its
    output in figma/runner-server.log."""
    project = Path(project).resolve()
    person_token()
    status = server_status(project)
    if status["alive"]:
        return {**status, "started": False}
    if status["otherRun"] and run_finished(Path(status["otherRun"])):
        # That run's build has every step recorded: its server was only left behind.
        stop_server(Path(status["otherRun"]))
        print(f"stopped the runner server of a finished run: {status['otherRun']}", file=sys.stderr, flush=True)
        for _ in range(50):
            if not port_in_use():
                break
            time.sleep(0.1)
        status = server_status(project)
        if status["alive"]:
            return {**status, "started": False}
    if status["otherRun"]:
        raise RuntimeError(f"another run is active: {status['otherRun']} (server process {status['otherPid']}). "
                           "design-lab builds one library at a time, for the best results in Figma desktop; "
                           f"stop it first with: python3 {Path(__file__).resolve()} stop --project {status['otherRun']}")
    if status["portInUse"]:
        raise RuntimeError(f"127.0.0.1:{PORT} is in use by another program; stop it, then run preflight again")
    folder = figma_dir(project)
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
            return {**server_status(project), "started": True}
        time.sleep(0.2)
    raise RuntimeError(f"the runner server did not answer within {wait:g} seconds; see {folder / SERVER_LOG}")


def default_cover() -> dict:
    """The name-only Cover's arguments when preflight did not give them."""
    return {"ground": "#001B67", "headline": "Library", "subtitle": "Component Library",
            "provenance": {"stage": "preflight"}, "version": ""}


def request_handshake(project: Path, cover: dict | None = None, expected_cover_page: str | None = None,
                      connection_only: bool = False) -> None:
    """Ask the server to run the handshake the next time the runner asks for a step. `cover`
    holds the name-only Cover's arguments (ground, headline, subtitle, provenance, version)."""
    folder = figma_dir(Path(project))
    (folder / HANDSHAKE).unlink(missing_ok=True)
    (folder / HANDSHAKE_REQUEST).write_text(json.dumps({
        "requestedAt": utc_now(), "stage": "check", "expectedCoverPageId": expected_cover_page,
        "connectionOnly": connection_only,
        "cover": cover or default_cover()}) + "\n")


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
    for name in ("start", "status", "stop"):
        sub.add_parser(name).add_argument("--project", required=True)
    ns = ap.parse_args()
    if ns.cmd == "stop":
        print(json.dumps(stop_server(Path(ns.project)), indent=2))
        return 0
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
    token = person_token()   # never printed: the person copies it from the file once per machine
    print(f"runner token: in {HOME / TOKEN_FILE}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), make_handler(builds, token)).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
