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
