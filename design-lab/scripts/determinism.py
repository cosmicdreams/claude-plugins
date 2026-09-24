#!/usr/bin/env python3
"""Canonical layout hashes for a repeat-build determinism gate.

Only timestamp and run-identity metadata is omitted, plus the `_ids` block of a page dump,
which holds the Figma node ids a new file always assigns afresh. Array order and every
layout value remain significant. The expected hash file contains one lowercase SHA-256 hex.
"""

import argparse
import hashlib
import json
from pathlib import Path


IGNORED_KEYS = frozenset({"generatedAt", "generated_at", "timestamp", "createdAt",
                          "updatedAt", "runId", "run_id", "runID", "_ids"})


def normalize(value):
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()
                if key not in IGNORED_KEYS}
    if isinstance(value, list):
        return [normalize(item) for item in value]
    return value


def canonical_hash(layout):
    """Return the SHA-256 digest of normalized JSON, independent of key order."""
    payload = json.dumps(normalize(layout), sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False, allow_nan=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def hash_layout(path):
    with open(path, encoding="utf-8") as handle:
        return canonical_hash(json.load(handle))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="compare a layout against an expected SHA-256")
    check.add_argument("layout")
    check.add_argument("expected_hash_file")
    args = parser.parse_args(argv)
    expected = Path(args.expected_hash_file).read_text(encoding="utf-8").strip().lower()
    if len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
        parser.error("expected hash file must contain one SHA-256 hex digest")
    actual = hash_layout(args.layout)
    if actual != expected:
        print(f"FAIL layout determinism: expected {expected}, got {actual}")
        return 1
    print(f"PASS layout determinism: {actual}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
