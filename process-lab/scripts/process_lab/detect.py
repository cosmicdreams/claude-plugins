"""Conservative Bash command gate detection."""
import re
import shlex
import subprocess


def ticket_from(value, project):
    match = re.search(r"\b" + re.escape(project) + r"-\d+\b", (value or "")[:255])
    return match.group(0) if match else None


def current_branch(cwd):
    try:
        result = subprocess.run(["git", "-C", str(cwd), "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True, timeout=2, check=False)
        return result.stdout.strip()[:255] if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


_OPERATORS = ("&&", "||", ";", "|", "\n")


def _split(command):
    """Split a command into (text, separator) pairs at shell operators outside quotes,
    command substitution, and escapes. Returns None if quoting is unbalanced."""
    pairs, buf, i, quote, depth = [], [], 0, None, 0
    while i < len(command):
        ch = command[i]
        if quote:
            buf.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < len(command):
                buf.append(command[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch == "\\" and i + 1 < len(command):
            buf.append(command[i:i + 2])
            i += 2
            continue
        if ch in ("'", '"') and depth == 0:
            quote = ch
            buf.append(ch)
            i += 1
            continue
        if command.startswith("$(", i):
            depth += 1
            buf.append("$(")
            i += 2
            continue
        if ch == ")" and depth:
            depth -= 1
            buf.append(ch)
            i += 1
            continue
        if depth == 0:
            op = next((o for o in ("&&", "||") if command.startswith(o, i)), None) or (ch if ch in ";|\n" else None)
            if op:
                pairs.append(("".join(buf), op))
                buf = []
                i += len(op)
                continue
        buf.append(ch)
        i += 1
    if quote or depth:
        return None
    pairs.append(("".join(buf), None))
    return pairs


def segments(command):
    pairs = _split(command)
    if pairs is None:
        return []
    result = []
    for text, separator in pairs:
        try:
            words = shlex.split(text, posix=True)
        except ValueError:
            return []
        if words:
            result.append((words, separator))
        elif result and separator:
            result[-1] = (result[-1][0], separator)
    return result


def _message(words):
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
    parts = segments(command)
    found = []
    for index, (raw, separator) in enumerate(parts):
        words = list(raw)
        while words and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", words[0]):
            words.pop(0)
        while words and words[0] in ("rtk", "command"):
            words.pop(0)
        if not words:
            continue
        prior = parts[index - 1][1] if index else None
        certain = separator in (None, "&&") and prior not in ("||", "|")
        if separator == "&&":
            certain = certain and all(p[1] == "&&" for p in parts[index:-1])
        result = {"branch": None, "message": None, "index": index, "words": words, "certain": certain}
        if words[0] == "cd":
            found.append({**result, "detected_by": "cd", "path": words[1] if len(words) == 2 else None})
            continue
        normalized = " ".join(words)
        no_test = {"--collect-only", "--list", "--help", "-h", "--version"}
        for test in test_commands:
            if (normalized == test or normalized.startswith(test + " ")) and not any(w == option or w.startswith(option + "=") for w in words for option in no_test):
                found.append({**result, "detected_by": "tests-passed"})
                break
        git_words = words
        git_dir = None
        if git_words[0] == "git":
            git_words = git_words[1:]
            while len(git_words) >= 2 and git_words[0] == "-C":
                git_dir = git_words[1] if git_dir is None else git_dir + "/" + git_words[1]
                git_words = git_words[2:]
            kind, branch = None, None
            switches = False
            if git_words[:2] in (["checkout", "-b"], ["switch", "-c"]) and len(git_words) > 2:
                kind, branch, switches = "branch-created", git_words[2], True
            elif git_words[:1] == ["branch"] and len(git_words) > 1 and not git_words[1].startswith("-"):
                kind, branch = "branch-created", git_words[1]
            elif git_words[:1] in (["checkout"], ["switch"]) and len(git_words) == 2 and not git_words[1].startswith("-"):
                kind, branch, switches = "branch-switched", git_words[1], True
            elif git_words[:2] == ["worktree", "add"] and "-b" in git_words:
                pos = git_words.index("-b")
                if pos + 1 < len(git_words):
                    kind, branch = "branch-created", git_words[pos + 1]
            elif git_words[:1] == ["commit"]:
                options, skip = [], False
                for word in git_words[1:]:
                    if skip:
                        skip = False
                    elif word in ("-m", "--message", "-F", "--file", "-C", "-c"):
                        skip = True
                    elif not word.startswith(("--message=", "--file=")):
                        options.append(word)
                if "--dry-run" not in options:
                    kind = "commit"
            elif git_words[:1] == ["push"] and not any(w in ("--dry-run", "-n") for w in git_words):
                kind = "pushed"
            if kind:
                found.append({**result, "detected_by": kind, "branch": branch, "switches": switches, "message": _message(git_words) if kind == "commit" else None, "git_dir": git_dir})
        elif words[:3] == ["gh", "pr", "create"]:
            found.append({**result, "detected_by": "pull-request-opened"})
    return found
