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
                    "a/node_modules", "logs/new.php", "docs/a1.tmp", "xay", ".ddev/.generated.yaml",
                    "web/core/index.php", "web/sites/default/files", "vendor", "web/core", "odd#name"}
for probe in probes:
    got = ignored.check(root, os.path.join(root, probe))
    want = probe in expected_ignored or (probe.casefold() in {p.casefold() for p in expected_ignored} and git(root, "config", "core.ignorecase").strip() == "true")
    report(got == want, f"check {probe}: {'ignored' if got else 'protected'}")

# ---- allowance: only what exists and git ignores, never wider ----
folders, files = ignored.allowance(root)


def sandbox_allows(path: str) -> bool:
    return path in files or any(path == folder or path.startswith(folder + "/") for folder in folders)


tracked_files = set(git(root, "ls-files").split())
for probe in probes:
    full = os.path.join(root, probe)
    if sandbox_allows(full):
        report(ignored.check(root, full) and probe not in tracked_files, f"allowance {probe} is ignored and untracked")
for probe in ["vendor/new.php", "vendor/a/b.php", "web/sites/default/files/x.jpg", ".ddev/.generated.yaml", "web/core/index.php"]:
    report(sandbox_allows(os.path.join(root, probe)), f"allowance covers {probe}")
for probe in ["app.log", "logs/new.php", "logs/kept.php", "tracked-ignored.txt", "keep.log", "README.md", "Vendor/a/b.php",
              ".git/config", ".ddev/.gitignore", ".gitignore"]:
    report(not sandbox_allows(os.path.join(root, probe)), f"allowance leaves {probe} protected")

# ---- the reviewer's cases (2026-10-22) ----
os.makedirs(f"{root}/x", exist_ok=True)
write(f"{root}/vendor/alias.php")
os.link(f"{root}/vendor/alias.php", f"{root}/vendor/alias2.php")
report(not ignored.check(root, f"{root}/vendor/alias2.php"), "check refuses a file with two hard links")
os.unlink(f"{root}/vendor/alias2.php")
os.link(f"{root}/README.md", f"{root}/vendor/readme-alias")
report(ignored.allowance(root) == ([], []), "a tracked file with a hard link turns the allowance off")
report(not ignored.check(root, f"{root}/vendor/readme-alias"), "check refuses a hard link to a tracked file")
os.unlink(f"{root}/vendor/readme-alias")
report(not ignored.check(root, f"{root}/TRACKED-IGNORED.txt"), "check refuses a case variant of a tracked file")
report(not ignored.check(root, f"{root}/LOGS/kept.php"), "check refuses a case variant inside a tracked folder")
report(not ignored.check(root, f"{root}/.ddev/.gitignore"), "check refuses an ignore file")
os.environ["GIT_INDEX_FILE"] = "/private/tmp/nonexistent-index"
report(not ignored.check(root, f"{root}/tracked-ignored.txt"), "an inherited GIT_INDEX_FILE is not used")
del os.environ["GIT_INDEX_FILE"]

# ---- round 2 (2026-10-22) ----
write(f"{root}/vendor/deep/x.php")
os.link(f"{root}/README.md", f"{root}/../outside-alias")  # keep a tracked file at nlink 1 below
os.unlink(f"{root}/../outside-alias")
write(f"{base}/protected-elsewhere.txt")
os.link(f"{base}/protected-elsewhere.txt", f"{root}/vendor/deep/alias.php")
report(f"{root}/vendor" not in ignored.allowance(root)[0], "a folder holding a hard-linked file is not allowed whole")
os.unlink(f"{root}/vendor/deep/alias.php")
report(f"{root}/vendor" in ignored.allowance(root)[0], "the folder is allowed again once the hard link is gone")
write(f"{root}/vendor/\u00e9/x.php")
report(f"{root}/vendor" not in ignored.allowance(root)[0], "a folder holding a non-ASCII name is not allowed whole")
shutil.rmtree(f"{root}/vendor/\u00e9")
report(not ignored.plain("/a/\u00e9") and ignored.plain("/a/IRIS Documents"), "only printable ASCII names are quoted into the profile")

write(f"{root}/vendor/locked/x.php")
os.chmod(f"{root}/vendor/locked", 0)
ignored.spent = 0
report(f"{root}/vendor" not in ignored.allowance(root)[0], "a folder with an unreadable subfolder is not allowed whole")
os.chmod(f"{root}/vendor/locked", 0o755)
shutil.rmtree(f"{root}/vendor/locked")
ignored.spent = ignored.TOTAL_LIMIT
report(f"{root}/vendor" not in ignored.allowance(root)[0], "nothing more is opened once the profile's budget is spent")
ignored.spent = 0

before_tracked = ignored.tracked_changes(root)
write(f"{root}/README.md", "first\n")
mid = ignored.tracked_changes(root)
write(f"{root}/README.md", "second\n")
report(mid != before_tracked and ignored.tracked_changes(root) != mid, "a further change to an already modified tracked file is seen")
git(root, "checkout", "-q", "--", "README.md")

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
before = ignored.snapshot(root)
os.rename(f"{root}/tracked-ignored.txt", f"{root}/TRACKED-IGNORED.txt")
write(f"{root}/TRACKED-IGNORED.txt", "hacked\n")
got = ignored.unexplained(root, [f"{root}/TRACKED-IGNORED.txt"], before)
report(got is not None, f"a case-only rename of a tracked file is not explained ({got})")
os.rename(f"{root}/TRACKED-IGNORED.txt", f"{root}/tracked-ignored.txt")
write(f"{root}/scratch.txt")
before = ignored.snapshot(root)
os.unlink(f"{root}/scratch.txt")
report(ignored.unexplained(root, [], before) == f"{root}/scratch.txt", "a removed untracked, unignored file is not explained")
before = ignored.snapshot(root)
write(f"{root}/vendor/more/z.php")
os.makedirs(f"{root}/logs/ignored-sub", exist_ok=True)
report(ignored.unexplained(root, [], before) is None, "ignored files and folders added inside tracked folders are not a folder change")
subprocess.run(["/bin/chmod", "+a", "everyone deny delete", root], check=True)
report(ignored.unexplained(root, [], before) == "(access lists)", "an access list added to the worktree folder is not explained")
subprocess.run(["/bin/chmod", "-N", root], check=True)
subprocess.run(["/usr/bin/xattr", "-w", "user.gr", "x", root], check=True)
report(ignored.unexplained(root, [], before) == "(attributes)", "an extended attribute on the worktree folder is not explained")
subprocess.run(["/usr/bin/xattr", "-d", "user.gr", root], check=True)
before = ignored.snapshot(root)
os.chmod(f"{root}/logs", 0o777)
report(ignored.unexplained(root, [], before) in (f"{root}/logs", "(access lists)"), "a mode change on a folder of tracked files is not explained")


shutil.rmtree(base)
print(f"\n{'all passed' if not failures else f'{failures} failed'}")
sys.exit(1 if failures else 0)
