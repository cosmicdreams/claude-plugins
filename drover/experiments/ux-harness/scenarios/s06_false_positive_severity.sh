#!/usr/bin/env bash
# Pipe access-log lines that contain error-like words in URLs/user-agents
# through fingerprint.py. None should be classified as errors.
set -u
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_ROOT="$(cd "$HARNESS_DIR/../.." && pwd)"

python3 - <<PY
import importlib.util, json, pathlib, sys
fp_path = pathlib.Path("$PLUGIN_ROOT/scripts/fingerprint.py")
spec = importlib.util.spec_from_file_location("fp", fp_path)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

fixture = pathlib.Path("$HARNESS_DIR/fixtures/access-log-false-positives.txt").read_text().splitlines()
false_positives = 0
for line in fixture:
    if not line.strip():
        continue
    ev = m.process(line)
    if ev is not None:
        false_positives += 1

print(json.dumps({"metric":"access_log_false_positives","value":false_positives,"notes":"access-log lines misclassified as errors; target 0"}))
PY
