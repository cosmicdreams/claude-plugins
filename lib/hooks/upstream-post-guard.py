#!/usr/bin/env python3
"""upstream-post-guard: lib plugin, PreToolUse on Bash.

Blocks posts to git.drupalcode.org (merge request and issue notes, including
/do: commands, and merge request descriptions) unless:

- the body comes from a file,
- `<body>.gate.json` beside it answers the worth-it gate and matches the
  body's sha256,
- the body passes the slop check, and
- for projects whose maintainers asked for human-written posts, the user
  approved the exact text (`chris_approved: true`).

Exit 2 blocks the call and tells the agent what to fix. Reads are never
inspected. See references/worth-it.md.
"""

import hashlib
import json
import os
import re
import shlex
import subprocess
import sys

WORD_CAP = 150
GATE_FIELDS = ("problem", "proof", "smallest", "trigger", "reviewer_value", "not_verified")

SLOP_PATTERNS = [
    (r"(?m)^\s{0,3}#{1,6}\s", "a heading"),
    (r"(?i)\b(happy to|let me know|hope this helps|great catch|thanks for the review|in short|tl;?dr)\b", "filler"),
    (r"(?i)\b(separate from this|unrelated to (this|the)|outside (this|the) (mr|merge request|pr|pull request|fix)|not in this (mr|merge request|pr)|findings outside|choices worth a look)\b", "a side finding (give it to the user as a follow-up)"),
    (r"(?i)\b(generated (with|by)|co-authored-by|as an ai)\b|🤖", "agent attribution"),
]


def block(msg):
    sys.stderr.write("Blocked (upstream-post-guard): " + msg + "\nSee references/worth-it.md in the lib plugin or ~/.claude/skills/full-send/references/worth-it.md.\n")
    sys.exit(2)


def is_post(cmd):
    """True when the command writes a note, discussion or description upstream."""
    if re.search(r"\bglab\s+(mr|issue)\s+(note|comment)\b", cmd):
        return True
    if re.search(r"\bglab\s+mr\s+(create|update)\b", cmd) and re.search(r"(\s-d\b|--description\b)", cmd):
        return True
    if re.search(r"\bglab\s+api\b", cmd) and re.search(r"/(notes|discussions)\b", cmd):
        if re.search(r"(-X\s*|--method[=\s]+)(POST|PUT)\b|\s(-f|-F|--field|--raw-field|--input)\b", cmd):
            return True
    if "git.drupalcode.org" in cmd and re.search(r"\bcurl\b", cmd) and re.search(r"/(notes|discussions)\b", cmd):
        if re.search(r"(-X\s*|--request[=\s]+)(POST|PUT)\b|\s(-d|--data\S*|-F|--form)\b", cmd):
            return True
    return False


def targets_drupalcode(cmd, cwd):
    if "glab" not in cmd and "git.drupalcode.org" not in cmd:
        return False
    if "git.drupalcode.org" in cmd or re.search(r"\bproject(/|%2F)", cmd) or re.search(r"\bissue/[\w-]+", cmd):
        return True
    host = os.environ.get("GITLAB_HOST", "")
    if "drupalcode" in host:
        return True
    return "drupal" in remotes(cwd)


def remotes(cwd):
    try:
        out = subprocess.run(["git", "-C", cwd or ".", "remote", "-v"], capture_output=True, text=True, timeout=5)
        return out.stdout
    except Exception:
        return ""


def body_files(cmd, cwd):
    """Readable files the command names, resolved against cwd."""
    flat = re.sub(r"[$()`'\"=@<]", " ", cmd)
    try:
        tokens = shlex.split(flat)
    except ValueError:
        tokens = flat.split()
    found = []
    for tok in tokens:
        if tok.startswith("-") or tok.endswith(".gate.json"):
            continue
        path = os.path.expanduser(tok)
        if not os.path.isabs(path):
            path = os.path.join(cwd or ".", path)
        if os.path.isfile(path) and os.path.getsize(path) < 1048576 and os.path.exists(path + ".gate.json"):
            found.append(path)
    return found


def opt_out_projects():
    path = os.environ.get("UPSTREAM_MAINTAINERS") or os.path.expanduser("~/.claude/upstream-maintainers.json")
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return []


def project_match(cmd, cwd, project):
    """project is like 'project/group'; matches the command or the checkout's remote."""
    name = project.split("/", 1)[-1]
    hay = cmd + "\n" + remotes(cwd)
    pats = [re.escape(project), re.escape(project.replace("/", "%2F")), r"issue/" + re.escape(name) + r"-\d+"]
    return any(re.search(p, hay) for p in pats)


def slop(body):
    if body.lstrip().startswith("/do:") and len(body.split()) <= 12:
        return None
    words = len(body.split())
    if words > WORD_CAP:
        return f"the body is {words} words; the cap is {WORD_CAP}. Lead with the conclusion and cut the rest"
    for pat, label in SLOP_PATTERNS:
        m = re.search(pat, body)
        if m:
            return f"the body contains {label}: {m.group(0).strip()!r}"
    return None


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return 0
    cmd = (data.get("tool_input") or {}).get("command") or ""
    cwd = data.get("cwd") or os.getcwd()
    if not cmd or not is_post(cmd) or not targets_drupalcode(cmd, cwd):
        return 0

    files = body_files(cmd, cwd)
    if not files:
        block("write the post body to a file, record the worth-it gate in <body>.gate.json beside it, "
              "and pass the file to the command (for example --message \"$(cat body.md)\").")

    for path in files:
        with open(path, encoding="utf-8", errors="replace") as fh:
            body = fh.read()
        try:
            with open(path + ".gate.json") as fh:
                gate = json.load(fh)
        except (OSError, ValueError) as exc:
            block(f"{path}.gate.json is not readable JSON ({exc}).")
        missing = [f for f in GATE_FIELDS if not str(gate.get(f, "")).strip()]
        if missing:
            block(f"{path}.gate.json leaves these gate answers empty: {', '.join(missing)}. "
                  "If you cannot answer one, the post fails the gate: give it to the user as a follow-up instead.")
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        if gate.get("body_sha256") != digest:
            block(f"{path} changed after its gate was recorded (sha256 {digest}). Re-run the gate on the final text.")
        problem = slop(body)
        if problem:
            block(problem + ".")
        for entry in opt_out_projects():
            if project_match(cmd, cwd, entry.get("project", "")) and gate.get("chris_approved") is not True:
                block(f"{entry.get('project')} maintainer {entry.get('maintainer')} asked for human-written posts. "
                      "Show the user the exact text; set chris_approved only after they approve it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
