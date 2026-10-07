#!/usr/bin/env python3
"""Run one shell command (or another plugin's argument vector) inside the golden rule's sandbox.

The golden-rule mod rewrites every Bash and Monitor command to call this script. It runs outside the
sandbox, computes the profile from the shell's real working directory at execution time (so the model
never sees or edits the policy), runs the command under /usr/bin/sandbox-exec, and passes the exit
status through. Writes into a main worktree (a working-tree root named `main`, in practice
<project>/worktrees/main) are denied, except the git metadata a feature worktree must write. Pushes to
`main` from a governed repository are refused. Around a command tied to a main worktree that hands work
to a process outside the sandbox (a container engine, a terminal, a scheduler) it watches for changes and
quarantines the worktree when one appears.

Anything that goes wrong before the command runs refuses it (exit 126): the guard fails closed. Anything
that goes wrong after it ran quarantines the main worktrees it was tied to.

Usage:
  run.py --command <base64 command> --state <file>   the Bash tool's command; final directory to <file>
  run.py --argv <base64 JSON argument vector>         another plugin's $.process.run / spawn
"""
from __future__ import annotations

import base64
import fcntl
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
# The sandbox profile reader refuses a regex string over 1,023 bytes; leave room for prefixes and suffixes.
REGEX_BUDGET = 900
# Programs that hand work to a process outside the sandbox: a container engine writing through a bind
# mount, or a terminal, scheduler or app acting for the command. Only these can write to a main worktree
# while the command itself is sandboxed, so commands naming them are watched.
OUTSIDE = {"ddev", "docker", "docker-compose", "podman", "colima", "lima", "nerdctl",
           "osascript", "tmux", "screen", "open", "launchctl", "crontab", "at", "batch"}


class Refused(Exception):
    """A decision to refuse the command before it runs, with the reason the model reads."""


# ---- paths ----------------------------------------------------------------------------------------

def expand(path: str) -> str:
    if path == "~" or path.startswith("~/"):
        return HOME + path[1:]
    if path.startswith("~"):
        return os.path.expanduser(path)  # ~user; left as typed when there is no such user
    return path


def ancestors(path: str):
    while True:
        yield path
        parent = os.path.dirname(path)
        if parent == path:
            return
        path = parent


def absolute(path: str, cwd: str) -> str:
    path = expand(path)
    return os.path.normpath(path if os.path.isabs(path) else os.path.join(cwd, path))


def deepest_real(path: str) -> str:
    """Where an absolute path lands: its own real path, or its deepest existing folder's plus the rest."""
    rest = []
    for at in ancestors(path):
        if os.path.lexists(at):
            return os.path.join(os.path.realpath(at), *reversed(rest))
        rest.append(os.path.basename(at))
    return path


def is_main(directory: str) -> bool:
    return os.path.basename(directory).casefold() == "main" and os.path.lexists(os.path.join(directory, ".git"))


def main_worktree_of(path: str, cwd: str) -> str | None:
    """The nearest ancestor that is a working-tree root named main (any case), if any."""
    for directory in ancestors(deepest_real(absolute(path, cwd))):
        if is_main(directory):
            return directory
    return None


def git_dirs(root: str) -> tuple[str, str]:
    """A worktree's own git directory and the repository's common one (equal unless it is linked)."""
    marker = os.path.join(root, ".git")
    if os.path.isdir(marker):
        return os.path.realpath(marker), os.path.realpath(marker)
    with open(marker) as handle:
        text = handle.read().strip()
    if not text.startswith("gitdir: "):
        raise Refused(f"cannot read the .git file in {root}")
    gitdir = os.path.realpath(os.path.join(root, text[len("gitdir: "):]))
    common = gitdir
    commondir = os.path.join(gitdir, "commondir")
    if os.path.isfile(commondir):
        with open(commondir) as handle:
            common = os.path.realpath(os.path.join(gitdir, handle.read().strip()))
    return gitdir, common


def repository_of(cwd: str) -> tuple[str, str] | None:
    """The working tree `cwd` is in and that repository's common git directory."""
    for directory in ancestors(cwd):
        if os.path.lexists(os.path.join(directory, ".git")):
            try:
                return directory, git_dirs(directory)[1]
            except (OSError, Refused):
                return None
    return None


def governed_repository(common: str) -> str | None:
    """The main worktree of the repository whose common git directory this is, if it has one."""
    owner = os.path.dirname(common)
    if os.path.basename(common) == ".git" and is_main(owner):
        return owner
    pointer = os.path.join(common, "worktrees", "main", "gitdir")
    if os.path.isfile(pointer):
        with open(pointer) as handle:
            root = os.path.dirname(os.path.realpath(handle.read().strip()))
        if is_main(root):
            return root
    return None


# ---- what a command names -------------------------------------------------------------------------

TOKEN = re.compile(r"""[^\s"'`;|&()<>]+""")
SEGMENT = re.compile(r"\s*(?:;|&&|\|\||\||\n)\s*")


def path_tokens(text: str) -> list[str]:
    """Absolute, home-relative and relative tokens that could name a main worktree."""
    out = []
    for token in TOKEN.findall(text):
        token = token.split("=", 1)[1] if "=" in token and not token.startswith(("/", "~")) else token
        if token.startswith(("/", "~")) and len(token) > 1:
            out.append(token)
        elif re.search(r"(^|/)main(/|$)", token, re.IGNORECASE) and not token.startswith("-"):
            out.append(token)
    return out


def discover(policy: dict, cwd: str, text: str) -> tuple[set[str], set[str]]:
    """Every main worktree in the person's project folders, and the ones this command touches."""
    every = set()
    for container in policy["containers"]:
        for candidate in glob.glob(os.path.join(expand(container), "*", "worktrees", "main")):
            if is_main(candidate):
                every.add(os.path.realpath(candidate))
    touched = set()
    for candidate in [cwd, *path_tokens(text)]:
        root = main_worktree_of(candidate, cwd)
        if root:
            touched.add(os.path.realpath(root))
    repo = repository_of(cwd)
    if repo:
        owner = governed_repository(repo[1])
        if owner:
            touched.add(owner)
    # A linked main worktree keeps its git metadata outside its folder: give it the exact rules always.
    touched |= {root for root in every if os.path.isfile(os.path.join(root, ".git"))}
    return every | touched, touched


# ---- pushes to main -------------------------------------------------------------------------------

def words(segment: str) -> list[str]:
    return [a or b or c for a, b, c in re.findall(r'"([^"]*)"|\'([^\']*)\'|(\S+)', segment)]


def trunk_violation(text: str) -> str | None:
    """Why a command would put work on main without a pull request, or None."""
    for segment in SEGMENT.split(text):
        w = words(segment)
        if "git" in w and "push" in w[w.index("git") + 1:]:
            args = w[w.index("push", w.index("git")) + 1:]
            if any(arg in ("--mirror", "--all") for arg in args):
                return "pushes every branch, main included"
            for spec in [arg for arg in args if not arg.startswith("-")][1:]:
                target = spec.lstrip("+").split(":")[-1]
                if re.fullmatch(r"(refs/heads/)?main", target):
                    return f"pushes to {target}"
        if "gh" in w:
            rest = w[w.index("gh") + 1:]
            if rest[:2] == ["pr", "merge"] and "--admin" in rest:
                return "merges past branch protection (--admin)"
            if rest[:1] == ["api"] and any(re.search(r"refs/heads/main\b", arg) for arg in rest) and \
                    any(re.fullmatch(r"(-X|--method)", arg) and i + 1 < len(rest) and rest[i + 1].upper() in ("POST", "PATCH", "PUT", "DELETE")
                        for i, arg in enumerate(rest)):
                return "changes refs/heads/main through the API"
    return None


def push_target_repository(text: str, cwd: str) -> str:
    """The working tree a push runs in: a `git -C <dir>` argument, else the command's directory."""
    match = re.search(r"git\s+-C\s+(\S+)", text)
    return absolute(match.group(1).strip("'\""), cwd) if match else cwd


# ---- the sandbox profile --------------------------------------------------------------------------

def sb(path: str) -> str:
    return json.dumps(path)


def rx(path: str) -> str:
    """A path as a literal inside a sandbox regex (#"..."): only regex metacharacters are escaped."""
    return re.sub(r'([.^$*+?()\[\]{}|\\"])', r"\\\1", path)


def chunks(paths: list[str]) -> list[str]:
    out, current = [], []
    for path in paths:
        if current and len("|".join([*current, rx(path)]).encode()) > REGEX_BUDGET:
            out.append("|".join(current))
            current = []
        current.append(rx(path))
    if current:
        out.append("|".join(current))
    return out


def metadata_nodes(common: str) -> list[str]:
    """Folders holding the main ref or its log, whose renaming would carry them away. Only existing ones:
    a rule on a folder not there yet would also stop git creating it (logs/, worktrees/ on first use)."""
    names = ("refs", "refs/heads", "logs", "logs/refs", "logs/refs/heads")
    return [path for path in (os.path.join(common, name) for name in names) if os.path.isdir(path)]


def precise(root: str) -> list[str]:
    """Rules for a main worktree, exact to its git layout."""
    deny = []
    gitdir, common = git_dirs(root)
    marker = os.path.join(root, ".git")
    # The tree itself, every file and folder but its .git.
    deny.append(f"(require-all (subpath {sb(root)}) (require-not (subpath {sb(marker)})))")
    if gitdir == common:
        # Its own git directory: only what a feature worktree must write. HEAD, index, config, hooks,
        # info and the main branch stay denied. packed-refs is writable only while main is a loose ref,
        # which outranks any packed copy and whose file and folders cannot be removed or renamed.
        allowed = [f"(subpath {sb(os.path.join(common, name))})" for name in ("objects", "refs", "logs/refs", "worktrees")]
        allowed.append(f"(literal {sb(os.path.join(common, 'FETCH_HEAD'))})")
        if os.path.isfile(os.path.join(common, "refs", "heads", "main")):
            allowed += [f"(literal {sb(os.path.join(common, name))})" for name in ("packed-refs", "packed-refs.lock")]
        deny.append(f"(require-all (subpath {sb(common)}) " + " ".join(f"(require-not {item})" for item in allowed) + ")")
    else:
        # A linked main worktree: its own HEAD and index live in <common>/worktrees/main; the shared
        # directory's HEAD and index belong to the repository's first checkout and stay writable.
        deny.append(f"(literal {sb(marker)})")
        deny.append(f"(subpath {sb(gitdir)})")
        for name in ("config", "hooks", "info"):
            deny.append(f"(subpath {sb(os.path.join(common, name))})")
        if not os.path.isfile(os.path.join(common, "refs", "heads", "main")):
            deny += [f"(literal {sb(os.path.join(common, name))})" for name in ("packed-refs", "packed-refs.lock")]
    for name in ("refs/heads/main", "refs/heads/main.lock", "logs/refs/heads/main"):
        deny.append(f"(literal {sb(os.path.join(common, name))})")
    deny += [f"(literal {sb(node)})" for node in [common, *metadata_nodes(common)]]
    return deny


def compact(roots: list[str]) -> list[str]:
    """The same protection for main worktrees a command does not touch, in a few regex rules: one rule
    per worktree made the sandbox take over a second to compile for fifty-odd."""
    deny = []
    for alternation in chunks(roots):
        deny.append(f'(require-all (regex #"^({alternation})(/|$)") '
                    f'(require-not (regex #"^({alternation})/\\.git/(objects|refs|logs/refs|worktrees)(/|$)")) '
                    f'(require-not (regex #"^({alternation})/\\.git/FETCH_HEAD$")))')
        deny.append(f'(regex #"^({alternation})/\\.git/(logs/)?refs/heads/main(\\.lock)?$")')
        deny.append(f'(regex #"^({alternation})/\\.git(/(refs|refs/heads))?$")')
    return deny


def protected_ancestors(path: str) -> list[str]:
    """The folders above a protected path, up to the home folder: none may be renamed or removed."""
    return [folder for folder in ancestors(os.path.dirname(path)) if folder != HOME and folder.startswith(HOME + "/")]


def profile(policy: dict, every: set[str], touched: set[str]) -> str:
    deny = []
    for root in sorted(touched):
        deny += precise(root)
    rest = sorted(root for root in every - touched if len(rx(root).encode()) <= REGEX_BUDGET // 2)
    for root in sorted(every - touched - set(rest)):  # a path too long for a regex gets exact rules
        deny += precise(root)
    deny += compact(rest)
    # No static */worktrees/main pattern: it would also block creating a new project's main worktree.
    guarded = [PLUGIN_ROOT, *(os.path.realpath(expand(path)) if os.path.lexists(expand(path)) else expand(path)
                              for path in policy["guardFiles"])]
    deny += [f"(subpath {sb(path)})" for path in guarded]
    deny += [f'(regex #"{pattern}")' for pattern in policy["guardPatterns"]]
    # Nothing protected can be carried away: not a main worktree, the folders above it, or the guard's.
    # A main worktree's own folder, its worktrees/ folder and its project folder, wherever they are, plus
    # every folder above them inside the home folder.
    folders = sorted({folder for root in every
                      for folder in [root, os.path.dirname(root), os.path.dirname(os.path.dirname(root)), *protected_ancestors(root)]} |
                     {folder for path in guarded for folder in protected_ancestors(path)})
    for alternation in chunks(folders):
        deny.append(f'(regex #"^({alternation})$")')
    return "(version 1)\n(allow default)\n(deny file-write*\n  " + "\n  ".join(deny) + ")\n"


# ---- quarantine -----------------------------------------------------------------------------------

def quarantine_path(policy: dict) -> str:
    return expand(policy["quarantineFile"])


def load_quarantine(policy: dict) -> dict:
    """The quarantine record. Missing means nothing is quarantined; unreadable refuses, never clears."""
    path = quarantine_path(policy)
    if not os.path.exists(path):
        return {}
    with open(path) as handle:
        data = json.load(handle)
    if not isinstance(data, dict) or not all(isinstance(value, dict) for value in data.values()):
        raise Refused(f"the quarantine record {path} is not in the expected form")
    return data


def record_quarantine(policy: dict, root: str, path: str, what: str) -> None:
    file = quarantine_path(policy)
    os.makedirs(os.path.dirname(file), exist_ok=True)
    with open(file + ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            entries = load_quarantine(policy)
        except (ValueError, Refused):
            entries = {}
        entries[root] = {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "path": path, "command": what[:300]}
        fd, temp = tempfile.mkstemp(dir=os.path.dirname(file), prefix=".quarantine")
        with os.fdopen(fd, "w") as handle:
            json.dump(entries, handle, indent=2)
        os.replace(temp, file)


# ---- the tripwire ---------------------------------------------------------------------------------

def tied(roots: set[str], cwd: str, text: str) -> list[str]:
    """Main worktrees this command is tied to: run inside one, or naming one."""
    named = {main_worktree_of(token, cwd) for token in path_tokens(text)}
    return [root for root in sorted(roots) if cwd == root or cwd.startswith(root + "/") or root in named or root in text]


def hands_outside(text: str) -> bool:
    return any(os.path.basename(token) in OUTSIDE for token in TOKEN.findall(text))


def changed_since(root: str, stamp: str) -> str | None:
    """The first path under a main worktree, or in its protected git state, changed after the stamp."""
    gitdir, common = git_dirs(root)
    since = os.path.getmtime(stamp)
    for path in {os.path.join(gitdir, "HEAD"), os.path.join(gitdir, "index"), os.path.join(common, "config"),
                 os.path.join(common, "packed-refs"), os.path.join(common, "refs", "heads", "main"), os.path.join(common, "hooks")}:
        if os.path.exists(path) and max(os.path.getmtime(path), os.path.getctime(path)) > since:
            return path
    found = subprocess.run(["/usr/bin/find", root, "-path", os.path.join(root, ".git"), "-prune", "-o",
                            "(", "-newer", stamp, "-o", "-cnewer", stamp, ")", "-print", "-quit"],
                           capture_output=True, text=True)
    if found.returncode != 0:
        raise RuntimeError(f"could not scan {root}: {found.stderr.strip()[:200]}")
    return found.stdout.strip() or None


# ---- running --------------------------------------------------------------------------------------

def run(argv: list[str]) -> int:
    child = subprocess.Popen(argv)
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, lambda number, _frame: child.send_signal(number))
    status = child.wait()
    return 128 - status if status < 0 else status  # a signal reads as the shell reports it


def prepare(args: list[str]) -> tuple[list[str], str]:
    if len(args) == 4 and args[0] == "--command" and args[2] == "--state":
        command, state = base64.b64decode(args[1]).decode(), args[3]
        # The final directory is written on any exit, `exit` inside the command included.
        script = 'trap \'pwd >"$__gr_state"\' EXIT; eval "$1"'
        return ["/usr/bin/env", f"__gr_state={state}", "/bin/zsh", "-c", script, "golden-rule", command], command
    if len(args) == 2 and args[0] == "--argv":
        inner = json.loads(base64.b64decode(args[1]).decode())
        if not isinstance(inner, list) or not inner or not all(isinstance(item, str) for item in inner):
            raise Refused("the argument vector is not a list of strings")
        return inner, " ".join(inner)
    raise Refused("unrecognised arguments")


def main() -> int:
    inner, text = prepare(sys.argv[1:])
    if not os.access(SANDBOX_EXEC, os.X_OK):
        raise Refused("macOS sandbox-exec is not available")
    with open(os.path.join(os.path.dirname(HERE), "policy.json")) as handle:
        policy = json.load(handle)
    cwd = os.path.realpath(os.getcwd())
    every, touched = discover(policy, cwd, text)
    trunk = trunk_violation(text)
    if trunk:
        repo = repository_of(push_target_repository(text, cwd))
        owner = governed_repository(repo[1]) if repo else None
        if owner:
            raise Refused(f"this {trunk}; changes reach main only through a pull request (repository of {owner}).")
    watch = tied(touched, cwd, text)
    held = load_quarantine(policy)
    for root in watch:
        if root in held:
            raise Refused(f"{root} is quarantined: a change was observed there on {held[root].get('at', '?')}. "
                          "Commands touching it are refused until Chris clears it with /golden-rule clear. "
                          "Report it to Chris and leave it.")
    sandbox = [SANDBOX_EXEC, "-p", profile(policy, every, touched), *inner]
    watch = watch if hands_outside(text) else []
    stamp = None
    if watch:
        fd, stamp = tempfile.mkstemp(prefix="golden-rule-stamp")
        os.close(fd)
        time.sleep(0.01)  # file times have a coarse grain: let the stamp be strictly older than any change
    status = run(sandbox)
    try:
        for root in watch:
            path = changed_since(root, stamp)
            if path:
                record_quarantine(policy, root, path, text)
                print(f"\n{PREFIX} a change was observed in the main worktree {root} ({path}) while this command ran. "
                      "Report it to Chris and leave it: remediation is his. Commands touching it are refused until "
                      "he clears it with /golden-rule clear.", file=sys.stderr)
                status = status or 1
    except Exception as error:  # the command ran; an unobserved outcome quarantines rather than passes
        for root in watch:
            record_quarantine(policy, root, "(could not be checked)", text)
        print(f"\n{PREFIX} the command ran, but the check of {', '.join(watch)} failed ({error}); "
              "quarantined until Chris has looked.", file=sys.stderr)
        status = status or 1
    finally:
        if stamp:
            os.unlink(stamp)
    return status


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refused as refusal:
        print(f"{PREFIX} {refusal}", file=sys.stderr)
        sys.exit(126)
    except Exception as error:  # fail closed: nothing ran
        print(f"{PREFIX} the sandbox bootstrap failed ({type(error).__name__}: {error}); the command was not run.", file=sys.stderr)
        sys.exit(126)
