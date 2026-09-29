"""Project manifest discovery and validation."""
import json
import re
from re import _parser
from pathlib import Path


class ManifestError(ValueError):
    pass


def find_manifest(cwd):
    """Look upward, but never beyond the containing Git repository."""
    path = Path(cwd).resolve()
    for directory in (path, *path.parents):
        candidate = directory / ".velir" / "project.json"
        if candidate.is_file():
            return candidate
        if (directory / ".git").exists():
            break
    return None


def _unsafe_pattern(value):
    def has_complex(items):
        for op, arg in items:
            if op in (_parser.MAX_REPEAT, _parser.MIN_REPEAT, _parser.BRANCH):
                return True
            if op == _parser.SUBPATTERN and has_complex(arg[-1]):
                return True
        return False
    def risky(items):
        for op, arg in items:
            if op in (_parser.MAX_REPEAT, _parser.MIN_REPEAT):
                if has_complex(arg[2]) or risky(arg[2]):
                    return True
            elif op == _parser.SUBPATTERN and risky(arg[-1]):
                return True
            elif op == _parser.BRANCH and any(risky(branch) for branch in arg[1]):
                return True
        return False
    return risky(_parser.parse(value))


def load_manifest(cwd):
    path = find_manifest(cwd)
    if path is None:
        return None, None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ManifestError("manifest must be an object")
        for field in ("client", "mode"):
            if not isinstance(data.get(field), str) or not data[field].strip():
                raise ManifestError("invalid " + field)
        if data["mode"] not in ("observe", "enforce"):
            raise ManifestError("mode must be observe or enforce")
        jira = data.get("jira")
        if not isinstance(jira, dict) or not isinstance(jira.get("project"), str) or not re.fullmatch(r"[A-Z][A-Z0-9]*", jira["project"]):
            raise ManifestError("invalid jira.project")
        if "estimate_field" in jira and jira["estimate_field"] is not None and not isinstance(jira["estimate_field"], str):
            raise ManifestError("invalid jira.estimate_field")
        confluence = data.get("confluence")
        if not isinstance(confluence, dict) or not isinstance(confluence.get("space"), str) or not confluence["space"]:
            raise ManifestError("invalid confluence.space")
        pages = confluence.get("pages")
        if not isinstance(pages, dict) or not isinstance(pages.get("process"), int) or isinstance(pages["process"], bool) or pages["process"] <= 0:
            raise ManifestError("invalid confluence.pages.process")
        for key, value in pages.items():
            if not isinstance(key, str) or not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise ManifestError("invalid confluence.pages")
        conventions = data.get("conventions", {})
        if not isinstance(conventions, dict):
            raise ManifestError("invalid conventions")
        pattern = conventions.get("branch_pattern")
        if pattern is not None:
            if not isinstance(pattern, str):
                raise ManifestError("invalid branch_pattern")
            try:
                compiled = pattern.replace("{ticket}", re.escape(jira["project"]) + r"-\d+")
                re.compile(compiled)
                if _unsafe_pattern(compiled):
                    data.setdefault("warnings", []).append("Unsafe branch_pattern ignored: quantified group contains a quantifier or alternatives")
                    pattern = None
            except re.error as exc:
                raise ManifestError("invalid branch_pattern") from exc
        commands = conventions.get("test_commands", [])
        if not isinstance(commands, list) or any(not isinstance(item, str) or not item.strip() for item in commands):
            raise ManifestError("invalid test_commands")
        data["conventions"] = {"branch_pattern": pattern, "test_commands": commands}
        return data, path.parent.parent
    except (OSError, json.JSONDecodeError, ManifestError) as exc:
        raise ManifestError(str(exc)) from exc


def branch_pattern(manifest):
    value = manifest["conventions"]["branch_pattern"]
    if value is None:
        return None
    return re.compile(value.replace("{ticket}", re.escape(manifest["jira"]["project"]) + r"-\d+"))


def bounded_fullmatch(pattern, value, seconds=0.05):
    """Match with a time limit so a pathological pattern cannot stall a hook.
    A timeout counts as a match: never fail a check the plugin could not evaluate."""
    import signal
    value = value[:255]
    if not hasattr(signal, "setitimer"):
        return bool(pattern.fullmatch(value))

    class _Timeout(Exception):
        pass

    def _raise(signum, frame):
        raise _Timeout()

    try:
        previous = signal.signal(signal.SIGALRM, _raise)
    except ValueError:
        return bool(pattern.fullmatch(value))
    try:
        signal.setitimer(signal.ITIMER_REAL, seconds)
        return bool(pattern.fullmatch(value))
    except _Timeout:
        return True
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
