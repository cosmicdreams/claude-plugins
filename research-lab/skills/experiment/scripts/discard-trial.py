#!/usr/bin/env python3
"""Revert one explicitly recorded trial in an exclusively owned linked worktree.

The caller records root/branch/base before editing and trial immediately after
commit. These checks validate that record, not the identity of its author.
Exclusive ownership is required: checks and revert are NOT a transaction against
concurrent Git commands or filesystem writers. On failure, inspect Git's state;
this helper never resets, cleans, stashes, or aborts, even after an uncertain
postcondition.
"""

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys


class Refusal(Exception):
    pass


def require(condition, message):
    if not condition:
        raise Refusal(message)


def discard(args):
    # Also refuse object/config overrides that could alter what the record means.
    overrides = {
        "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_NAMESPACE", "GIT_REPLACE_REF_BASE", "GIT_CONFIG_PARAMETERS",
        "GIT_CONFIG_COUNT", "GIT_SHALLOW_FILE",
    }
    require(not overrides.intersection(os.environ),
            "inherited Git repository/config override; use an unambiguous environment")
    root = Path(args.worktree).resolve(strict=True)
    env = {**os.environ, "GIT_EDITOR": "true", "GIT_SEQUENCE_EDITOR": "true",
           "GIT_NO_REPLACE_OBJECTS": "1", "GIT_OPTIONAL_LOCKS": "0"}

    def git(*command):
        result = subprocess.run(["git", "-C", str(root), *command], env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode:
            sys.stderr.buffer.write(result.stderr)
            raise Refusal("Git validation failed")
        return result.stdout

    def text(*command):
        return os.fsdecode(git(*command)).strip()

    require(Path(text("rev-parse", "--show-toplevel")).resolve() == root,
            "--worktree must identify the repository root, not a subdirectory")
    gitdir = Path(text("rev-parse", "--absolute-git-dir")).resolve()
    common = Path(text("rev-parse", "--path-format=absolute", "--git-common-dir")).resolve()
    require(gitdir != common, "primary worktree is not a disposable linked worktree")
    require(args.branch not in ("main", "master"), "protected branch")
    require(text("symbolic-ref", "--quiet", "HEAD") == "refs/heads/" + args.branch,
            "attached branch differs from the recorded branch")
    for name, sha in (("base", args.base), ("trial", args.trial)):
        require(re.fullmatch(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})", sha),
                name + " must be a full 40/64-character commit SHA")
        require(text("cat-file", "-t", sha) == "commit", name + " is not a commit")
    base, trial = args.base.lower(), args.trial.lower()
    # Read the actual commit, not revision traversal affected by shallow history.
    parents = [line[7:] for line in text("cat-file", "-p", trial).split("\n\n", 1)[0].splitlines()
               if line.startswith("parent ")]
    require(parents == [base], "trial must have exactly one parent, the recorded base")

    def check_tip():
        require(text("symbolic-ref", "--quiet", "HEAD") == "refs/heads/" + args.branch,
                "attached branch changed")
        require(text("rev-parse", "HEAD") == trial, "HEAD is not the recorded trial")

    check_tip()
    for name in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge",
                 "rebase-apply", "sequencer"):
        require(not os.path.lexists(gitdir / name), "in-progress Git operation: " + name)
    require(not git("status", "--porcelain=v1", "-z", "--untracked-files=all",
                    "--ignore-submodules=none"),
            "tracked changes or nonignored untracked files exist")
    # Disable rename detection: deleted and renamed-away paths both become D.
    # Native revert can overwrite ignored files when restoring deleted paths.
    restored = git("diff-tree", "--no-commit-id", "--name-only", "-r", "-z",
                   "--no-renames", "--diff-filter=D", base, trial).split(b"\0")
    for raw in filter(None, restored):
        path = root / os.fsdecode(raw)
        require(not os.path.lexists(path), "restore path already exists: " + os.fsdecode(raw))
        # A file or symlink ancestor can obstruct restoration or redirect writes.
        for ancestor in path.parents:
            if ancestor == root:
                break
            require(not ancestor.is_symlink() and
                    (not os.path.lexists(ancestor) or ancestor.is_dir()),
                    "restore path has an obstructing ancestor: " + str(ancestor))

    check_tip()  # Last pre-operation check; not a concurrency lock.
    result = subprocess.run(["git", "-C", str(root), "revert", "--no-edit", trial],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    sys.stdout.buffer.write(result.stdout)
    sys.stderr.buffer.write(result.stderr)
    if result.returncode:
        return result.returncode  # Preserve native conflict/commit-failure state.
    reverted = text("rev-parse", "HEAD")
    require(text("symbolic-ref", "--quiet", "HEAD") == "refs/heads/" + args.branch
            and text("rev-list", "--parents", "-n", "1", reverted).split() == [reverted, trial]
            and text("rev-parse", reverted + "^{tree}") == text("rev-parse", base + "^{tree}")
            and not git("status", "--porcelain=v1", "-z", "--untracked-files=all",
                        "--ignore-submodules=none"),
            "uncertain revert postcondition; inspect state manually (no compensation attempted)")
    print("discarded " + trial + " via revert " + reverted)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("worktree", "branch", "base", "trial"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    try:
        return discard(args)
    except (Refusal, OSError) as error:
        print("refused: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
