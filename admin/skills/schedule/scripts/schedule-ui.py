#!/usr/bin/env python3
"""
admin:schedule web UI -- view and manage com.chrisweber.* launchd tasks.
Runs on http://localhost:7474
"""

import json
import os
import subprocess
import glob
import plistlib
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import html as html_lib

NAMESPACE = "com.chrisweber"
LAUNCH_AGENTS = Path.home() / "Library" / "LaunchAgents"
LOG_DIR = Path.home() / ".claude" / "logs" / "schedule"
PORT = 7474


def get_tasks():
    tasks = []
    for plist_path in sorted(LAUNCH_AGENTS.glob(f"{NAMESPACE}.*.plist")):
        label = plist_path.stem
        name = label[len(NAMESPACE) + 1:]

        try:
            with open(plist_path, "rb") as f:
                plist = plistlib.load(f)
        except Exception:
            plist = {}

        interval_s = plist.get("StartInterval", 0)
        if interval_s >= 3600:
            interval = f"{interval_s // 3600}h"
        elif interval_s >= 60:
            interval = f"{interval_s // 60}m"
        else:
            interval = f"{interval_s}s"

        args = plist.get("ProgramArguments", [])
        command = " ".join(args)

        pid = "-"
        status = "stopped"
        last_exit = "-"
        try:
            result = subprocess.run(
                ["launchctl", "list", label],
                capture_output=True, text=True, timeout=3
            )
            if result.returncode == 0:
                info = result.stdout
                for line in info.splitlines():
                    if '"PID"' in line:
                        parts = line.split("=")
                        if len(parts) > 1:
                            pid = parts[-1].strip().rstrip(";").strip()
                    if '"LastExitStatus"' in line:
                        parts = line.split("=")
                        if len(parts) > 1:
                            last_exit = parts[-1].strip().rstrip(";").strip()
                if pid and pid != "-":
                    status = "running"
                elif last_exit not in ("-", "0"):
                    status = "error"
                else:
                    status = "stopped"
            else:
                status = "unloaded"
        except Exception:
            status = "unknown"

        log_file = LOG_DIR / f"{name}.log"
        err_file = LOG_DIR / f"{name}.err"
        log_size = log_file.stat().st_size if log_file.exists() else 0
        has_errors = err_file.exists() and err_file.stat().st_size > 0

        tasks.append({
            "label": label,
            "name": name,
            "status": status,
            "pid": pid,
            "last_exit": last_exit,
            "interval": interval,
            "command": command,
            "log_size": log_size,
            "has_errors": has_errors,
        })

    return tasks


def get_log(name, stream="stdout"):
    fname = f"{name}.log" if stream == "stdout" else f"{name}.err"
    log_file = LOG_DIR / fname
    if not log_file.exists():
        return f"(no {stream} log yet)"
    try:
        lines = log_file.read_text().splitlines()
        return "\n".join(lines[-200:])
    except Exception as e:
        return f"Error reading log: {e}"


def run_action(action, name):
    script_dir = Path(__file__).parent
    scripts = {
        "enable": script_dir / "schedule-enable.sh",
        "disable": script_dir / "schedule-disable.sh",
        "delete": script_dir / "schedule-delete.sh",
    }
    if action not in scripts:
        return {"ok": False, "error": f"Unknown action: {action}"}
    try:
        result = subprocess.run(
            ["bash", str(scripts[action]), name],
            capture_output=True, text=True, timeout=10
        )
        return {"ok": result.returncode == 0, "output": result.stdout + result.stderr}
    except Exception as e:
        return {"ok": False, "error": str(e)}


HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scheduled Tasks</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0f0f0f; color: #e0e0e0; min-height: 100vh; }
  header { background: #1a1a1a; border-bottom: 1px solid #333;
           padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 18px; font-weight: 600; color: #fff; }
  header .ns { font-size: 12px; color: #666; font-family: monospace; }
  .refresh { margin-left: auto; background: #333; border: none; color: #ccc;
             padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .refresh:hover { background: #444; }
  main { padding: 24px; max-width: 1200px; }
  .empty { color: #666; padding: 40px 0; text-align: center; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; color: #888; font-weight: 500;
       border-bottom: 1px solid #2a2a2a; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 10px 12px; border-bottom: 1px solid #1e1e1e; vertical-align: middle; }
  tr:hover td { background: #161616; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px;
           font-size: 11px; font-weight: 500; }
  .badge-running  { background: #0d2b1a; color: #4ade80; }
  .badge-stopped  { background: #1e1e1e; color: #888; }
  .badge-error    { background: #2b0d0d; color: #f87171; }
  .badge-unloaded { background: #1e1e1e; color: #555; }
  .badge-unknown  { background: #1e1e1e; color: #666; }
  .label { font-family: monospace; font-size: 12px; color: #a78bfa; }
  .cmd   { font-family: monospace; font-size: 11px; color: #666;
           max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; gap: 6px; }
  .btn { border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;
         font-size: 11px; font-weight: 500; }
  .btn-enable  { background: #0d2b1a; color: #4ade80; }
  .btn-disable { background: #2b1f0d; color: #fb923c; }
  .btn-delete  { background: #2b0d0d; color: #f87171; }
  .btn-logs    { background: #1a1a2e; color: #818cf8; }
  .btn:hover   { opacity: 0.8; }
  .err-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%;
             background: #f87171; margin-left: 4px; vertical-align: middle; }
  #log-panel { position: fixed; right: 0; top: 0; bottom: 0; width: 480px;
               background: #111; border-left: 1px solid #2a2a2a;
               transform: translateX(100%); transition: transform 0.2s ease;
               display: flex; flex-direction: column; z-index: 100; }
  #log-panel.open { transform: translateX(0); }
  #log-header { padding: 16px; border-bottom: 1px solid #2a2a2a;
                display: flex; align-items: center; }
  #log-title  { font-size: 13px; font-family: monospace; color: #a78bfa; flex: 1; }
  #log-close  { background: none; border: none; color: #666; font-size: 18px;
                cursor: pointer; padding: 0 4px; }
  #log-tabs   { display: flex; border-bottom: 1px solid #2a2a2a; }
  .log-tab    { padding: 8px 16px; font-size: 12px; cursor: pointer;
                border: none; border-bottom: 2px solid transparent;
                color: #666; background: none; }
  .log-tab.active { color: #a78bfa; border-bottom-color: #a78bfa; }
  #log-content { flex: 1; overflow-y: auto; padding: 16px;
                 font-family: monospace; font-size: 11px; line-height: 1.6;
                 white-space: pre-wrap; color: #ccc; }
  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
           background: #1a1a1a; border: 1px solid #333; padding: 10px 20px;
           border-radius: 8px; font-size: 13px; display: none; z-index: 200; }
</style>
</head>
<body>
<header>
  <h1>Scheduled Tasks</h1>
  <span class="ns">com.chrisweber.*</span>
  <button class="refresh" onclick="loadTasks()">Refresh</button>
</header>
<main><div id="task-list">Loading...</div></main>

<div id="log-panel">
  <div id="log-header">
    <span id="log-title"></span>
    <button id="log-close" onclick="closeLog()">&#x2715;</button>
  </div>
  <div id="log-tabs">
    <button class="log-tab active" onclick="switchTab('stdout')">stdout</button>
    <button class="log-tab" onclick="switchTab('stderr')">stderr</button>
  </div>
  <div id="log-content"></div>
</div>
<div class="toast" id="toast"></div>

<script>
let currentLogName = null;
let currentTab = 'stdout';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadTasks() {
  const res = await fetch('/api/tasks');
  const tasks = await res.json();
  renderTasks(tasks);
}

function renderTasks(tasks) {
  const el = document.getElementById('task-list');
  if (!tasks.length) {
    el.textContent = 'No tasks found under com.chrisweber.* -- create one with /admin:schedule create';
    return;
  }

  const table = document.createElement('table');
  const thead = table.createTHead();
  const hr = thead.insertRow();
  ['Label', 'Status', 'Interval', 'Command', 'Actions'].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  });

  const tbody = table.createTBody();
  tasks.forEach(t => {
    const row = tbody.insertRow();

    // Label
    const labelCell = row.insertCell();
    const labelSpan = document.createElement('span');
    labelSpan.className = 'label';
    labelSpan.textContent = t.label;
    labelCell.appendChild(labelSpan);

    // Status
    const statusCell = row.insertCell();
    const badge = document.createElement('span');
    const safeStatus = /^[a-z]+$/.test(t.status) ? t.status : 'unknown';
    badge.className = `badge badge-${safeStatus}`;
    badge.textContent = t.pid !== '-' ? `${t.status} \u00b7 ${t.pid}` : t.status;
    statusCell.appendChild(badge);

    // Interval
    row.insertCell().textContent = t.interval;

    // Command
    const cmdCell = row.insertCell();
    const cmdSpan = document.createElement('span');
    cmdSpan.className = 'cmd';
    cmdSpan.title = t.command;
    cmdSpan.textContent = t.command;
    cmdCell.appendChild(cmdSpan);

    // Actions
    const actCell = row.insertCell();
    const div = document.createElement('div');
    div.className = 'actions';

    const logsBtn = document.createElement('button');
    logsBtn.className = 'btn btn-logs';
    logsBtn.textContent = 'Logs';
    if (t.has_errors) {
      const dot = document.createElement('span');
      dot.className = 'err-dot';
      logsBtn.appendChild(dot);
    }
    logsBtn.addEventListener('click', () => openLog(t.name));
    div.appendChild(logsBtn);

    const isRunning = t.status === 'running';
    const toggleBtn = document.createElement('button');
    toggleBtn.className = isRunning ? 'btn btn-disable' : 'btn btn-enable';
    toggleBtn.textContent = isRunning ? 'Disable' : 'Enable';
    toggleBtn.addEventListener('click', () => doAction(isRunning ? 'disable' : 'enable', t.name));
    div.appendChild(toggleBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-delete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => confirmDelete(t.name));
    div.appendChild(delBtn);

    actCell.appendChild(div);
  });

  el.replaceChildren(table);
}

async function doAction(act, name) {
  const res = await fetch('/api/action', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({action: act, name})
  });
  const data = await res.json();
  showToast(data.ok ? (data.output || 'Done') : '\u2717 ' + (data.error || data.output));
  setTimeout(loadTasks, 500);
}

function confirmDelete(name) {
  if (confirm(`Delete task "${name}"? This removes the plist and unloads it from launchd.`)) {
    doAction('delete', name);
  }
}

async function openLog(name) {
  currentLogName = name;
  document.getElementById('log-title').textContent = name;
  document.getElementById('log-panel').classList.add('open');
  await loadLog();
}

function closeLog() {
  document.getElementById('log-panel').classList.remove('open');
  currentLogName = null;
}

async function loadLog() {
  if (!currentLogName) return;
  const res = await fetch(`/api/log?name=${encodeURIComponent(currentLogName)}&stream=${currentTab}`);
  const text = await res.text();
  document.getElementById('log-content').textContent = text;
  const el = document.getElementById('log-content');
  el.scrollTop = el.scrollHeight;
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.log-tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0) === (tab === 'stdout'));
  });
  loadLog();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}

setInterval(loadTasks, 30000);
loadTasks();
</script>
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(HTML.encode())

        elif parsed.path == "/api/tasks":
            tasks = get_tasks()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(tasks).encode())

        elif parsed.path == "/api/log":
            name = qs.get("name", [""])[0]
            stream = qs.get("stream", ["stdout"])[0]
            if stream not in ("stdout", "stderr"):
                stream = "stdout"
            content = get_log(name, stream)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(content.encode())

        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/action":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            result = run_action(body.get("action"), body.get("name"))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    server = HTTPServer(("localhost", PORT), Handler)
    print(f"Schedule UI running at http://localhost:{PORT}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
