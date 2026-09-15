"""Offline real-Git regression tests; no repository under test is the checkout."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "skills/experiment/scripts/discard-trial.py"


class DiscardTrialTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        home = self.root / "home"
        home.mkdir()
        self.env = {
            "PATH": os.environ["PATH"], "HOME": str(home),
            "XDG_CONFIG_HOME": str(home), "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull, "GIT_TERMINAL_PROMPT": "0",
            "GIT_EDITOR": "true", "GIT_SEQUENCE_EDITOR": "true",
            "GIT_DEFAULT_HASH": "sha1",
        }
        self.primary = self.root / "primary"
        self.work = self.root / "trial"
        self.git("init", "-b", "main", str(self.primary), cwd=self.root)
        for key, value in (
            ("user.name", "Discard Test"), ("user.email", "test@example.invalid"),
            ("commit.gpgSign", "false"), ("tag.gpgSign", "false"),
            ("core.hooksPath", str(self.root / "hooks")),
        ):
            self.git("config", key, value, cwd=self.primary)
        (self.primary / "file").write_text("base\n")
        (self.primary / "restore").write_text("original\n")
        (self.primary / ".gitignore").write_text("cache/\nrestore\n")
        self.git("add", ".", cwd=self.primary)
        self.git("add", "-f", "restore", cwd=self.primary)
        self.git("commit", "-m", "base", cwd=self.primary)
        self.base = self.git("rev-parse", "HEAD", cwd=self.primary).stdout.strip()
        self.git("worktree", "add", "-b", "experiment", str(self.work),
                 cwd=self.primary)
        (self.work / "file").write_text("candidate\n")
        (self.work / "restore").unlink()
        self.git("add", "-u")
        self.git("commit", "-m", "candidate")
        self.trial = self.git("rev-parse", "HEAD").stdout.strip()

    def git(self, *args, cwd=None, check=True):
        return subprocess.run(["git", "-C", str(cwd or self.work), *args],
                              env=self.env, text=True, capture_output=True, check=check)

    def discard(self, **overrides):
        args = dict(worktree=str(self.work), branch="experiment",
                    base=self.base, trial=self.trial)
        args.update(overrides)
        return subprocess.run(
            [sys.executable, str(SCRIPT),
             *[item for key, value in args.items() for item in ("--" + key, value)]],
            env=self.env, text=True, capture_output=True)

    def snapshot(self):
        return (self.git("rev-parse", "HEAD").stdout,
                self.git("status", "--porcelain=v1", "--ignored").stdout,
                self.git("diff", "--binary").stdout,
                self.git("diff", "--cached", "--binary").stdout,
                {str(p.relative_to(self.work)): p.read_bytes()
                 for p in self.work.rglob("*") if p.is_file()})

    def refuse(self, **kwargs):
        before = self.snapshot()
        result = self.discard(**kwargs)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("refused:", result.stderr)
        self.assertNotIn("discarded", result.stdout)
        self.assertEqual(self.snapshot(), before)

    def test_unsafe_baseline_reverts_unrelated_moving_head(self):
        # Meaningful pre-helper red: the old instruction targets someone else's
        # later commit, not the recorded candidate. No live checkout is touched.
        (self.work / "unrelated").write_text("keep me\n")
        self.git("add", ".")
        self.git("commit", "-m", "unrelated")
        self.git("revert", "--no-edit", "HEAD")
        self.assertFalse((self.work / "unrelated").exists())
        self.assertEqual((self.work / "file").read_text(), "candidate\n")

    def test_success_one_revert_restores_base_tree(self):
        result = self.discard()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("discarded", result.stdout)
        self.assertEqual(self.git("rev-parse", "HEAD^").stdout.strip(), self.trial)
        self.assertEqual(self.git("rev-parse", "HEAD^{tree}").stdout,
                         self.git("rev-parse", self.base + "^{tree}").stdout)
        self.assertEqual(self.git("rev-list", "--count", self.base + "..HEAD").stdout.strip(), "2")
        self.refuse()

    def test_later_commit_preserved(self):
        (self.work / "unrelated").write_text("keep me\n")
        self.git("add", ".")
        self.git("commit", "-m", "unrelated")
        self.refuse()

    def test_invalid_records(self):
        for override in (
            {"branch": "other"}, {"base": self.trial}, {"trial": self.base},
            {"trial": "HEAD"}, {"base": "HEAD^"}, {"trial": self.trial[:12]},
            {"trial": "0" * 40}, {"base": "0" * 64},
            {"trial": self.git("rev-parse", "HEAD^{tree}").stdout.strip()},
            {"worktree": str(self.work / "subdir")},
            {"worktree": str(self.primary)},
            {"worktree": str(self.root)},
        ):
            with self.subTest(override=override):
                (self.work / "subdir").mkdir(exist_ok=True)
                self.refuse(**override)

    def test_all_arguments_required(self):
        arguments = ["--worktree", str(self.work), "--branch", "experiment",
                     "--base", self.base, "--trial", self.trial]
        before = self.snapshot()
        for position in range(0, len(arguments), 2):
            with self.subTest(argument=arguments[position]):
                result = subprocess.run(
                    [sys.executable, str(SCRIPT), *arguments[:position],
                     *arguments[position + 2:]], env=self.env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn("required", result.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_detached_and_protected_branches(self):
        self.git("checkout", "--detach")
        self.refuse()
        self.git("checkout", "-b", "master")
        self.refuse(branch="master")
        self.git("branch", "-m", "primary", cwd=self.primary)
        self.git("branch", "-m", "main")
        self.refuse(branch="main")

    def test_merge_trial_refused(self):
        self.git("checkout", "-b", "side", self.base)
        (self.work / "side").write_text("side\n")
        self.git("add", ".")
        self.git("commit", "-m", "side")
        self.git("checkout", "experiment")
        self.git("merge", "--no-ff", "--no-edit", "side")
        self.refuse(trial=self.git("rev-parse", "HEAD").stdout.strip())

    def test_dirty_states_preserved(self):
        for state in ("unstaged", "staged", "untracked"):
            with self.subTest(state=state):
                path = self.work / ("extra" if state == "untracked" else "file")
                path.write_text("user work\n")
                if state == "staged":
                    self.git("add", "file")
                self.refuse()
                # Fixture cleanup only, never helper behavior.
                if state == "untracked":
                    path.unlink()
                else:
                    self.git("restore", "--staged", "--worktree", "file")

    def test_in_progress_states_preserved(self):
        gitdir = Path(self.git("rev-parse", "--absolute-git-dir").stdout.strip())
        for name in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD",
                     "rebase-merge", "rebase-apply", "sequencer"):
            with self.subTest(state=name):
                path = gitdir / name
                if "-" in name or name == "sequencer":
                    path.mkdir()
                else:
                    path.write_text(self.base + "\n")
                self.refuse()
                self.assertTrue(path.exists())
                path.rmdir() if path.is_dir() else path.unlink()

    def test_ignored_restore_collision_preserved(self):
        (self.work / "restore").write_text("ignored user data\n")
        self.refuse()

    def test_renamed_away_ignored_collision_preserved(self):
        # Replace only the disposable fixture's candidate with a rename trial.
        self.git("reset", "--hard", self.base)
        self.git("mv", "restore", "renamed")
        self.git("commit", "-m", "rename trial")
        self.trial = self.git("rev-parse", "HEAD").stdout.strip()
        (self.work / "restore").write_text("ignored user data\n")
        self.refuse()

    def test_harmless_ignored_cache_survives(self):
        (self.work / "cache").mkdir()
        cache = self.work / "cache" / "data"
        cache.write_bytes(b"cache")
        result = self.discard()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(cache.read_bytes(), b"cache")

    def test_dangerous_environment_refused(self):
        for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"):
            with self.subTest(key=key):
                self.env[key] = str(self.root / "bad")
                # Snapshot Git commands must not inherit the hostile setting.
                result = self.discard()
                del self.env[key]
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("refused:", result.stderr)
                self.assertEqual(self.git("rev-parse", "HEAD").stdout.strip(), self.trial)

    def test_native_commit_failure_is_not_aborted(self):
        hooks = self.root / "hooks"
        hooks.mkdir()
        # Native revert runs prepare-commit-msg, not pre-commit.
        hook = hooks / "prepare-commit-msg"
        hook.write_text("#!/bin/sh\necho controlled-hook-failure >&2\nexit 1\n")
        hook.chmod(0o755)
        result = self.discard()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("controlled-hook-failure", result.stderr)
        self.assertNotIn("discarded", result.stdout)
        self.assertEqual(self.git("rev-parse", "HEAD").stdout.strip(), self.trial)
        self.assertNotEqual(self.git("diff", "--cached").stdout, "")
        self.assertEqual((self.work / "restore").read_text(), "original\n")
        self.assertEqual(self.git("write-tree").stdout,
                         self.git("rev-parse", self.base + "^{tree}").stdout)


if __name__ == "__main__":
    unittest.main()
