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


def _lex(command):
    # A here document inside command substitution is opaque to shell chain splitting.
    blocks = []
    pattern = re.compile(r"\$\(cat\s+<<['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?\s*\n.*?\n\1\s*\)", re.S)
    def protect(match):
        blocks.append(match.group(0))
        return "PROCESSLABHEREDOC" + str(len(blocks) - 1) + "TOKEN"
    protected = pattern.sub(protect, command)
    lexer = shlex.shlex(protected, posix=True, punctuation_chars=";&|\n")
    lexer.whitespace_split = True
    lexer.whitespace = " \t\r"
    lexer.commenters = ""
    try:
        words = list(lexer)
    except ValueError:
        return []
    for i, word in enumerate(words):
        for number, block in enumerate(blocks):
            word = word.replace("PROCESSLABHEREDOC" + str(number) + "TOKEN", block)
        words[i] = word
    return words


def segments(command):
    words = _lex(command)
    result, current = [], []
    for word in words:
        if word in ("&&", "||", ";", "|", "\n"):
            if current:
                result.append((current, word))
                current = []
            elif result:
                result[-1] = (result[-1][0], word)
        else:
            current.append(word)
    if current:
        result.append((current, None))
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
            if git_words[:2] in (["checkout", "-b"], ["switch", "-c"]) and len(git_words) > 2:
                kind, branch = "branch-created", git_words[2]
            elif git_words[:1] == ["branch"] and len(git_words) > 1 and not git_words[1].startswith("-"):
                kind, branch = "branch-created", git_words[1]
            elif git_words[:2] == ["worktree", "add"] and "-b" in git_words:
                pos = git_words.index("-b")
                if pos + 1 < len(git_words):
                    kind, branch = "branch-created", git_words[pos + 1]
            elif git_words[:1] == ["commit"]:
                options = git_words[1:]
                for marker in ("-m", "--message"):
                    if marker in options:
                        options = options[:options.index(marker)]
                if "--dry-run" not in options:
                    kind = "commit"
            elif git_words[:1] == ["push"] and not any(w in ("--dry-run", "-n") for w in git_words):
                kind = "pushed"
            if kind:
                found.append({**result, "detected_by": kind, "branch": branch, "message": _message(git_words) if kind == "commit" else None, "git_dir": git_dir})
        elif words[:3] == ["gh", "pr", "create"]:
            found.append({**result, "detected_by": "pull-request-opened"})
    return found
