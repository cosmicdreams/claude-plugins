"""hooks/sandbox/ignored.py against a fixture repository, no sandbox needed: the sandbox translation must
never allow a path git would not ignore, and the tripwire must not be explained away by an ignore file the
command wrote. Usage: /usr/bin/python3 -I tests/sandbox/ignored_test.py"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "..", "hooks", "sandbox"))
import ignored  # noqa: E402

failures = 0


def report(ok: bool, what: str) -> None:
    global failures
    print(("pass  " if ok else "FAIL  ") + what)
    failures += 0 if ok else 1


def write(path: str, text: str = "x\n") -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as handle:
        handle.write(text)


def git(root: str, *args: str) -> str:
    return subprocess.run(["git", "-C", root, *args], check=True, capture_output=True, text=True).stdout


base = tempfile.mkdtemp(prefix="gr-ignored-")
root = os.path.realpath(os.path.join(base, "p", "worktrees", "main"))
os.makedirs(root)
git(root, "init", "-q", "-b", "main")
git(root, "config", "user.email", "t@example.com")
git(root, "config", "user.name", "t")
write(f"{root}/.gitignore", "\n".join([
    "/vendor/", "*.log", "!keep.log", "/web/sites/*/files/", "/build/**/cache", "node_modules", "logs",
    "/docs/[a-c]*.tmp", "/tracked-ignored.txt", "/odd\\#name", "/x[!q]y", "settings.local.php", "",
]))
write(f"{root}/web/.gitignore", "/core/\n")
write(f"{root}/README.md")
write(f"{root}/logs/kept.php")            # tracked inside an ignored name: `logs` must not be allowed
write(f"{root}/tracked-ignored.txt")      # tracked and matched by a pattern
write(f"{root}/web/sites/default/settings.php")
git(root, "add", "-A")
git(root, "add", "-f", "logs/kept.php", "tracked-ignored.txt")
git(root, "commit", "-q", "-m", "chore: initial")
# DDEV's style: an untracked ignore file that ignores itself.
write(f"{root}/.ddev/.gitignore", "/.gitignore\n/.generated.yaml\n")
write(f"{root}/.ddev/.generated.yaml")
write(f"{root}/vendor/a/b.php")
write(f"{root}/web/sites/default/files/x.jpg")
write(f"{root}/web/core/index.php")

probes = [
    "vendor", "vendor/a/b.php", "vendor/new.php", "Vendor/a/b.php", "app.log", "sub/dir/app.log", "keep.log",
    "sub/keep.log", "web/sites/default/files/x.jpg", "web/sites/default/files", "web/sites/default/settings.php",
    "web/sites/default/settings.local.php", "build/a/b/cache/x", "build/cache", "node_modules/x/y.js",
    "a/node_modules", "logs/kept.php", "logs/new.php", "docs/a1.tmp", "docs/d1.tmp", "docs/A1.tmp",
    "tracked-ignored.txt", "odd#name", "xay", "xqy", "README.md", "new.txt", ".ddev/.gitignore",
    ".ddev/.generated.yaml", ".ddev/config.yaml", "web/core/index.php", "web/core", "web/index.php",
    ".git/config", ".git/HEAD", ".gitignore",
]

# ---- check: git's own answer ----
expected_ignored = {"vendor/a/b.php", "vendor/new.php", "app.log", "sub/dir/app.log", "web/sites/default/files/x.jpg",
                    "web/sites/default/settings.local.php", "build/a/b/cache/x", "build/cache", "node_modules/x/y.js",
                    "a/node_modules", "logs/new.php", "docs/a1.tmp", "xay", ".ddev/.gitignore", ".ddev/.generated.yaml",
                    "web/core/index.php", "web/sites/default/files", "vendor", "web/core", "odd#name"}
for probe in probes:
    got = ignored.check(root, os.path.join(root, probe))
    want = probe in expected_ignored or (probe.casefold() in {p.casefold() for p in expected_ignored} and git(root, "config", "core.ignorecase").strip() == "true")
    report(got == want, f"check {probe}: {'ignored' if got else 'protected'}")

# ---- allowance: never wider than git ----
allowed, minus, literal = ignored.allowance(root)
allow = [re.compile(pattern) for pattern in allowed]
deny = [re.compile(pattern) for pattern in minus]


def sandbox_allows(path: str) -> bool:
    return (any(p.search(path) for p in allow) and not any(p.search(path) for p in deny)) or path in literal


tracked_files = set(git(root, "ls-files").split())
for probe in probes:
    full = os.path.join(root, probe)
    if sandbox_allows(full):
        report(ignored.check(root, full) and probe not in tracked_files, f"allowance {probe} is ignored and untracked")
for probe in ["vendor/new.php", "app.log", "web/sites/default/files/x.jpg", ".ddev/.generated.yaml", "node_modules/x/y.js", "web/core/index.php"]:
    report(sandbox_allows(os.path.join(root, probe)), f"allowance covers {probe}")
for probe in ["logs/new.php", "logs/kept.php", "tracked-ignored.txt", "keep.log", "README.md", "odd#name", "Vendor/a/b.php", "xqy", ".git/config"]:
    report(not sandbox_allows(os.path.join(root, probe)), f"allowance leaves {probe} protected")

# ---- unexplained: the tripwire ----
before = ignored.snapshot(root)
time.sleep(0.01)
write(f"{root}/vendor/a/c.php")
write(f"{root}/web/sites/default/files/y.jpg")
report(ignored.unexplained(root, [f"{root}/vendor/a/c.php", f"{root}/web/sites/default/files/y.jpg"], before) is None,
       "ignored changes are explained")
write(f"{root}/README.md", "changed\n")
report(ignored.unexplained(root, [f"{root}/README.md"], before) == f"{root}/README.md", "a tracked change is not explained")
git(root, "checkout", "-q", "--", "README.md")
write(f"{root}/hidden/.gitignore", "*\n")
write(f"{root}/hidden/evil.php")
got = ignored.unexplained(root, [f"{root}/hidden/.gitignore", f"{root}/hidden/evil.php"], before)
report(got is not None, f"a change hidden by a new ignore file is not explained ({got})")
shutil.rmtree(f"{root}/hidden")
write(f"{root}/.ddev/.gitignore", "/.gitignore\n/.generated.yaml\n/*\n")
write(f"{root}/.ddev/sneaky.yaml")
got = ignored.unexplained(root, [f"{root}/.ddev/.gitignore", f"{root}/.ddev/sneaky.yaml"], before)
report(got is not None, f"a change hidden by a changed ignore file is not explained ({got})")
write(f"{root}/.ddev/.gitignore", "/.gitignore\n/.generated.yaml\n")
os.unlink(f"{root}/.ddev/sneaky.yaml")
os.unlink(f"{root}/tracked-ignored.txt")
report(ignored.unexplained(root, [], before) == f"{root}/tracked-ignored.txt", "a deleted tracked file is not explained")
git(root, "checkout", "-q", "--", "tracked-ignored.txt")
write(f"{root}/scratch.txt")
before = ignored.snapshot(root)
os.unlink(f"{root}/scratch.txt")
report(ignored.unexplained(root, [], before) == f"{root}/scratch.txt", "a removed untracked, unignored file is not explained")

shutil.rmtree(base)
print(f"\n{'all passed' if not failures else f'{failures} failed'}")
sys.exit(1 if failures else 0)
