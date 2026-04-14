#!/usr/bin/env python3
"""
fingerprint-migrate.py <drover.db> [--dry-run]

Rewrites fingerprint hashes stored in open drover Beads tickets so the
triage cycle (now using the shared fingerprint_structured function in
scripts/fingerprint.py, sha256[:12]) keeps matching existing tickets
that carry the legacy sha1[:12] hash produced by the old inline
per-source Python helper.

Strategy: for each open ticket, parse `Severity/Type/Level/Message/File`
from the ticket body and recompute the fingerprint with the new scheme.
If the recomputed value differs from the one in the ticket body, update
the ticket body in place.

Safe to re-run. Emits one JSON object per ticket to stdout for audit:
  {"ticket":"drover-42","old":"abc123","new":"def456","status":"updated|unchanged|skipped"}

Requires: `bd` CLI in PATH, local drover.db path.
"""
import argparse
import importlib.util
import json
import pathlib
import re
import subprocess
import sys


def load_fingerprint_module():
    here = pathlib.Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location("fingerprint", here / "fingerprint.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def parse_ticket_fields(body: str) -> dict:
    """Pull structured fields a triage-produced ticket body contains."""
    out = {}
    # Markdown form.
    for key, pattern in [
        ("fp", r"\*\*Fingerprint:\*\*\s*`([0-9a-f]{6,16})`"),
        ("source", r"\*\*Source:\*\*\s*(\w+)"),
        ("type", r"\*\*Type:\*\*\s*([^\n]+)"),
        ("level", r"\*\*Level:\*\*\s*([^\n]+)"),
        ("file", r"\*\*File:\*\*\s*([^\n]+)"),
        ("message", r"\*\*Message:\*\*\s*([^\n]+)"),
    ]:
        m = re.search(pattern, body)
        if m:
            out[key] = m.group(1).strip()

    # JSON-shaped fallback: look for a fenced block whose contents have the keys.
    m = re.search(r"```json\s*\n(\{.*?\})\s*\n```", body, re.S)
    if m:
        try:
            j = json.loads(m.group(1))
            for k in ("source", "type", "level", "file", "message"):
                out.setdefault(k, j.get(k, ""))
        except Exception:
            pass
    return out


def list_open_tickets(db_path: pathlib.Path, bd_bin: str = "bd") -> list:
    out = subprocess.check_output(
        [bd_bin, "list", "-l", "board-drover", "--json", "--flat", "--db", str(db_path)],
        stderr=subprocess.DEVNULL, text=True,
    )
    return json.loads(out)


def update_ticket_body(tid: str, new_body: str, db_path: pathlib.Path, bd_bin: str = "bd") -> None:
    subprocess.check_call(
        [bd_bin, "update", tid, "--body", new_body, "--db", str(db_path)],
        stderr=subprocess.DEVNULL,
    )


def migrate(db_path: pathlib.Path, *, dry_run: bool, bd_bin: str) -> int:
    fp_mod = load_fingerprint_module()
    tickets = list_open_tickets(db_path, bd_bin=bd_bin)
    for item in tickets:
        tid = item.get("id")
        body = item.get("body", "") or ""
        fields = parse_ticket_fields(body)
        old = fields.get("fp", "")
        if not old:
            print(json.dumps({"ticket": tid, "old": "", "new": "", "status": "skipped"}))
            continue
        new = fp_mod.fingerprint_structured(
            fields.get("source", "other"),
            fields.get("message", ""),
            level=fields.get("level"),
            file=fields.get("file"),
            type_=fields.get("type"),
        )
        if new == old:
            print(json.dumps({"ticket": tid, "old": old, "new": new, "status": "unchanged"}))
            continue
        updated_body = body.replace(f"`{old}`", f"`{new}`")
        updated_body = updated_body.replace(f'"fp": "{old}"', f'"fp": "{new}"')
        if dry_run:
            print(json.dumps({"ticket": tid, "old": old, "new": new, "status": "would-update"}))
            continue
        update_ticket_body(tid, updated_body, db_path, bd_bin=bd_bin)
        print(json.dumps({"ticket": tid, "old": old, "new": new, "status": "updated"}))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("db", help="path to .beads/drover.db")
    ap.add_argument("--dry-run", action="store_true", help="print proposed changes, no writes")
    ap.add_argument("--bd", default="bd", help="bd binary override (tests)")
    args = ap.parse_args()
    db_path = pathlib.Path(args.db)
    if not db_path.exists():
        print(json.dumps({"error": f"db not found: {db_path}"}), file=sys.stderr)
        return 1
    return migrate(db_path, dry_run=args.dry_run, bd_bin=args.bd)


if __name__ == "__main__":
    sys.exit(main())
