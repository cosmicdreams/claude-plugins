#!/usr/bin/env python3
"""Read the person's explicit corpus and scoreboard locations."""
from __future__ import annotations

import json
import os
from pathlib import Path


def load_config() -> dict:
    path = Path(os.environ.get("DESIGN_LAB_CONFIG", "~/.claude/design-lab.json")).expanduser()
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ValueError(f"missing configuration file {path}; required keys: corpus, scoreboard.ledger, scoreboard.dashboard") from None
    except (OSError, ValueError) as error:
        raise ValueError(f"cannot read configuration {path}: {error}") from None
    for key in ("corpus", "scoreboard.ledger", "scoreboard.dashboard"):
        item = value
        for part in key.split("."):
            item = item.get(part) if isinstance(item, dict) else None
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{path}: missing or invalid configuration key {key}")
    return {"corpus": str(Path(value["corpus"]).expanduser().resolve()),
            "scoreboard": {k: str(Path(value["scoreboard"][k]).expanduser().resolve())
                           for k in ("ledger", "dashboard")}}


def site_path(label: str) -> Path:
    if not label or label in (".", "..") or Path(label).name != label or "\\" in label:
        raise ValueError("site label must be a single directory name")
    return Path(load_config()["corpus"]) / label


# The person's design-lab settings, written by design-lab:init (scripts/lab_setup.py) and read
# by every run. Everything here is about the person and this machine; nothing about a site.
CONVENTIONS = ("project", "home")
PROJECT_MARKERS = ("plans", "analysis-reports", "design")


def config_path() -> Path:
    return Path(os.environ.get("DESIGN_LAB_CONFIG", "~/.claude/design-lab.json")).expanduser()


def read_config() -> dict:
    """The configuration as written, or {} when there is none yet (design-lab:init writes it)."""
    try:
        value = json.loads(config_path().read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as error:
        raise ValueError(f"cannot read configuration {config_path()}: {error}") from None
    return value if isinstance(value, dict) else {}


def write_config(value: dict) -> Path:
    """Replace the whole configuration in one step. Callers read it, change their keys and write
    it back, so the keys they do not touch are kept."""
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)
    return path


def repository_root(start: Path) -> Path | None:
    """The working copy holding `start`: the nearest folder with a .git entry (a folder, or the
    file a linked worktree has)."""
    for folder in (start, *start.parents):
        if (folder / ".git").exists():
            return folder
    return None


def project_folder(start: Path) -> Path | None:
    """The person's project folder for the code at `start`: the folder above `worktrees/` when the
    code is checked out as PROJECT/worktrees/<name>, else the nearest folder above the
    repository that already holds plans/, analysis-reports/ or design/. None when neither."""
    start = Path(start).resolve()
    repo = repository_root(start)
    if repo is None:
        # Not inside a working copy: the project folder itself, or a folder within it.
        for folder in (start, *start.parents):
            if folder == Path.home() or folder == folder.parent:
                return None
            if (folder / "worktrees").is_dir() or any((folder / marker).is_dir() for marker in PROJECT_MARKERS):
                return folder
        return None
    if repo.parent.name == "worktrees":
        return repo.parent.parent
    for folder in (repo.parent, *repo.parent.parents):
        if folder == Path.home() or folder == folder.parent:
            break
        if any((folder / marker).is_dir() for marker in PROJECT_MARKERS):
            return folder
    return None


def project_name(start: Path) -> str:
    start = Path(start).resolve()
    return (project_folder(start) or repository_root(start) or start).name


def claude_account_name() -> str | None:
    """The name of the person signed in to Claude Code, from Claude Code's own account record. Each
    configuration folder (CLAUDE_CONFIG_DIR) keeps its own; the default one is ~/.claude.json."""
    folder = os.environ.get("CLAUDE_CONFIG_DIR")
    path = Path(folder).expanduser() / ".claude.json" if folder else Path.home() / ".claude.json"
    try:
        account = json.loads(path.read_text()).get("oauthAccount") or {}
    except (OSError, ValueError, AttributeError):
        return None
    name = account.get("fullName") or account.get("displayName")
    return name.strip() if isinstance(name, str) and name.strip() else None


def runs_folder(start: Path, config: dict | None = None) -> Path:
    """Where this project's runs live, by the person's convention. Never inside the repository:
    runs are personal, like this configuration."""
    config = read_config() if config is None else config
    convention = (config.get("runs") or {}).get("convention")
    if convention not in CONVENTIONS:
        raise ValueError("design-lab has not been set up on this machine: run design-lab:init once, "
                         "which decides where runs live (or give --workspace)")
    if convention == "home":
        return Path.home() / ".design" / project_name(start)
    folder = project_folder(start)
    if folder is None:
        raise ValueError(f"cannot tell which folder holds the project for {start}: it is not checked out as "
                         "PROJECT/worktrees/<name>, and no folder above it has plans/, analysis-reports/ or design/; "
                         "create PROJECT/design, give --workspace, or switch design-lab:init to the home convention")
    return folder / "design"


def inside_repository(path: Path) -> Path | None:
    """The working copy a path would land in, every link followed, or None."""
    resolved = Path(path).expanduser()
    while not resolved.exists() and resolved != resolved.parent:
        resolved = resolved.parent
    return repository_root(resolved.resolve())


def runs_in(folder: Path) -> list[Path]:
    """The run folders in a runs folder, oldest first by when each run began, then by folder name
    (the pane orders them the same way)."""
    found = []
    for child in folder.iterdir() if folder.is_dir() else ():
        try:
            created = json.loads((child / "project.json").read_text(encoding="utf-8")).get("createdAt") or ""
        except (OSError, ValueError):
            continue
        found.append((created, child.name, child))
    return [child for _, _, child in sorted(found)]


def next_run(start: Path, today: str, config: dict | None = None) -> Path:
    """A new run folder for today, created here so no other run can take it: <runs>/<date>, then
    <date>-2, -3 for later runs that day."""
    folder = runs_folder(start, config)
    repo = inside_repository(folder)
    if repo is not None:
        raise ValueError(f"the runs folder {folder} is inside the working copy {repo}; runs are personal and never "
                         "committed, so they live outside every repository")
    folder.mkdir(parents=True, exist_ok=True)
    n = 1
    while True:
        candidate = folder / (today if n == 1 else f"{today}-{n}")
        try:
            candidate.mkdir()
            return candidate
        except FileExistsError:
            n += 1


def current_run(start: Path) -> tuple[Path | None, Path | None]:
    """The run to show for a session in `start`, and the runs folder it came from: the newest run
    there, or (None, folder) when this project has no run yet; (None, None) when no runs folder
    can be determined (no setup, or no recognisable project)."""
    try:
        folder = runs_folder(start)
    except ValueError:
        return None, None
    runs = runs_in(folder)
    return (runs[-1] if runs else None), folder
