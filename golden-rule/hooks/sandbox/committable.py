#!/usr/bin/env python3
"""What in a main worktree could be committed, and putting it back when a command changed it.

The golden rule keeps a main worktree clean: nothing a `git status` there would show may be left by a
session. A committable change is a tracked file modified or deleted, a new file git does not ignore, or a
change to the index. Everything git ignores (a local DDEV setup, vendor/, node_modules/, the files folder)
is not part of the reference and is free to change.

Git decides, as the person's own `git status` would: the repository's ignore files, info/exclude and the
global excludes file all count. Git runs by absolute path from a clean environment (no inherited GIT_DIR,
GIT_INDEX_FILE and the like) with fsmonitor off.

- `check` (the mod's Edit, Write and MCP gate): may this one path be written? Only a gitignored, untracked
  file that is no spelling of a tracked file, not inside a submodule, not an ignore file and not a hard link.
- `snapshot` / `revert` (the shell layer, around a command tied to a main worktree): what `git status`
  showed before, and after the command, restore every tracked file the command changed from HEAD and
  delete every new file git does not ignore. A path that was already changed before the command is left
  as it is and reported.

Usage (the mod): committable.py check <main worktree> <real path>   exit 0 may be written, 1 not
"""
from __future__ import annotations

import hashlib
import os
import stat
import subprocess
import sys
import unicodedata

GIT = "/usr/bin/git"  # never looked up on PATH


class Unknown(Exception):
    """Git could not answer: the caller treats the path as protected."""


def git(root: str, *args: str, stdin: bytes | None = None, ok: tuple[int, ...] = (0,)) -> bytes:
    env = {"HOME": os.path.expanduser("~"), "PATH": "/usr/bin:/bin", "GIT_OPTIONAL_LOCKS": "0", "LC_ALL": "C"}
    argv = [GIT, "-C", root, "-c", "core.fsmonitor=false", "-c", "core.quotePath=false", *args]
    done = subprocess.run(argv, input=stdin, capture_output=True, env=env, timeout=60)
    if done.returncode not in ok:
        raise Unknown(f"git {args[0]} failed in {root}: {done.stderr.decode(errors='replace').strip()[:200]}")
    return done.stdout


def nul(data: bytes) -> list[str]:
    return [item for item in data.decode(errors="surrogateescape").split("\0") if item]


def key(path: str) -> str:
    """A spelling as a case-insensitive, normalisation-insensitive volume compares it."""
    return unicodedata.normalize("NFC", path).casefold()


# ---- the Edit and Write gate ----------------------------------------------------------------------

def check(root: str, real: str) -> bool:
    """Whether a real path inside a main worktree may be written: ignored, untracked, and nothing that
    could be another name for a tracked file."""
    root = os.path.realpath(root)
    if not real.startswith(root + "/"):
        return False
    rel = real[len(root) + 1:]
    k = key(rel)
    if k.split("/")[0] == ".git" or os.path.basename(k) == ".gitignore":
        return False
    for entry in nul(git(root, "ls-files", "--stage", "-z")):
        meta, _, path = entry.partition("\t")
        t = key(path)
        if k == t or t.startswith(k + "/") or (meta.startswith("160000") and k.startswith(t + "/")):
            return False
    try:
        info = os.lstat(real)
        if stat.S_ISREG(info.st_mode) and info.st_nlink > 1:
            return False
    except FileNotFoundError:
        pass
    fields = nul(git(root, "check-ignore", "-v", "-n", "-z", "--stdin", stdin=(rel + "\0").encode(), ok=(0, 1)))
    # -v -n gives source, line, pattern, path; an unmatched path has an empty source. A `!` pattern
    # re-includes the path, so it is not ignored.
    return len(fields) == 4 and not fields[2].startswith("!")


# ---- the shell layer ------------------------------------------------------------------------------

def snapshot(root: str) -> dict:
    """What `git status` shows now, by path, and where HEAD points."""
    entries: dict[str, str] = {}
    items = nul(git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"))
    i = 0
    while i < len(items):
        code, path = items[i][:2], items[i][3:]
        entries[path] = code
        if code[0] in "RC":  # a rename or copy carries its source as the next item
            i += 1
            entries.setdefault(items[i], "D ")
        i += 1
    sums = {path: digest(os.path.join(root, path)) for path in entries}
    head = git(root, "rev-parse", "--verify", "-q", "HEAD", ok=(0, 1)).decode().strip()
    branch = git(root, "symbolic-ref", "-q", "HEAD", ok=(0, 1)).decode().strip()
    origin = git(root, "config", "--get", "remote.origin.url", ok=(0, 1)).decode().strip()
    return {"entries": entries, "sums": sums, "head": head, "branch": branch, "origin": origin}


def digest(path: str) -> str | None:
    """A changed file's content, to tell whether a command changed it again."""
    try:
        if os.path.isfile(path) and not os.path.islink(path):
            with open(path, "rb") as handle:
                return hashlib.sha256(handle.read()).hexdigest()
        return os.readlink(path) if os.path.islink(path) else None
    except OSError:
        return None


def remote_tip(root: str, branch: str) -> str:
    """Where the hosted remote's branch really is now, asked over the network (not the local refs or
    config a command could have rewritten). SSH needs the agent socket, so it alone is passed through."""
    env = {"HOME": os.path.expanduser("~"), "PATH": "/usr/bin:/bin", "LC_ALL": "C",
           **{key: os.environ[key] for key in ("SSH_AUTH_SOCK",) if key in os.environ}}
    done = subprocess.run([GIT, "-C", root, "ls-remote", "--exit-code", "origin", branch], capture_output=True, env=env, timeout=30)
    if done.returncode != 0:
        raise Unknown(f"git ls-remote origin {branch} failed: {done.stderr.decode(errors='replace').strip()[:200]}")
    return done.stdout.decode().split()[0]


def published_fast_forward(root: str, before: dict, after: dict) -> bool:
    """Whether main only moved forward, on the same branch, to a commit the hosted remote's main already
    holds (pull --ff-only): keeping the reference current, not a change made on it. Checked against the
    remote itself, with an origin URL the command did not change; a local ref, FETCH_HEAD, another remote
    or a pushed feature branch does not count."""
    if not (before["head"] and after["head"] and after["branch"]) or before["branch"] != after["branch"]:
        return False
    if not before["origin"] or after["origin"] != before["origin"]:
        return False
    try:
        tip = remote_tip(root, after["branch"])
        # exit 1 (not an ancestor) raises Unknown
        git(root, "merge-base", "--is-ancestor", before["head"], after["head"])
        git(root, "merge-base", "--is-ancestor", after["head"], tip)
        return True
    except (Unknown, subprocess.SubprocessError):
        return False


def undo_move(root: str, before: dict, after: dict) -> str:
    """Put main's branch and HEAD back where they were before the command; what happened, for the report."""
    moved = f"{after['branch'] or 'detached'} {after['head'][:10]}"
    try:
        if before["branch"] and after["branch"] != before["branch"]:
            git(root, "switch", "-q", before["branch"].removeprefix("refs/heads/"))
        if before["head"] and git(root, "rev-parse", "HEAD").decode().strip() != before["head"]:
            git(root, "reset", "-q", "--keep", before["head"])
        return f"HEAD had moved to {moved}; put back to {before['branch'] or 'detached'} {before['head'][:10]}"
    except Unknown as error:
        return f"HEAD moved to {moved} and could not be put back ({error}); tell Chris"


def revert(root: str, before: dict) -> dict:
    """Put back what a command changed: tracked files from HEAD, new unignored files deleted. Returns what
    was reverted, what was left (already changed before, or not safely undoable) and why."""
    after = snapshot(root)
    reverted: list[str] = []
    left: list[str] = []
    notes: list[str] = []
    if (after["head"], after["branch"]) != (before["head"], before["branch"]) and not published_fast_forward(root, before, after):
        notes.append(undo_move(root, before, after))
        after = snapshot(root)
    restore: list[str] = []
    for path, code in sorted(after["entries"].items()):
        was = before["entries"].get(path)
        if was == code and before["sums"].get(path) == after["sums"].get(path):
            continue
        if was is not None:
            left.append(path)  # changed before the command too: its earlier content is unknown here
        elif code == "??":
            full = os.path.join(root, path)
            if os.path.isdir(full) and not os.path.islink(full):
                left.append(path)  # a nested repository: not ours to delete
            else:
                try:
                    os.unlink(full)
                    reverted.append(path)
                except OSError as error:
                    left.append(path)
                    notes.append(f"{path}: {error.strerror}")
        else:
            restore.append(path)
    if restore:
        try:
            git(root, "restore", "--source=HEAD", "--staged", "--worktree", "--pathspec-from-file=-",
                "--pathspec-file-nul", stdin=b"".join(f":(literal){p}".encode() + b"\0" for p in restore))
            reverted += restore
        except Unknown as error:
            left += restore
            notes.append(str(error))
    return {"reverted": sorted(reverted), "left": sorted(left), "notes": notes}


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "check":
        try:
            sys.exit(0 if check(sys.argv[2], os.path.realpath(sys.argv[3])) else 1)
        except Exception:
            sys.exit(2)
    print("usage: committable.py check <main worktree> <path>", file=sys.stderr)
    sys.exit(2)
