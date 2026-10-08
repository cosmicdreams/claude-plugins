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
  run.py --stdin --state <file>                      the Bash tool's command, on stdin; final directory to <file>
  run.py --command <base64 command> --state <file>   the same, from a mod loaded before --stdin existed
  run.py --argv <base64 JSON argument vector>         another plugin's $.process.run / spawn
"""
from __future__ import annotations

import base64
import fcntl
import glob
import hashlib
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


def governed_repository(common: str, every: set[str] = frozenset()) -> str | None:
    """The main worktree of the repository whose common git directory this is, if it has one: a known main
    worktree sharing this directory (own .git, separate git dir, bare repository), or any worktree registered
    here, under whatever administrative id, whose folder is a main worktree."""
    common = os.path.realpath(common)
    for root in sorted(every):
        try:
            if git_dirs(root)[1] == common:
                return root
        except (OSError, Refused):
            continue
    owner = os.path.dirname(common)
    if is_main(owner) and os.path.realpath(os.path.join(owner, ".git")) == common:
        return owner
    for pointer in glob.glob(os.path.join(common, "worktrees", "*", "gitdir")):
        try:
            with open(pointer) as handle:
                root = os.path.dirname(os.path.realpath(handle.read().strip()))
        except OSError:
            continue
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
        owner = governed_repository(repo[1], every)
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


SEQUENCE = re.compile(r"\s*(?:;|&&|\|\||\n)\s*")
PIPE = re.compile(r"(?<!\|)\|(?!\|)")
# Constructs that change directories in ways a flat reading cannot follow.
SCOPES = re.compile(r"\(|\)|\bpushd\b|\bpopd\b|\$\(|`|\bexec\b|\bsource\b|(^|\s)\.\s")


def git_directory(w: list[str], here: str) -> str:
    """The directory a git command runs in: every `-C <dir>` applies in order, each relative to the last."""
    where = here
    if "git" not in w:
        return where
    args = w[w.index("git") + 1:]
    for i, arg in enumerate(args):
        if arg == "-C" and i + 1 < len(args):
            where = absolute(args[i + 1], where)
        elif not arg.startswith("-") and (i == 0 or args[i - 1] != "-C"):
            break  # the subcommand: options after it are its own
    return where


def governed_owner(directory: str, every: set[str]) -> str | None:
    repo = repository_of(deepest_real(directory))
    return governed_repository(repo[1], every) if repo else None


def governed_pushes(text: str, cwd: str, every: set[str]) -> str | None:
    """Why the command would put work on a governed main without a pull request, or None. Each push is
    judged in the directory it runs in: `cd` in a plain sequence moves it, and every `git -C <dir>` applies.
    Where the command changes directories in a way a reading cannot follow (a `cd` inside a pipeline or
    subshell, pushd, eval and the like), every directory it could be in is judged, and any governed one
    refuses. Repositories without a main worktree are left alone (decision 5)."""
    if not trunk_violation(text):
        return None
    candidates = {cwd}
    here = cwd
    ambiguous = bool(SCOPES.search(text)) or bool(re.search(r"\beval\b", text))
    pushes = []
    for sequence in SEQUENCE.split(text):
        stages = PIPE.split(sequence)
        for stage in stages:
            w = words(stage)
            if w[:1] == ["cd"]:
                target = absolute(w[1], here) if len(w) > 1 and w[1] != "-" else HOME
                candidates.add(target)
                if len(stages) > 1:
                    ambiguous = True  # whether a pipeline's cd persists depends on the shell and its place
                else:
                    here = target
                continue
            why = trunk_violation(stage)
            if why:
                where = git_directory(w, here)
                candidates.add(where)
                pushes.append((why, where))
    for why, where in pushes:
        owner = governed_owner(where, every)
        if owner:
            return f"this {why}; changes reach main only through a pull request (repository of {owner})."
    if ambiguous and pushes:
        for directory in sorted(candidates):
            owner = governed_owner(directory, every)
            if owner:
                return (f"this {pushes[0][0]}, and the command changes directories in a way the guard cannot follow, "
                        f"so it may run in the repository of {owner}; changes reach main only through a pull request.")
    return None


# ---- the sandbox profile --------------------------------------------------------------------------

def sb(path: str) -> str:
    return json.dumps(path)


def rx(path: str) -> str:
    """A path as a literal inside a sandbox regex (#"..."): only regex metacharacters are escaped."""
    return re.sub(r'([.^$*+?()\[\]{}|\\"])', r"\\\1", path)


REGEX_LIMIT = 1023


def chunks(paths: list[str]) -> list[str]:
    """Alternations of paths for regex rules. A path too long to share a rule is left out: callers give it
    literal rules (fits_regex)."""
    out, current = [], []
    for path in (path for path in paths if fits_regex(path)):
        if current and len("|".join([*current, rx(path)]).encode()) > REGEX_BUDGET:
            out.append("|".join(current))
            current = []
        current.append(rx(path))
    if current:
        out.append("|".join(current))
    return out


def fits_regex(path: str) -> bool:
    return len(rx(path).encode()) <= REGEX_BUDGET // 2


def checked(rules: list[str]) -> list[str]:
    """Every regex string within the profile reader's limit, or the profile is not built."""
    for rule in rules:
        for pattern in re.findall(r'#"((?:[^"\\]|\\.)*)"', rule):
            if len(pattern.encode()) > REGEX_LIMIT:
                raise Refused(f"a sandbox rule is {len(pattern.encode())} bytes, over the reader's {REGEX_LIMIT}")
    return rules


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
    # The tree itself, every file and folder but its .git; a .git file (linked worktree, separate git dir)
    # is itself protected, since rewriting it would redirect the main worktree to another repository.
    deny.append(f"(require-all (subpath {sb(root)}) (require-not (subpath {sb(marker)})))")
    if os.path.isfile(marker):
        deny.append(f"(literal {sb(marker)})")
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
        # A linked main worktree: its own HEAD and index live in <common>/worktrees/<id>; the shared
        # directory's HEAD and index belong to the repository's first checkout and stay writable.
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
    rest = sorted(root for root in every - touched if fits_regex(root))
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
    deny += [f"(literal {sb(folder)})" for folder in folders if not fits_regex(folder)]
    return "(version 1)\n(allow default)\n(deny file-write*\n  " + "\n  ".join(checked(deny)) + ")\n"


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


def metadata_state(root: str) -> dict:
    """What the protected git state holds: each file's presence and content digest, hooks included."""
    gitdir, common = git_dirs(root)
    paths = [os.path.join(gitdir, "HEAD"), os.path.join(gitdir, "index"), os.path.join(common, "config"),
             os.path.join(common, "packed-refs"), os.path.join(common, "refs", "heads", "main")]
    for folder in (os.path.join(common, "hooks"), os.path.join(common, "info")):
        for directory, _, names in os.walk(folder):
            paths += [os.path.join(directory, name) for name in names]
    state = {}
    for path in paths:
        try:
            with open(path, "rb") as handle:
                state[path] = hashlib.sha256(handle.read()).hexdigest()
        except FileNotFoundError:
            state[path] = None
    return state


def changed_since(root: str, stamp: str, before: dict) -> str | None:
    """The first path under a main worktree, or in its protected git state, changed after the stamp."""
    after = metadata_state(root)
    for path in sorted(set(before) | set(after)):
        if before.get(path) != after.get(path):
            return path
    found = subprocess.run(["/usr/bin/find", root, "-path", os.path.join(root, ".git"), "-prune", "-o",
                            "(", "-newer", stamp, "-o", "-cnewer", stamp, ")", "-print", "-quit"],
                           capture_output=True, text=True)
    if found.returncode != 0:
        raise RuntimeError(f"could not scan {root}: {found.stderr.strip()[:200]}")
    return found.stdout.strip() or None


# ---- running --------------------------------------------------------------------------------------

def run(argv: list[str], stdin=None) -> int:
    child = subprocess.Popen(argv, stdin=stdin)
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, lambda number, _frame: child.send_signal(number))
    status = child.wait()
    return 128 - status if status < 0 else status  # a signal reads as the shell reports it


def shell(command: str, state: str) -> list[str]:
    # The final directory is written on any exit, `exit` inside the command included.
    script = 'trap \'pwd >"$__gr_state"\' EXIT; eval "$1"'
    return ["/usr/bin/env", f"__gr_state={state}", "/bin/zsh", "-c", script, "golden-rule", command]


def prepare(args: list[str]) -> tuple[list[str], str]:
    if len(args) == 3 and args[0] == "--stdin" and args[1] == "--state":
        # The command is the body of the wrapper's heredoc, which ends in the one newline it adds.
        command = sys.stdin.buffer.read().decode()
        if not command.endswith("\n"):
            raise Refused("the command did not arrive whole")
        return shell(command[:-1], args[2]), command[:-1]
    if len(args) == 4 and args[0] == "--command" and args[2] == "--state":
        command = base64.b64decode(args[1]).decode()
        return shell(command, args[3]), command
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
    trunk = governed_pushes(text, cwd, every)
    if trunk:
        raise Refused(trunk)
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
    before = {root: metadata_state(root) for root in watch}
    if watch:
        fd, stamp = tempfile.mkstemp(prefix="golden-rule-stamp")
        os.close(fd)
        time.sleep(0.01)  # file times have a coarse grain: let the stamp be strictly older than any change
    # The heredoc was this process's input; the command gets none, as the Bash tool gives none.
    status = run(sandbox, subprocess.DEVNULL if sys.argv[1] == "--stdin" else None)
    # From here the command has run: nothing below may report it as not run.
    try:
        if observe(policy, watch, stamp, before, text):
            status = status or 1
    except Exception as error:
        print(f"\n{PREFIX} the command ran, but the guard could not check or record the main worktrees it "
              f"touched ({', '.join(watch)}): {error}. Tell Chris before doing anything else there.", file=sys.stderr)
        status = status or 1
    finally:
        if stamp and os.path.exists(stamp):
            os.unlink(stamp)
    return status


def observe(policy: dict, watch: list[str], stamp: str | None, before: dict, text: str) -> bool:
    """After a watched command: quarantine every main worktree that changed, or that could not be checked.
    Answers whether any was quarantined."""
    held = False
    for root in watch:
        try:
            path = changed_since(root, stamp, before[root])
        except Exception as error:  # an unobserved outcome quarantines rather than passes
            record_quarantine(policy, root, f"(could not be checked: {error})", text)
            held = True
            print(f"\n{PREFIX} the command ran, but the check of {root} failed ({error}); quarantined until Chris "
                  "has looked.", file=sys.stderr)
            continue
        if path:
            record_quarantine(policy, root, path, text)
            held = True
            print(f"\n{PREFIX} a change was observed in the main worktree {root} ({path}) while this command ran. "
                  "Report it to Chris and leave it: remediation is his. Commands touching it are refused until "
                  "he clears it with /golden-rule clear.", file=sys.stderr)
    return held


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refused as refusal:
        print(f"{PREFIX} {refusal}", file=sys.stderr)
        sys.exit(126)
    except Exception as error:  # fail closed: nothing ran
        print(f"{PREFIX} the sandbox bootstrap failed ({type(error).__name__}: {error}); the command was not run.", file=sys.stderr)
        sys.exit(126)
