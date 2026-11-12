"""Find and run clickhouse-local for drover's access-log trend reports.

ClickHouse is optional for drover as a whole and required only to summarise
access logs. Discovery order: DROVER_CLICKHOUSE (a path to the binary), then
`clickhouse` on PATH. The binary must be at least MIN_VERSION.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

MIN_VERSION = (26, 10)
INSTALL_HINT = (
    "drover trend reports need ClickHouse (clickhouse-local), version "
    f"{MIN_VERSION[0]}.{MIN_VERSION[1]} or newer.\n"
    "  macOS:  brew install --cask clickhouse\n"
    "  Linux:  curl https://clickhouse.com/ | sh   (then move ./clickhouse onto PATH)\n"
    "Or point DROVER_CLICKHOUSE at an existing binary. About 1 GB on disk."
)
# Per-query memory cap. A busy month peaks near 1.6 GB.
DEFAULT_MAX_MEMORY = 4 * 1024 ** 3


class ClickHouseUnavailable(RuntimeError):
    """No usable clickhouse binary; the message says why and how to fix it."""


@dataclass(frozen=True)
class ClickHouse:
    path: str
    version: str

    def run(self, sql: str, params: dict[str, str] | None = None) -> str:
        """Run SQL through `clickhouse local` and return stdout."""
        cmd = [self.path, "local", "--max_memory_usage",
               os.environ.get("DROVER_CLICKHOUSE_MAX_MEMORY", str(DEFAULT_MAX_MEMORY))]
        for key, value in (params or {}).items():
            cmd.append(f"--param_{key}={value}")
        proc = subprocess.run(cmd, input=sql, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"clickhouse local failed: {proc.stderr.strip()[:2000]}")
        return proc.stdout


def parse_version(text: str) -> tuple[int, ...] | None:
    m = re.search(r"version (\d+)\.(\d+)", text)
    return (int(m.group(1)), int(m.group(2))) if m else None


def find_clickhouse() -> ClickHouse:
    """Return a usable ClickHouse or raise ClickHouseUnavailable."""
    override = os.environ.get("DROVER_CLICKHOUSE")
    if override:
        path = override
        if not Path(path).is_file():
            raise ClickHouseUnavailable(f"DROVER_CLICKHOUSE={path} is not a file.\n{INSTALL_HINT}")
    else:
        path = shutil.which("clickhouse")
        if not path:
            raise ClickHouseUnavailable(f"clickhouse not found on PATH.\n{INSTALL_HINT}")
    try:
        out = subprocess.run([path, "local", "--version"], capture_output=True,
                             text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ClickHouseUnavailable(f"could not run {path}: {exc}\n{INSTALL_HINT}") from exc
    version = parse_version(out.stdout + out.stderr)
    if out.returncode != 0 or version is None:
        raise ClickHouseUnavailable(
            f"{path} did not report a version: {(out.stderr or out.stdout).strip()[:300]}\n{INSTALL_HINT}")
    if version < MIN_VERSION:
        raise ClickHouseUnavailable(
            f"{path} is version {version[0]}.{version[1]}; drover needs "
            f"{MIN_VERSION[0]}.{MIN_VERSION[1]} or newer.\n{INSTALL_HINT}")
    return ClickHouse(path=path, version=f"{version[0]}.{version[1]}")


if __name__ == "__main__":
    import sys
    try:
        ch = find_clickhouse()
    except ClickHouseUnavailable as exc:
        print(exc, file=sys.stderr)
        sys.exit(3)
    print(f"clickhouse {ch.version} at {ch.path}")
