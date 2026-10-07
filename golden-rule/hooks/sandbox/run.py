#!/usr/bin/env python3
"""Run one shell command (or another plugin's argument vector) inside the golden rule's sandbox.

The golden-rule mod rewrites every Bash and Monitor command to call this script. It runs outside the
sandbox, computes the profile from the shell's real working directory at execution time (so the model
never sees or edits the policy), runs the command under /usr/bin/sandbox-exec, and passes the exit
status through. Writes into a main worktree (a working-tree root named `main`, in practice
<project>/worktrees/main) are denied, except the git metadata a feature worktree must write. Around a
command tied to a main worktree it also watches for changes the sandbox cannot see (a container writing
through a bind mount) and quarantines that worktree when one appears.

Anything that goes wrong here refuses the command (exit 126): the guard fails closed.

Usage:
  run.py --command <base64 command> --state <file>   the Bash tool's command; final directory to <file>
  run.py --argv <base64 JSON argument vector>         another plugin's $.process.run / spawn
"""
from __future__ import annotations

import base64
import glob
import json
import os
import pwd
import re
import signal
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.realpath(__file__))
PLUGIN_ROOT = os.path.dirname(os.path.dirname(HERE))
HOME = pwd.getpwuid(os.getuid()).pw_dir  # not $HOME, which a command could change
SANDBOX_EXEC = "/usr/bin/sandbox-exec"
PREFIX = "golden-rule:"


def expand(path: str) -> str:
    return os.path.join(HOME, path[2:]) if path.startswith("~/") else path


def ancestors(path: str):
    while True:
        yield path
        if path == "/":
            return
        path = os.path.dirname(path)


def deepest_real(path: str) -> str:
    """Where a path lands: its own real path, or its deepest existing folder's plus the rest."""
    rest = []
    for at in ancestors(os.path.normpath(path)):
        if os.path.lexists(at):
            return os.path.join(os.path.realpath(at), *reversed(rest))
        rest.append(os.path.basename(at))
    return path


def main_worktree_of(path: str) -> str | None:
    """The nearest folder holding .git governs; it is a main worktree when it is named main."""
    for directory in ancestors(deepest_real(path)):
        if os.path.lexists(os.path.join(directory, ".git")):
            return directory if os.path.basename(directory) == "main" else None
    return None


def git_dirs(root: str) -> tuple[str, str]:
    """A worktree's own git directory and the repository's common one (equal unless it is linked)."""
    marker = os.path.join(root, ".git")
    if os.path.isdir(marker):
        return marker, marker
    with open(marker) as handle:
        text = handle.read().strip()
    if not text.startswith("gitdir: "):
        raise ValueError(f"unreadable .git file in {root}")
    gitdir = os.path.realpath(os.path.join(root, text[len("gitdir: "):]))
    common = gitdir
    commondir = os.path.join(gitdir, "commondir")
    if os.path.isfile(commondir):
        with open(commondir) as handle:
            common = os.path.realpath(os.path.join(gitdir, handle.read().strip()))
    return gitdir, common


LITERAL = re.compile(r"""(?:^|[\s"'`=:(])((?:~|/)[^\s"'`;|&()<>]*)""")
TOKEN = re.compile(r"""[^\s"'`;|&()<>]+""")


def literals(text: str) -> list[str]:
    return [expand(match) for match in LITERAL.findall(text) if len(match) > 1]


def relatives(text: str) -> list[str]:
    """Relative paths that could reach a main worktree from where the command runs (`cd ../main`)."""
    return [token for token in TOKEN.findall(text) if "main" in token and not token.startswith(("/", "~", "-"))]


def owner_of(cwd: str) -> str | None:
    """The main worktree that owns the repository `cwd` is in, when `cwd` is one of its linked worktrees:
    branch work there writes the main worktree's git metadata (refs, packed-refs, worktrees/)."""
    for directory in ancestors(cwd):
        marker = os.path.join(directory, ".git")
        if os.path.lexists(marker):
            try:
                _, common = git_dirs(directory)
            except (OSError, ValueError):
                return None
            owner = os.path.dirname(common)
            return owner if os.path.basename(owner) == "main" and os.path.basename(common) == ".git" else None
    return None


def discover(policy: dict, cwd: str, text: str) -> tuple[set[str], set[str]]:
    """Every main worktree in the person's project folders, and the ones this command touches."""
    every = set()
    for container in policy["containers"]:
        for candidate in glob.glob(os.path.join(expand(container), "*", "worktrees", "main")):
            if os.path.lexists(os.path.join(candidate, ".git")):
                every.add(os.path.realpath(candidate))
    touched = set()
    for candidate in [cwd, *literals(text), *relatives(text)]:
        root = main_worktree_of(candidate if os.path.isabs(candidate) else os.path.join(cwd, candidate))
        if root:
            touched.add(root)
    owner = owner_of(cwd)
    if owner:
        touched.add(owner)
    return every | touched, touched


def sb(path: str) -> str:
    return json.dumps(path)


def rx(path: str) -> str:
    """A path as a literal inside a sandbox regex (#"..."): only regex metacharacters are escaped."""
    return re.sub(r'([.^$*+?()\[\]{}|\\"])', r"\\\1", path)


# The sandbox profile reader refuses a regex string over 1,023 characters.
REGEX_LIMIT = 900


def chunks(paths: list[str]) -> list[str]:
    out, current = [], []
    for path in paths:
        if current and len("|".join([*current, rx(path)])) > REGEX_LIMIT:
            out.append("|".join(current))
            current = []
        current.append(rx(path))
    if current:
        out.append("|".join(current))
    return out


def precise(root: str) -> list[str]:
    """Rules for a main worktree this command touches, exact to its git layout."""
    deny = []
    gitdir, common = git_dirs(root)
    marker = os.path.join(root, ".git")
    # The tree itself, every file and folder but its git metadata.
    deny.append(f"(require-all (subpath {sb(root)}) (require-not (subpath {sb(marker)})))")
    if os.path.isfile(marker):
        deny.append(f"(literal {sb(marker)})")
    # Git metadata: only what a feature worktree must write. HEAD, index, config, hooks, info and the
    # main branch stay denied. packed-refs is writable only while main is a loose ref, which outranks
    # any packed copy and stays denied itself.
    allowed = [f"(subpath {sb(os.path.join(common, name))})" for name in ("objects", "refs", "logs/refs", "worktrees")]
    allowed.append(f"(literal {sb(os.path.join(common, 'FETCH_HEAD'))})")
    if os.path.isfile(os.path.join(common, "refs", "heads", "main")):
        allowed += [f"(literal {sb(os.path.join(common, name))})" for name in ("packed-refs", "packed-refs.lock")]
    deny.append(f"(require-all (subpath {sb(common)}) " + " ".join(f"(require-not {item})" for item in allowed) + ")")
    for name in ("refs/heads/main", "refs/heads/main.lock", "logs/refs/heads/main"):
        deny.append(f"(literal {sb(os.path.join(common, name))})")
    if gitdir != common:
        deny.append(f"(subpath {sb(gitdir)})")
    return deny


def profile(policy: dict, every: set[str], touched: set[str]) -> str:
    deny = []
    for root in sorted(touched):
        deny += precise(root)
    # Every other main worktree: the same protection in a few regex rules, which the sandbox compiles in
    # milliseconds where one rule per worktree takes over a second for fifty-odd. Their packed-refs stays
    # denied, which only matters to branch work, and branch work touches its owner (precise rules above).
    rest = sorted(every - touched)
    for alternation in chunks(rest):
        deny.append(f'(require-all (regex #"^({alternation})(/|$)") '
                    f'(require-not (regex #"^({alternation})/\\.git/(objects|refs|logs/refs|worktrees)(/|$)")) '
                    f'(require-not (regex #"^({alternation})/\\.git/FETCH_HEAD$")))')
        deny.append(f'(regex #"^({alternation})/\\.git/(logs/)?refs/heads/main(\\.lock)?$")')
    # The reference cannot be carried away: no rename or removal of it or the folders above it.
    folders = sorted({folder for root in every for folder in (root, os.path.dirname(root), os.path.dirname(os.path.dirname(root)))})
    for alternation in chunks(folders):
        deny.append(f'(regex #"^({alternation})$")')
    # No static */worktrees/main pattern: it would also block creating a new project's main worktree.
    # The guard's own files, and places that would load a new hooks module without asking.
    deny.append(f"(subpath {sb(PLUGIN_ROOT)})")
    deny += [f"(subpath {sb(os.path.realpath(expand(path)) if os.path.lexists(expand(path)) else expand(path))})"
             for path in policy["guardFiles"]]
    deny += [f'(regex #"{pattern}")' for pattern in policy["guardPatterns"]]
    return "(version 1)\n(allow default)\n(deny file-write*\n  " + "\n  ".join(deny) + ")\n"


def load_quarantine(policy: dict) -> dict:
    try:
        with open(expand(policy["quarantineFile"])) as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def record_quarantine(policy: dict, root: str, path: str, what: str) -> None:
    file = expand(policy["quarantineFile"])
    entries = load_quarantine(policy)
    entries[root] = {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "path": path, "command": what[:300]}
    os.makedirs(os.path.dirname(file), exist_ok=True)
    with open(file, "w") as handle:
        json.dump(entries, handle, indent=2)


# Programs that hand work to a process outside the sandbox: a container engine writing through a bind
# mount, or a terminal, scheduler or app acting for the command. Only these can write to a main worktree
# while the command itself is sandboxed, so only they are watched.
OUTSIDE = {"ddev", "docker", "docker-compose", "podman", "colima", "lima", "nerdctl",
           "osascript", "tmux", "screen", "open", "launchctl", "crontab", "at", "batch"}


def tied(roots: set[str], cwd: str, text: str) -> list[str]:
    """Main worktrees this command is tied to: run inside one, or naming one."""
    out = []
    for root in sorted(roots):
        inside = cwd == root or cwd.startswith(root + "/")
        named = root in text or any((main_worktree_of(path) or "") == root for path in literals(text))
        if inside or named:
            out.append(root)
    return out


def hands_outside(text: str) -> bool:
    return any(os.path.basename(token) in OUTSIDE for token in TOKEN.findall(text))


def changed_since(root: str, stamp: str) -> str | None:
    """The first path under a main worktree changed after the stamp file, ignored files included."""
    _, common = git_dirs(root)
    for name in ("HEAD", "index", "config", "packed-refs"):
        path = os.path.join(common, name)
        if os.path.exists(path) and os.path.getmtime(path) > os.path.getmtime(stamp):
            return path
    found = subprocess.run(["/usr/bin/find", root, "-path", os.path.join(root, ".git"), "-prune", "-o",
                            "(", "-newer", stamp, "-o", "-cnewer", stamp, ")", "-print", "-quit"],
                           capture_output=True, text=True).stdout.strip()
    return found or None


def run(argv: list[str]) -> int:
    child = subprocess.Popen(argv)
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, lambda number, _frame: child.send_signal(number))
    return child.wait()


def main() -> int:
    args = sys.argv[1:]
    if len(args) == 4 and args[0] == "--command" and args[2] == "--state":
        command, state = base64.b64decode(args[1]).decode(), args[3]
        text = command
        inner = ["/bin/zsh", "-c", 'eval "$1"; __s=$?; pwd >"$2"; exit $__s', "golden-rule", command, state]
    elif len(args) == 2 and args[0] == "--argv":
        inner = json.loads(base64.b64decode(args[1]).decode())
        if not isinstance(inner, list) or not inner or not all(isinstance(item, str) for item in inner):
            raise ValueError("argument vector is not a list of strings")
        text = " ".join(inner)
    else:
        raise ValueError("unrecognised arguments")
    if not os.access(SANDBOX_EXEC, os.X_OK):
        raise RuntimeError("macOS sandbox-exec is not available")
    with open(os.path.join(os.path.dirname(HERE), "policy.json")) as handle:
        policy = json.load(handle)
    cwd = os.path.realpath(os.getcwd())
    every, touched = discover(policy, cwd, text)
    watch = tied(touched, cwd, text)
    held = load_quarantine(policy)
    for root in watch:
        if root in held:
            print(f"{PREFIX} {root} is quarantined: a change was observed there on {held[root]['at']}. "
                  "Commands touching it are refused until Chris clears it with /golden-rule clear. "
                  "Report it to Chris and leave it.", file=sys.stderr)
            return 126
    sandbox = [SANDBOX_EXEC, "-p", profile(policy, every, touched), *inner]
    watch = watch if hands_outside(text) else []
    stamp = None
    if watch:
        fd, stamp = tempfile.mkstemp(prefix="golden-rule-stamp")
        os.close(fd)
        time.sleep(0.01)  # file times have a coarse grain: let the stamp be strictly older than any change
    status = run(sandbox)
    for root in watch:
        path = changed_since(root, stamp)
        if path:
            record_quarantine(policy, root, path, text)
            print(f"\n{PREFIX} a change was observed in the main worktree {root} ({path}) while this command ran. "
                  "Report it to Chris and leave it: remediation is his. Commands touching it are refused until "
                  "he clears it with /golden-rule clear.", file=sys.stderr)
            status = status or 1
    if stamp:
        os.unlink(stamp)
    return status


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # fail closed: nothing ran
        print(f"{PREFIX} the sandbox bootstrap failed ({type(error).__name__}: {error}); the command was not run.", file=sys.stderr)
        sys.exit(126)
