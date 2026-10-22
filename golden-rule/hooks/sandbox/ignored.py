#!/usr/bin/env python3
"""Which paths in a main worktree git ignores, for the three layers that let them be written.

A gitignored, untracked file in a main worktree is not part of the reference: a local DDEV setup, vendor/,
the files directory. Writing it changes nothing a pull request would carry, so the guard lets it be written.
Everything else stays protected: tracked files (ignored or not, in any spelling the volume treats as the
same name), submodules, untracked files git does not ignore, `!` re-included paths, every ignore file, and
the .git metadata, which has its own rules.

Git decides what is ignored; this module never reads an ignore pattern itself. Its own checks only narrow
git's answer: a path whose case-folded, NFC-normalised spelling is a tracked file, a folder of one or inside a
submodule; a file named .gitignore; a file with more than one hard link. Git runs by absolute path, with the
person's global configuration and excludes file left out.

- `check` (the mod's Edit, Write and MCP gate): one path, `git check-ignore`.
- `allowance` (the sandbox profile, built before a command runs): the ignored files and folders that exist
  now, exactly as git lists them, as literal and subpath rules. A new ignored file in a folder git does
  not ignore cannot be created; one in an ignored folder can. No pattern is translated.
- `snapshot` / `unexplained` (the tripwire, after a command that handed work to a container): a changed
  path counts as ignored only by a rule from an ignore file that was there, with the same content, before
  the command; tracked files modified or deleted and unignored files added or removed are compared with
  git's listings from before.

Usage (the mod): ignored.py check <main worktree> <real path>   exit 0 ignored, 1 not, 2 could not tell
"""
from __future__ import annotations

import hashlib
import os
import stat
import subprocess
import sys
import unicodedata

GIT = "/usr/bin/git"  # never looked up on PATH: a planted git would run outside the sandbox
IGNORE_FILE = ".gitignore"
# A folder is allowed whole only when every entry in it was checked for hard links; a larger one (vendor/,
# node_modules/, the files folder) stays denied to commands, which reach it through a container anyway.
FOLDER_LIMIT = 2000
TOTAL_LIMIT = 3000  # entries examined per profile, every main worktree and rejected folder counted
spent = 0


class Unknown(Exception):
    """Git could not answer: the caller treats the path as protected."""


def git(root: str, *args: str, stdin: bytes | None = None) -> bytes:
    """Git in a main worktree, from a clean environment (no inherited GIT_INDEX_FILE, GIT_DIR and the
    like), without the person's global or system configuration or excludes file, fsmonitor, untracked
    cache or optional locks: read-only, judged by the repository alone."""
    env = {"HOME": os.path.expanduser("~"), "PATH": "/usr/bin:/bin", "GIT_CONFIG_GLOBAL": "/dev/null",
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_OPTIONAL_LOCKS": "0", "LC_ALL": "C"}
    argv = [GIT, "-C", root, "-c", "core.excludesFile=/dev/null", "-c", "core.fsmonitor=false",
            "-c", "core.untrackedCache=false", "-c", "core.quotePath=false", *args]
    done = subprocess.run(argv, input=stdin, capture_output=True, env=env, timeout=60)
    # check-ignore exits 1 when nothing matched; anything else non-zero is a failure.
    if done.returncode not in (0, 1) or (done.returncode == 1 and args[0] != "check-ignore"):
        raise Unknown(f"git {args[0]} failed in {root}: {done.stderr.decode(errors='replace').strip()[:200]}")
    return done.stdout


def nul(data: bytes) -> list[str]:
    return [item for item in data.decode(errors="surrogateescape").split("\0") if item]


def key(path: str) -> str:
    """A spelling as a case-insensitive, normalisation-insensitive volume compares it."""
    return unicodedata.normalize("NFC", path).casefold()


class Index:
    """What the index holds, by key: tracked paths, the folders above them, and submodules."""

    def __init__(self, root: str):
        self.files, self.folders, self.submodules, self.paths, self.folder_paths = set(), set(), set(), [], set()
        for entry in nul(git(root, "ls-files", "--stage", "-z")):
            meta, _, path = entry.partition("\t")
            self.paths.append(path)
            k = key(path)
            self.files.add(k)
            if meta.startswith("160000"):
                self.submodules.add(k)
            parts = k.split("/")
            self.folders.update("/".join(parts[:i]) for i in range(1, len(parts)))
            spelled = path.split("/")
            self.folder_paths.update("/".join(spelled[:i]) for i in range(1, len(spelled)))

    def protects(self, rel: str) -> bool:
        """Whether a path is tracked, holds tracked files, is inside a submodule, or is an ignore file."""
        k = key(rel)
        if k in self.files or k in self.folders or os.path.basename(k) == IGNORE_FILE or k.split("/")[0] == ".git":
            return True
        return any(k.startswith(sub + "/") for sub in self.submodules)


def aliased(path: str) -> bool:
    """A file with more than one hard link may be another name for a tracked file."""
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return False
    return stat.S_ISREG(info.st_mode) and info.st_nlink > 1


def ignore_files(root: str) -> list[str]:
    """The .gitignore files git reads here that are plainly on disk, relative to the worktree: tracked,
    untracked, and ignored ones in folders git still reads (DDEV's self-ignoring .ddev/.gitignore)."""
    found = set(nul(git(root, "ls-files", "-c", "-o", "--exclude-standard", "-z", "--", ":(glob)**/.gitignore")))
    found |= {path for path in nul(git(root, "ls-files", "-o", "-i", "--exclude-standard", "--directory", "-z"))
              if os.path.basename(path) == IGNORE_FILE}
    return sorted(path for path in found if not os.path.islink(os.path.join(root, path)))


def exclude_file(root: str) -> str:
    """The repository's info/exclude, in the shared git directory."""
    common = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir").decode().strip()
    return os.path.realpath(os.path.join(common, "info", "exclude"))


def digest(path: str) -> str | None:
    try:
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except FileNotFoundError:
        return None


def verdicts(root: str, rels: list[str]) -> dict[str, tuple[str, str]]:
    """git check-ignore for many paths: path -> (source, pattern), both empty when nothing matched."""
    raw = git(root, "check-ignore", "-v", "-n", "-z", "--stdin", stdin=("\0".join(rels) + "\0").encode())
    # -z -v -n: four fields per path (source, line, pattern, path); all but the path empty when nothing matched.
    fields = raw.decode(errors="surrogateescape").split("\0")
    if len(fields) != 4 * len(rels) + 1:
        raise Unknown("check-ignore answered in an unexpected form")
    return {fields[i + 3]: (fields[i], fields[i + 2]) for i in range(0, len(fields) - 1, 4)}


# ---- check: one path ---------------------------------------------------------------------------------

def check(root: str, real: str) -> bool:
    """Whether a real path inside a main worktree is an untracked file git ignores."""
    root = os.path.realpath(root)
    if not real.startswith(root + "/"):
        return False
    rel = real[len(root) + 1:]
    if Index(root).protects(rel) or aliased(real):
        return False
    source, pattern = verdicts(root, [rel])[rel]
    return bool(source) and not pattern.startswith("!")


# ---- allowance: what exists and is ignored now ------------------------------------------------------

def plain(path: str) -> bool:
    """A name the sandbox profile can quote as written: printable ASCII without `"` or `\\`. A JSON
    \\u escape would reach the sandbox as the ASCII letters `u00e9`, another file."""
    return all(32 <= ord(char) < 127 for char in path) and '"' not in path and "\\" not in path


def raise_error(error: OSError) -> None:
    raise error


def checked_folder(path: str) -> bool:
    """Whether a folder can be allowed whole: within the budget and FOLDER_LIMIT, every name plain, no
    file with more than one hard link (another name for any protected file anywhere), every subfolder
    readable. Every entry examined is charged to the profile's budget, a rejected folder's included."""
    global spent
    seen = 0
    try:
        for directory, dirs, names in os.walk(path, onerror=raise_error):
            for name in dirs + names:
                seen += 1
                spent += 1
                entry = os.path.join(directory, name)
                if seen > FOLDER_LIMIT or spent > TOTAL_LIMIT or not plain(entry) or aliased(entry):
                    return False
    except OSError:
        return False  # a folder that cannot be read whole cannot be judged whole
    return True


def allowance(root: str) -> tuple[list[str], list[str]]:
    """The ignored folders and files that exist now, as git lists them: (folders, files), absolute.
    Left out: anything the index protects, a link or a path that does not resolve to itself, a file with
    more than one hard link, a name the sandbox profile cannot quote plainly, a folder too large to check
    whole. When any tracked file has more than one hard link, nothing is allowed."""
    root = os.path.realpath(root)
    index = Index(root)
    if any(aliased(os.path.join(root, path)) for path in index.paths):
        return [], []
    folders, files = [], []
    for entry in nul(git(root, "ls-files", "-o", "-i", "--exclude-standard", "--directory", "-z")):
        rel = entry.rstrip("/")
        path = os.path.join(root, rel)
        if not plain(path) or index.protects(rel):
            continue
        if os.path.islink(path) or os.path.realpath(path) != path:
            continue
        if entry.endswith("/"):
            if os.path.isdir(path):
                folders.append(rel)
        elif os.path.isfile(path) and not aliased(path):
            files.append(path)
    # Git lists a folder whole when everything in it now is ignored, even when the folder itself is not
    # (.ddev holding only DDEV's generated files): a new file there might not be ignored. Only a folder
    # git ignores itself is allowed whole, since nothing under an ignored folder can be re-included.
    answers = verdicts(root, folders) if folders else {}
    whole = []
    for rel in sorted(folders, key=lambda rel: (rel.count("/"), rel)):
        if spent >= TOTAL_LIMIT:
            break
        if answers[rel][0] and not answers[rel][1].startswith("!") and checked_folder(os.path.join(root, rel)):
            whole.append(os.path.join(root, rel))
    return sorted(whole), sorted(files)


def clause(root: str) -> str:
    """The sandbox filter for the writable, ignored part of a main worktree, or "" when there is none."""
    folders, files = allowance(root)
    rules = [f'(subpath "{path}")' for path in folders] + [f'(literal "{path}")' for path in files]
    return f"(require-any {' '.join(rules)})" if rules else ""


# ---- snapshot / unexplained: the tripwire ----------------------------------------------------------

def tracked_changes(root: str) -> set[str]:
    """Tracked files git sees as modified or deleted, each with its content digest, so a further change to a
    file already modified before the command counts too: the check after an opened, unwatched command."""
    root = os.path.realpath(root)
    return {f"{rel} {digest(os.path.join(root, rel))}" for rel in nul(git(root, "ls-files", "-m", "-d", "-z"))}


def snapshot(root: str) -> dict:
    """Before a watched command: the ignore files' contents, and git's listings of modified and deleted
    tracked files and of untracked files it does not ignore."""
    root = os.path.realpath(root)
    return {
        "folders": folder_state(root),
        "ignore": {os.path.join(root, rel): digest(os.path.join(root, rel)) for rel in ignore_files(root)},
        "modified": set(nul(git(root, "ls-files", "-m", "-d", "-z"))),
        "untracked": set(nul(git(root, "ls-files", "-o", "--exclude-standard", "-z"))),
    }


def folder_state(root: str) -> dict[str, object]:
    """Mode, owner, flags and extended attributes of the worktree folder and every folder holding tracked
    files, and their access control lists. Their times move whenever an ignored file inside is added, so
    times are left out."""
    out: dict[str, object] = {}
    paths = [root, *(os.path.join(root, rel) for rel in sorted(Index(root).folder_paths))]
    for path in paths:
        try:
            info = os.lstat(path)
            out[path] = (info.st_mode, info.st_uid, info.st_gid, info.st_flags)
        except FileNotFoundError:
            out[path] = None
    # ls -lde prints each folder's access control list, which no Python call reads.
    listed = subprocess.run(["/bin/ls", "-lde", "--", *[p for p in paths if out[p] is not None]],
                            capture_output=True, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"}, timeout=60)
    if listed.returncode != 0:
        raise Unknown(f"could not read folder access lists in {root}")
    # Extended attributes, names and values, which this Python cannot read itself.
    present = [p for p in paths if out[p] is not None]
    attributes = subprocess.run(["/usr/bin/xattr", "-l", "-s", *present], capture_output=True,
                                env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"}, timeout=60)
    if attributes.returncode != 0:
        raise Unknown(f"could not read folder attributes in {root}")
    out["(attributes)"] = hashlib.sha256(attributes.stdout).hexdigest()
    # Kept: each folder's permission string and its access list lines (" 0: user:x deny delete"); left
    # out: link count, size and times, which an ignored file added inside changes.
    kept = [line.split(None, 1)[0] if not line[:1].isspace() else line
            for line in listed.stdout.decode(errors="surrogateescape").splitlines()]
    out["(access lists)"] = hashlib.sha256("\n".join(kept).encode(errors="surrogateescape")).hexdigest()
    return out


def unexplained(root: str, changed: list[str], before: dict) -> str | None:
    """The first change in a main worktree that ignored files do not explain. A changed path is explained
    only when git ignores it by a rule from an ignore file unchanged since before the command (or
    info/exclude, which the sandbox protects), and the index does not protect it in any spelling."""
    root = os.path.realpath(root)
    rels = [path[len(root) + 1:] for path in changed if path.startswith(root + "/")]
    if rels:
        index = Index(root)
        trusted = {path for path, value in before["ignore"].items() if value is not None and digest(path) == value}
        exclude = exclude_file(root)
        answers = verdicts(root, rels)
        for rel in rels:
            source, pattern = answers.get(rel, ("", ""))
            where = os.path.realpath(source if os.path.isabs(source) else os.path.join(root, source)) if source else ""
            explained = bool(source) and not pattern.startswith("!") and (where in trusted or where == exclude)
            if not explained or index.protects(rel) or aliased(os.path.join(root, rel)):
                return os.path.join(root, rel)
    after = folder_state(root)
    for path in sorted(set(before["folders"]) | set(after)):
        if before["folders"].get(path) != after.get(path):
            return path
    modified = set(nul(git(root, "ls-files", "-m", "-d", "-z"))) ^ before["modified"]
    untracked = set(nul(git(root, "ls-files", "-o", "--exclude-standard", "-z"))) ^ before["untracked"]
    for rel in sorted(modified | untracked):
        return os.path.join(root, rel)
    return None


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "check":
        try:
            sys.exit(0 if check(sys.argv[2], sys.argv[3]) else 1)
        except Exception as error:  # cannot tell: the caller protects the path
            print(f"golden-rule: {error}", file=sys.stderr)
            sys.exit(2)
    print(__doc__.split("Usage")[1].strip(), file=sys.stderr)
    sys.exit(2)
