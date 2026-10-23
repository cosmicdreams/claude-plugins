#!/usr/bin/env python3
"""Run one shell command (or another plugin's argument vector) under the golden rule.

The golden-rule mod rewrites every Bash and Monitor command to call this script, which knows the shell's
real working directory. The rule it enforces is narrow: a main worktree (a working-tree root named `main`,
in practice <project>/worktrees/main) never keeps a change that could be committed, and work reaches main
only through a pull request. Everything else, gitignored files in main included, is free.

Before the command:
- a push to `main` from a governed repository, `gh pr merge --admin` and API writes to refs/heads/main
  are refused;
- a git command run in a main worktree that would move its HEAD or branch (commit, merge, rebase,
  checkout or switch to another branch, reset to another commit, pull without --ff-only, renaming or
  deleting main, stash pop) is refused.

Around a command tied to a main worktree (run inside it, or naming it), `git status` is taken before and
after. Every tracked file the command changed is restored from HEAD and every new file git does not ignore
is deleted; a path that was already changed before is left alone and reported (committable.py).

A command that names the guard's own files (the plugin folder, the settings hook), or removes or renames
a main worktree's folder or its .git, is refused; after every command the guard's files are compared with
before. There is no sandbox: one would break every tool that applies its own (Codex, some build tools).

Anything that goes wrong before the command runs refuses it (exit 126).

Usage:
  run.py --stdin --state <file>                      the Bash tool's command, on stdin; final directory to <file>
  run.py --command <base64 command> --state <file>   the same, from a mod loaded before --stdin existed
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

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, HERE)  # -I leaves the script's own folder off the path

import committable  # noqa: E402
PLUGIN_ROOT = os.path.dirname(os.path.dirname(HERE))
HOME = pwd.getpwuid(os.getuid()).pw_dir  # not $HOME, which a command could change
PREFIX = "golden-rule:"


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
            return os.path.realpath(directory)
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
    """The main worktree of the repository whose common git directory this is, if it has one."""
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


def every_main(policy: dict) -> set[str]:
    """Every main worktree in the person's project folders."""
    found = set()
    for container in policy["containers"]:
        for candidate in glob.glob(os.path.join(expand(container), "*", "worktrees", "main")):
            if is_main(candidate):
                found.add(os.path.realpath(candidate))
    return found


def tied(cwd: str, text: str) -> list[str]:
    """Main worktrees this command is tied to: run inside one, or naming one."""
    roots = {main_worktree_of(candidate, cwd) for candidate in [cwd, *path_tokens(text)]}
    return sorted(root for root in roots if root)


# ---- git commands, wherever they run --------------------------------------------------------------

REDIRECT = re.compile(r"^(\d*|&)(>>?|<<?<?|>&|<&|&>>?)(.*)$")


def words(segment: str) -> list[str]:
    """A stage's words, quotes removed, redirections (`2>&1`, `> log`, `<in`) and their targets left out."""
    out, skip = [], False
    for a, b, c in re.findall(r'"([^"]*)"|\'([^\']*)\'|(\S+)', segment):
        if skip:
            skip = False
            continue
        match = REDIRECT.match(c) if c else None
        if match:
            skip = match.group(3) == ""  # the target is the next word
            continue
        out.append(a or b or c)
    return out


SEQUENCE = re.compile(r"\s*(?:;|&&|\|\||\n)\s*")
PIPE = re.compile(r"(?<!\|)\|(?!\|)")
# Constructs that change directories in ways a flat reading cannot follow.
SCOPES = re.compile(r"\(|\)|\bpushd\b|\bpopd\b|\$\(|`|\bexec\b|\bsource\b|\beval\b|(^|\s)\.\s")
# Global options of git that take a separate value.
VALUED = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--exec-path"}


def git_call(w: list[str], here: str) -> tuple[str, list[str]] | None:
    """For a stage that runs git: the directory it works in (every `-C` applied in order, `--work-tree`
    last) and the subcommand with its arguments."""
    at = next((i for i, word in enumerate(w) if os.path.basename(word) == "git"), None)
    if at is None:
        return None
    where, args, i = here, w[at + 1:], 0
    while i < len(args) and args[i].startswith("-"):
        arg = args[i]
        if arg in VALUED and i + 1 < len(args):
            if arg == "-C":
                where = absolute(args[i + 1], where)
            elif arg == "--work-tree":
                where = absolute(args[i + 1], where)
            i += 2
            continue
        if arg.startswith("--work-tree="):
            where = absolute(arg.split("=", 1)[1], where)
        i += 1
    return where, args[i:]


def git_calls(text: str, cwd: str) -> tuple[list[tuple[str, list[str]]], set[str], bool]:
    """Every git invocation in the command with the directory it runs in, every directory the command
    could be in, and whether it changes directories in a way a flat reading cannot follow."""
    candidates, here, calls = {cwd}, cwd, []
    ambiguous = bool(SCOPES.search(text))
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
            call = git_call(w, here)
            if call:
                candidates.add(call[0])
                calls.append(call)
    return calls, candidates, ambiguous


def trunk_violation(text: str) -> str | None:
    """Why a command would put work on main without a pull request, or None."""
    for segment in re.split(r"\s*(?:;|&&|\|\||\||\n)\s*", text):
        w = words(segment)
        call = git_call(w, "/")
        if call and call[1][:1] == ["push"]:
            args = call[1][1:]
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


def governed_owner(directory: str, every: set[str]) -> str | None:
    repo = repository_of(deepest_real(directory))
    return governed_repository(repo[1], every) if repo else None


def governed_pushes(text: str, cwd: str, every: set[str]) -> str | None:
    """Why the command would put work on a governed main without a pull request, or None. Each push is
    judged in the directory it runs in; where the command changes directories in a way a reading cannot
    follow, every directory it could be in is judged. Repositories without a main worktree are left alone."""
    if not trunk_violation(text):
        return None
    calls, candidates, ambiguous = git_calls(text, cwd)
    pushes = [(why, where) for where, sub in calls if (why := trunk_violation(" ".join(["git", *sub])))]
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
    # gh pr merge --admin and API writes carry no git directory: judge them where the command runs.
    if not pushes:
        for directory in sorted(candidates):
            owner = governed_owner(directory, every)
            if owner:
                return f"this {trunk_violation(text)}; changes reach main only through a pull request (repository of {owner})."
    return None


def positionals(args: list[str]) -> list[str]:
    """Arguments before `--` that are not options."""
    out = []
    for arg in args:
        if arg == "--":
            break
        if not arg.startswith("-"):
            out.append(arg)
    return out


def moves_head(sub: list[str]) -> str | None:
    """Why a git subcommand run in a main worktree would move its HEAD or branch, or None. Changes to
    files and the index are not judged here: the after-check puts those back."""
    if not sub:
        return None
    name, args = sub[0], sub[1:]
    pos = positionals(args)
    if name in ("commit", "rebase", "cherry-pick", "revert", "am", "filter-branch", "filter-repo"):
        return f"git {name} moves main's HEAD"
    if name == "merge" and "--ff-only" not in args and not ({"--abort", "--quit"} & set(args)):
        return "git merge without --ff-only can make a commit on main"
    if name == "pull" and "--ff-only" not in args:
        return "git pull without --ff-only can make a commit on main; use git pull --ff-only"
    if name == "reset" and any(p not in ("HEAD", "@") for p in pos):
        return "git reset to another commit moves main"
    if name == "checkout" and "--" not in args and (set(args) & {"-b", "-B", "--orphan", "--detach"} or any(p != "main" for p in pos[:1])):
        return "git checkout of another branch or commit takes the main worktree off main (to restore files, use git checkout -- <path>)"
    if name == "switch" and pos[:1] != ["main"]:
        return "git switch takes the main worktree off main"
    if name == "branch" and (set(args) & {"-m", "-M", "--move"} or (set(args) & {"-d", "-D", "--delete", "-f", "--force"} and "main" in pos)):
        return "git branch would rename, delete or reset main"
    if name == "stash" and pos[:1] and pos[0] in ("pop", "apply", "branch"):
        return "git stash pop/apply brings changes into main (they would be reverted, and pop would drop the stash)"
    if name == "update-ref" and any(re.fullmatch(r"(refs/heads/main|HEAD)", p) for p in pos):
        return "git update-ref of main moves it"
    if name == "symbolic-ref" and len(pos) >= 2:
        return "git symbolic-ref would point main's HEAD elsewhere"
    if name == "worktree" and pos[:1] and pos[0] in ("move", "remove"):
        return "git worktree move/remove of a main worktree"
    return None


def head_violation(text: str, cwd: str) -> str | None:
    """Why the command would move a main worktree's HEAD or branch, or None."""
    calls, candidates, ambiguous = git_calls(text, cwd)
    for where, sub in calls:
        why = moves_head(sub)
        if not why:
            continue
        if sub[0] == "worktree":
            targets = [main_worktree_of(p, where) for p in positionals(sub[2:])]
            if any(targets):
                return f"{why} ({next(t for t in targets if t)})."
            continue
        root = main_worktree_of(where, cwd)
        if root:
            return f"{why} ({root}). Make the change in a sibling worktree: git -C {root} worktree add ../<topic> -b feature/<topic> --no-track origin/main"
        if ambiguous:
            for directory in sorted(candidates):
                root = main_worktree_of(directory, cwd)
                if root:
                    return (f"{why}, and the command changes directories in a way the guard cannot follow, so it may run "
                            f"in the main worktree {root}.")
    return None


# ---- the guard itself ----------------------------------------------------------------------------

def guard_paths(policy: dict) -> list[str]:
    return [PLUGIN_ROOT, *(os.path.realpath(expand(path)) if os.path.lexists(expand(path)) else expand(path)
                           for path in policy["guardFiles"])]


def inside(path: str, root: str) -> bool:
    return path.casefold() == root.casefold() or path.casefold().startswith(root.casefold() + "/")


def guard_violation(text: str, cwd: str, policy: dict, every: set[str]) -> str | None:
    """Why the command reaches the guard's own files or would carry a main worktree away, or None."""
    guarded = guard_paths(policy)
    placed = [deepest_real(absolute(token, cwd)) for token in path_tokens(text)]
    for path in placed:
        if any(inside(path, root) for root in guarded):
            return f"{path} belongs to the golden rule's guard, which a session never changes."
    if re.search(r"(^|[\s;&|(])(rm|rmdir|mv|trash)\s", text):
        for path in placed:
            for root in every:
                if path.casefold() in (root.casefold(), os.path.join(root, ".git").casefold()):
                    return f"that would remove or move the main worktree {root}."
    for pattern in policy.get("guardPatterns", []):
        if re.search(pattern, text):
            return "that names a path the golden rule's guard protects."
    return None


def fingerprint(policy: dict) -> dict[str, tuple]:
    """Every guard file's size, time and mode, to see whether a command changed one."""
    out: dict[str, tuple] = {}
    for root in guard_paths(policy):
        for directory, _, names in os.walk(root) if os.path.isdir(root) else [(os.path.dirname(root), [], [os.path.basename(root)])]:
            for name in names:
                path = os.path.join(directory, name)
                try:
                    info = os.lstat(path)
                    out[path] = (info.st_size, info.st_mtime_ns, info.st_mode)
                except FileNotFoundError:
                    out[path] = ()
    return out


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


def report(root: str, outcome: dict) -> bool:
    """Tell the model what was put back in a main worktree. Answers whether there was anything to say."""
    lines = []
    if outcome["reverted"]:
        shown = ", ".join(outcome["reverted"][:10]) + (f" and {len(outcome['reverted']) - 10} more" if len(outcome["reverted"]) > 10 else "")
        lines.append(f"reverted committable changes this command made in the main worktree {root}: {shown}.")
    if outcome["left"]:
        lines.append(f"left as they were (already changed before this command, or not safe to undo): {', '.join(outcome['left'][:10])}.")
    lines += outcome["notes"]
    if not lines:
        return False
    print(f"\n{PREFIX} " + f"\n{PREFIX} ".join(lines) + f"\n{PREFIX} main keeps no committable change; make it in a sibling worktree: "
          f"git -C {root} worktree add ../<topic> -b feature/<topic> --no-track origin/main", file=sys.stderr)
    return True


def main() -> int:
    inner, text = prepare(sys.argv[1:])
    with open(os.path.join(os.path.dirname(HERE), "policy.json")) as handle:
        policy = json.load(handle)
    cwd = os.path.realpath(os.getcwd())
    every = every_main(policy)
    for why in (governed_pushes(text, cwd, every), head_violation(text, cwd), guard_violation(text, cwd, policy, every)):
        if why:
            raise Refused(why)
    watch = tied(cwd, text)
    try:
        before = {root: committable.snapshot(root) for root in watch}
    except Exception as error:
        raise Refused(f"the guard could not read git status in {', '.join(watch)} before the command ({error})")
    # The heredoc was this process's input; the command gets none, as the Bash tool gives none.
    guard_before = fingerprint(policy)
    status = run(inner, subprocess.DEVNULL if sys.argv[1] == "--stdin" else None)
    # From here the command has run: nothing below may report it as not run.
    for root in watch:
        try:
            if report(root, committable.revert(root, before[root])):
                status = status or 1
        except Exception as error:
            print(f"\n{PREFIX} the command ran, but the guard could not check the main worktree {root} ({error}). "
                  f"Run git -C {root} status and tell Chris what it shows.", file=sys.stderr)
            status = status or 1
    changed = sorted(path for path, state in fingerprint(policy).items() if guard_before.get(path) != state)
    changed += sorted(set(guard_before) - set(fingerprint(policy)))
    if changed:
        print(f"\n{PREFIX} this command changed the golden rule's own files ({', '.join(changed[:5])}). "
              "Tell Chris now; a session never changes the guard.", file=sys.stderr)
        status = status or 1
    return status


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refused as refusal:
        print(f"{PREFIX} {refusal}", file=sys.stderr)
        sys.exit(126)
    except Exception as error:  # fail closed: nothing ran
        print(f"{PREFIX} the bootstrap failed ({type(error).__name__}: {error}); the command was not run.", file=sys.stderr)
        sys.exit(126)
