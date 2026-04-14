#!/usr/bin/env bats

# Tests for scripts/acquia-baseline.sh. Stubs backfill.sh to emit
# a canned JSONL stream, then verifies aggregation.

setup() {
  DROVER_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$DROVER_ROOT/scripts/acquia-baseline.sh"
  TMP="$(mktemp -d)"

  # Fake backfill: ignores args, writes canned JSONL to DROVER_JSONL_OUT,
  # prints a BACKFILL summary to stdout.
  export DROVER_BACKFILL_SCRIPT="$TMP/fake-backfill.sh"
  cat > "$DROVER_BACKFILL_SCRIPT" <<'EOF'
#!/usr/bin/env bash
if [ -n "${DROVER_JSONL_OUT:-}" ]; then
  cat >> "$DROVER_JSONL_OUT" <<'JSONL'
{"fingerprint":"aaaa","severity":"error","source":"php","message":"Uncaught X","env":"pncb.prod","ts":"14-Apr-2026 20:00:00"}
{"fingerprint":"aaaa","severity":"error","source":"php","message":"Uncaught X","env":"pncb.prod","ts":"14-Apr-2026 20:30:00"}
{"fingerprint":"aaaa","severity":"error","source":"php","message":"Uncaught X","env":"pncb.prod","ts":"14-Apr-2026 21:00:00"}
{"fingerprint":"bbbb","severity":"notice","source":"watchdog","message":"some notice","env":"pncb.prod","ts":"14-Apr-2026 20:00:00"}
JSONL
fi
echo "BACKFILL done env=$1 events=4"
EOF
  chmod +x "$DROVER_BACKFILL_SCRIPT"
}

teardown() {
  rm -rf "$TMP"
}

@test "outputs baseline JSON with top_errors aggregated from backfill JSONL" {
  run "$SCRIPT" pncb.prod "$TMP/out"
  [ "$status" -eq 0 ]
  python3 -c "
import json
d = json.loads('''$output''')
top = d['top_errors']
# aaaa appears 3 times across 2 hours, bbbb once.
assert d['env_slug'] == 'prod', d
assert top[0]['fp'] == 'aaaa', top
assert top[0]['total_24h'] == 3, top
assert top[0]['hours_seen'] == 2, top
assert top[1]['fp'] == 'bbbb', top
"
}

@test "missing alias exits non-zero" {
  run "$SCRIPT"
  [ "$status" -ne 0 ]
}
