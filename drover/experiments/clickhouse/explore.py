"""Run every sql/explore query over all captured drover logs and time each.

  python3 explore.py [~/Sites]   ->  results/explore.json
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLICKHOUSE = os.environ.get("CLICKHOUSE_BIN", str(HERE / "bin" / "clickhouse"))


def main(root: Path) -> int:
    out = []
    for q in sorted((HERE / "sql" / "explore").glob("*.sql")):
        t0 = time.perf_counter()
        proc = subprocess.run([CLICKHOUSE, "local", f"--param_root={root}", "--queries-file", str(q)],
                              capture_output=True, text=True)
        secs = time.perf_counter() - t0
        if proc.returncode != 0:
            raise SystemExit(f"{q.name}: {proc.stderr[:2000]}")
        rows = [json.loads(l) for l in proc.stdout.splitlines() if l]
        title = q.read_text().splitlines()[0].lstrip("- ").strip()
        out.append({"query": q.stem, "title": title, "sql": q.read_text(), "seconds": round(secs, 2), "rows": rows})
        print(f"{q.stem}: {secs:.1f}s, {len(rows)} rows", flush=True)
    (HERE / "results").mkdir(parents=True, exist_ok=True)
    (HERE / "results" / "explore.json").write_text(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1] if len(sys.argv) > 1 else "~/Sites").expanduser()))
