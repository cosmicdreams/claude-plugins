"""Conservative Bash command gate detection."""
import re
import shlex
import subprocess


def ticket_from(value, project):
    match = re.search(r"\b" + re.escape(project) + r"-\d+\b", value or "")
    return match.group(0) if match else None


def current_branch(cwd):
    try:
        result = subprocess.run(["git", "-C", str(cwd), "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True, timeout=2, check=False)
        return result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def segments(command):
    # Keep a commit-message heredoc together while splitting shell command chains.
    blocks = []
    pattern = re.compile(r"<<['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?[^\n]*\n.*?\n\1\b", re.S)
    def protect(match):
        blocks.append(match.group(0))
        return "__PROCESS_LAB_HEREDOC_" + str(len(blocks) - 1) + "__"
    protected = pattern.sub(protect, command)
    parts = [part.strip() for part in re.split(r"&&|\|\||[;|\n]", protected) if part.strip()]
    for index, part in enumerate(parts):
        for number, block in enumerate(blocks):
            part = part.replace("__PROCESS_LAB_HEREDOC_" + str(number) + "__", block)
        parts[index] = part
    return parts


def _tokens(segment):
    try:
        words = shlex.split(segment)
    except ValueError:
        words = segment.split()
    while words and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", words[0]):
        words.pop(0)
    while words and words[0] in ("rtk", "command"):
        words.pop(0)
    return words


def _message(words, segment):
    if "<<" in segment:
        match = re.search(r"<<['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?\s*\n(.*?)\n\1", segment, re.S)
        if match:
            return match.group(2)
    result = []
    for index, word in enumerate(words):
        if word in ("-m", "--message") and index + 1 < len(words):
            result.append(words[index + 1])
        elif word.startswith("--message="):
            result.append(word.split("=", 1)[1])
        elif word.startswith("-m") and len(word) > 2:
            result.append(word[2:])
    return "\n".join(result) if result else None


def detect(command, test_commands=()):
    found = []
    for segment in segments(command):
        words = _tokens(segment)
        if not words:
            continue
        normalized = " ".join(words)
        for test in test_commands:
            if normalized == test or normalized.startswith(test + " "):
                found.append({"detected_by": "tests-passed", "branch": None, "message": None})
                break
        if words[:1] == ["git"]:
            kind, branch = None, None
            if words[1:3] == ["checkout", "-b"] and len(words) > 3:
                kind, branch = "branch-created", words[3]
            elif words[1:3] == ["switch", "-c"] and len(words) > 3:
                kind, branch = "branch-created", words[3]
            elif words[1:2] == ["branch"] and len(words) > 2 and not words[2].startswith("-"):
                kind, branch = "branch-created", words[2]
            elif words[1:3] == ["worktree", "add"] and "-b" in words:
                index = words.index("-b")
                if index + 1 < len(words):
                    kind, branch = "branch-created", words[index + 1]
            elif words[1:2] == ["commit"]:
                kind = "commit"
            elif words[1:2] == ["push"]:
                kind = "pushed"
            if kind:
                found.append({"detected_by": kind, "branch": branch, "message": _message(words, segment) if kind == "commit" else None})
        elif words[:3] == ["gh", "pr", "create"]:
            found.append({"detected_by": "pull-request-opened", "branch": None, "message": None})
    return found
