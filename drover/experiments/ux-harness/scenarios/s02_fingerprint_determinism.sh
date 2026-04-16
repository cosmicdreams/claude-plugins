#!/usr/bin/env bash
# Feed 20 trivially-varied copies of the same error (different timestamps,
# pids, memory addresses) through fingerprint.py; count unique fingerprints.
set -u
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_ROOT="$(cd "$HARNESS_DIR/../.." && pwd)"

python3 - <<PY
import importlib.util, json, pathlib, random, sys
fp_path = pathlib.Path("$PLUGIN_ROOT/scripts/fingerprint.py")
spec = importlib.util.spec_from_file_location("fp", fp_path)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

random.seed(0)
base = "Wed, 2026/04/{d:02d} - {h:02d}:{mm:02d}  | php   | Notice: Undefined variable \$foo in /var/www/html/web/modules/custom/a/a.module on line 10"
fps = set()
for i in range(20):
    line = base.format(d=random.randint(1,28), h=random.randint(0,23), mm=random.randint(0,59))
    ev = m.process(line)
    if ev: fps.add(ev["fingerprint"])

# Dedup rate on the full 50-line 3-error fixture.
fixture = pathlib.Path("$HARNESS_DIR/fixtures/watchdog-3errors-50lines.txt").read_text().splitlines()
unique = set()
processed = 0
for line in fixture:
    ev = m.process(line)
    if ev:
        unique.add(ev["fingerprint"])
        processed += 1
dedup = round((processed - len(unique)) / processed, 3) if processed else 0

print(json.dumps({"metric":"fingerprint_determinism","value":len(fps),"notes":"20 varied copies of one error; 1 = perfect"}))
print(json.dumps({"metric":"fingerprint_unique_on_3error_fixture","value":len(unique),"notes":"50 lines, 3 distinct errors; target 3"}))
print(json.dumps({"metric":"fingerprint_dedup_rate","value":dedup,"notes":"(processed-unique)/processed; higher = more collapse"}))
PY
