#!/usr/bin/env python3
"""Which paths in a main worktree git ignores, for the three layers that let them be written.

A gitignored, untracked file in a main worktree is not part of the reference: a local DDEV setup, vendor/,
the files directory. Writing it changes nothing a pull request would carry, so the guard lets it be written.
Everything else stays protected: tracked files (ignored or not), untracked files git does not ignore, `!`
re-included paths, and the .git metadata, which has its own rules.

Three users, one source of truth (git's own ignore files, never the person's global excludes file):

- `check` (the mod's Edit, Write and MCP gate): git's own answer, `git check-ignore`, for one path.
- `allowance` (the sandbox profile, built before a command runs): the ignore patterns translated into
  sandbox regexes. A sandbox rule cannot ask git, so the translation is deliberately narrower than git:
  a pattern it cannot translate exactly is left out (stays denied), every `!` pattern is subtracted
  everywhere, matching is case-sensitive, and a pattern whose region holds any tracked file is dropped.
- `snapshot` / `unexplained` (the tripwire, after a command that handed work to a container): which
  changed paths git ignores by rules that were already there before the command. An ignore file the
  command created or changed explains nothing, so a process outside the sandbox cannot hide a change
  by writing a .gitignore beside it.

Usage (the mod): ignored.py check <main worktree> <real path>   exit 0 ignored, 1 not, 2 could not tell
"""
from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys

GIT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
REGEX_BUDGET = 900
CLASS = re.compile(r"\[(!|\^)?([A-Za-z0-9._ -]+)\]")


class Unknown(Exception):
    """Git could not answer: the caller treats the path as protected."""


def git(root: str, *args: str, stdin: bytes | None = None) -> bytes:
    """Git in a main worktree with the person's global configuration and excludes file left out, no
    fsmonitor or untracked cache, and no optional locks: read-only, and judged by the repository alone."""
    env = {"PATH": GIT_PATH, "HOME": os.path.expanduser("~"), "GIT_CONFIG_GLOBAL": "/dev/null",
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_OPTIONAL_LOCKS": "0", "LC_ALL": "C"}
    argv = ["git", "-C", root, "-c", "core.excludesFile=/dev/null", "-c", "core.fsmonitor=false",
            "-c", "core.untrackedCache=false", "-c", "core.quotePath=false", *args]
    done = subprocess.run(argv, input=stdin, capture_output=True, env=env, timeout=60)
    # check-ignore exits 1 when nothing matched; anything else non-zero is a failure.
    if done.returncode not in (0, 1) or (done.returncode == 1 and args[0] != "check-ignore"):
        raise Unknown(f"git {args[0]} failed in {root}: {done.stderr.decode(errors='replace').strip()[:200]}")
    return done.stdout


def nul(data: bytes) -> list[str]:
    return [item for item in data.decode(errors="surrogateescape").split("\0") if item]


def tracked(root: str) -> list[str]:
    return nul(git(root, "ls-files", "-c", "-z"))


def exclude_file(root: str) -> str:
    """The repository's info/exclude, in the shared git directory."""
    common = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir").decode().strip()
    return os.path.join(common, "info", "exclude")


def ignore_files(root: str) -> list[str]:
    """Every .gitignore git reads in this worktree, relative to it: tracked ones, untracked ones it does not
    ignore, and ignored ones in folders it still reads (DDEV's self-ignoring .ddev/.gitignore). One inside
    an ignored folder is never read by git, so it is not listed. A symlinked one is not followed by git."""
    found = set(nul(git(root, "ls-files", "-c", "-o", "--exclude-standard", "-z", "--", ":(glob)**/.gitignore")))
    found |= {path for path in nul(git(root, "ls-files", "-o", "-i", "--exclude-standard", "--directory", "-z"))
              if os.path.basename(path) == ".gitignore"}
    return sorted(path for path in found if not os.path.islink(os.path.join(root, path)))


def digest(path: str) -> str | None:
    try:
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except FileNotFoundError:
        return None


# ---- check: one path, git's own answer --------------------------------------------------------------

def check(root: str, real: str) -> bool:
    """Whether a real path inside a main worktree is untracked and ignored by the repository's own rules."""
    root = os.path.realpath(root)
    if not real.startswith(root + "/"):
        return False
    rel = real[len(root) + 1:]
    if rel.split("/")[0].casefold() == ".git":
        return False
    # -z -v -n: source, line, pattern, path, the first three empty when nothing matched. A tracked path
    # never matches: check-ignore leaves tracked files out.
    fields = git(root, "check-ignore", "-v", "-n", "-z", "--stdin", stdin=(rel + "\0").encode()).decode(errors="surrogateescape").split("\0")
    if len(fields) != 5:
        raise Unknown("check-ignore answered in an unexpected form")
    source, pattern = fields[0], fields[2]
    return bool(source) and not pattern.startswith("!")


# ---- allowance: the sandbox's narrower translation --------------------------------------------------

def rx(text: str) -> str:
    """A literal inside a sandbox regex: only regex metacharacters are escaped."""
    return re.sub(r'([.^$*+?()\[\]{}|\\"])', r"\\\1", text)


def glob_segment(segment: str) -> str | None:
    """One path segment of a gitignore pattern as a regex, or None when it cannot be translated exactly.
    `*` and `?` never cross a slash; a bracket class may hold only letters, digits, `._ -` and ranges."""
    out, i = "", 0
    while i < len(segment):
        char = segment[i]
        if char == "*":
            out += "[^/]*"
        elif char == "?":
            out += "[^/]"
        elif char == "[":
            match = CLASS.match(segment, i)
            if not match:
                return None
            # Ranges only within digits, lower or upper case letters; any other hyphen is itself. Git reads
            # `.-z` as a range that spans `/`; reading it as three characters is narrower, so safe.
            parts = re.findall(r"[0-9]-[0-9]|[a-z]-[a-z]|[A-Z]-[A-Z]|.", match.group(2))
            if any(len(part) == 3 and part[0] > part[2] for part in parts):
                return None
            members = "".join(part for part in parts if part != "-") + ("-" if "-" in parts else "")
            out += f"[^/{members}]" if match.group(1) else f"[{members}]"
            i = match.end()
            continue
        elif char in "]\\":
            return None
        else:
            out += rx(char)
        i += 1
    return out


def translate(base: str, line: str) -> tuple[bool, str, bool] | None:
    """A gitignore line in the folder `base` (absolute) as (negated, regex for the paths it names,
    directory-only), or None for a blank, a comment, or a pattern that cannot be translated exactly."""
    line = line.rstrip("\r\n")
    if not line or line.startswith("#") or "\\" in line:
        return None
    line = line.rstrip(" \t")
    negated = line.startswith("!")
    if negated:
        line = line[1:]
    directory_only = line.endswith("/")
    line = line.rstrip("/")
    if not line:
        return None
    anchored = "/" in line
    segments = line.lstrip("/").split("/")
    out = ""
    for i, segment in enumerate(segments):
        last = i == len(segments) - 1
        if segment == "**":
            out += ".*" if last else "(.*/)?"
            continue
        piece = glob_segment(segment)
        if piece is None:
            return None
        out += piece + ("" if last else "/")
    return negated, rx(base) + "/" + ("" if anchored else "(.*/)?") + out, directory_only


def rules(root: str) -> list[tuple[str, str, int, tuple[bool, str, bool] | None]]:
    """Every line of every ignore file git reads here, with its translation: (file, text, number, rule)."""
    out = []
    files = [(os.path.join(root, rel), os.path.join(root, os.path.dirname(rel)).rstrip("/")) for rel in ignore_files(root)]
    files.append((exclude_file(root), root))
    for path, base in files:
        try:
            with open(path, encoding="utf-8", errors="surrogateescape") as handle:
                lines = handle.read().split("\n")
        except FileNotFoundError:
            continue
        for number, text in enumerate(lines, 1):
            out.append((path, text, number, translate(base, text)))
    return out


def chunked(prefix: str, items: list[str]) -> list[str]:
    """Alternations under one prefix, each regex within the sandbox reader's limit."""
    out, current = [], []
    for item in items:
        if len(item.encode()) > REGEX_BUDGET // 2:
            continue  # too long to share a rule: left out, so stays denied
        if current and len(("|".join([*current, item])).encode()) > REGEX_BUDGET:
            out.append(f"^{prefix}({'|'.join(current)})")
            current = []
        current.append(item)
    if current:
        out.append(f"^{prefix}({'|'.join(current)})")
    return out


def allowance(root: str) -> tuple[list[str], list[str], list[str]]:
    """Sandbox regexes for what may be written in a main worktree: (allowed, minus these, literal folders).

    A pattern is allowed as its region: the path it names (unless directory-only) and everything under it.
    Every `!` pattern's region is subtracted wherever it is. A pattern that cannot be translated exactly
    is left out; a `!` pattern that cannot be translated drops every pattern whose folder overlaps its
    own. A pattern whose region, compared without regard to case, holds a tracked file or a folder of one
    is dropped. Ignored folders git lists as such are added as literals, so their own entry can be
    removed or renamed; a directory-only pattern's folder that is not there yet cannot be created."""
    root = os.path.realpath(root)
    files = tracked(root)
    folders = {os.path.dirname(path) for path in files}
    folders = {"/".join(path.split("/")[:i]) for path in folders if path for i in range(1, path.count("/") + 2)}
    occupied = [os.path.join(root, path) for path in [*files, *folders]]
    positive, negative, blocked = [], [], []
    for path, text, _number, rule in rules(root):
        base = os.path.dirname(path) if not path.endswith("/info/exclude") else root
        if rule is None:
            stripped = text.strip()
            if stripped.startswith("!"):
                blocked.append(base)
            elif stripped and not stripped.startswith("#"):
                pass  # an untranslatable positive pattern is simply not allowed
            continue
        negated, regex, directory_only = rule
        region = regex + ("/.*" if directory_only else "(/.*)?")
        (negative if negated else positive).append((base, region))
    allowed = []
    for base, region in positive:
        if any(base == other or base.startswith(other + "/") or other.startswith(base + "/") for other in blocked):
            continue
        compiled = re.compile(region, re.IGNORECASE)
        if region not in allowed and not any(compiled.fullmatch(path) for path in occupied):
            allowed.append(region)
    # Ignored folders git reports whole, written as the folder itself (their contents are covered above).
    literal = []
    for entry in nul(git(root, "ls-files", "-o", "-i", "--exclude-standard", "--directory", "-z")):
        if entry.endswith("/"):
            folder = os.path.join(root, entry.rstrip("/"))
            if any(re.fullmatch(region, folder + "/x") for region in allowed) and \
                    not any(path.casefold() == folder.casefold() or path.casefold().startswith(folder.casefold() + "/") for path in occupied):
                literal.append(folder)
    strip = rx(root) + "/"
    rel = lambda region: region[len(strip):] + "$"
    return (chunked(strip, sorted({rel(region) for region in allowed})),
            chunked(strip, sorted({rel(region) for _base, region in negative})),
            sorted(literal))


def clause(root: str) -> str:
    """The sandbox filter for the writable, ignored part of a main worktree, or "" when there is none."""
    allowed, minus, literal = allowance(root)
    if not allowed and not literal:
        return ""
    either = [f'(regex #"{pattern}")' for pattern in allowed] + [f"(literal {json_string(folder)})" for folder in literal]
    inner = f"(require-any {' '.join(either)})"
    if minus:
        inner = f"(require-all {inner} " + " ".join(f'(require-not (regex #"{pattern}"))' for pattern in minus) + ")"
    return inner


def json_string(text: str) -> str:
    import json
    return json.dumps(text)


# ---- snapshot / unexplained: the tripwire ----------------------------------------------------------

def snapshot(root: str) -> dict:
    """Before a watched command: the ignore files' contents, the deleted tracked files, the untracked
    files git does not ignore."""
    root = os.path.realpath(root)
    return {
        "ignore": {os.path.join(root, rel): digest(os.path.join(root, rel)) for rel in ignore_files(root)},
        "deleted": set(nul(git(root, "ls-files", "-d", "-z"))),
        "untracked": set(nul(git(root, "ls-files", "-o", "--exclude-standard", "-z"))),
    }


def unexplained(root: str, changed: list[str], before: dict) -> str | None:
    """The first change in a main worktree that ignored files do not explain: a changed path git does not
    ignore by a rule that was there, unchanged, before the command; a tracked file deleted; or an
    untracked, unignored file added or removed."""
    root = os.path.realpath(root)
    rels = [path[len(root) + 1:] for path in changed if path.startswith(root + "/")]
    if rels:
        trusted = {path for path, value in before["ignore"].items() if value is not None and digest(path) == value}
        exclude = exclude_file(root)
        explained = set()
        # -z -v -n: four fields per path (source, line, pattern, path); all but the path empty when nothing matched.
        raw = git(root, "check-ignore", "-v", "-n", "-z", "--stdin", stdin=("\0".join(rels) + "\0").encode())
        fields = raw.decode(errors="surrogateescape").split("\0")
        if len(fields) != 4 * len(rels) + 1:
            raise Unknown("check-ignore answered in an unexpected form")
        for i in range(0, len(fields) - 1, 4):
            source, _line, pattern, path = fields[i:i + 4]
            where = source if os.path.isabs(source) else os.path.join(root, source)
            if source and not pattern.startswith("!") and (where in trusted or where == exclude):
                explained.add(path)
        for rel in rels:
            if rel not in explained:
                return os.path.join(root, rel)
    deleted = set(nul(git(root, "ls-files", "-d", "-z"))) ^ before["deleted"]
    untracked = set(nul(git(root, "ls-files", "-o", "--exclude-standard", "-z"))) ^ before["untracked"]
    for rel in sorted(deleted | untracked):
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
