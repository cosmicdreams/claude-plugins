#!/usr/bin/env bats

# Tests for scripts/monitors/acquia-watch.py
#
# The current implementation streams via acquia_logstream.connect(); we
# shadow that module with a fake on PYTHONPATH so the real WSS client is
# never touched. Events come from a JSON fixture pointed to by
# DROVER_EVENTS_FIXTURE.

setup() {
  DROVER_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT_PATH="$DROVER_ROOT/scripts/monitors/acquia-watch.py"
  TMP="$(mktemp -d)"
  export DROVER_STATE_DIR="$TMP/state"
  export DROVER_THRESHOLD=3
  export DROVER_FINGERPRINT_SCRIPT="$DROVER_ROOT/scripts/fingerprint.py"

  FAKE_LOGSTREAM="$TMP/fake_logstream.py"
  cat > "$FAKE_LOGSTREAM" <<'PY'
import asyncio, json, os, pathlib
async def connect(app_uuid, env_name, types=None):
    fixture = pathlib.Path(os.environ["DROVER_EVENTS_FIXTURE"])
    for ev in json.loads(fixture.read_text()):
        yield ev
        await asyncio.sleep(0)
PY

  # Wrapper preseeds sys.modules['acquia_logstream'] before the real
  # script imports it — the script's own sys.path.insert(0, parent_dir)
  # can't override a module already present in sys.modules.
  SCRIPT="$TMP/run-acquia-watch.sh"
  cat > "$SCRIPT" <<EOF
#!/usr/bin/env bash
exec python3 -c "
import sys, importlib.util, runpy
spec = importlib.util.spec_from_file_location('acquia_logstream', '$FAKE_LOGSTREAM')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
sys.modules['acquia_logstream'] = m
sys.argv = ['$SCRIPT_PATH'] + sys.argv[1:]
runpy.run_path('$SCRIPT_PATH', run_name='__main__')
" "\$@"
EOF
  chmod +x "$SCRIPT"
}

teardown() {
  rm -rf "$TMP"
}

write_events() {
  echo "$1" > "$TMP/events.json"
  export DROVER_EVENTS_FIXTURE="$TMP/events.json"
}

@test "emits NEW for a PHP fatal" {
  write_events '[
    {"log_type":"php-error","text":"PHP Fatal error:  Uncaught TypeError in /var/www/html/pncb.prod/docroot/modules/foo/src/Bar.php on line 42"}
  ]'
  run "$SCRIPT" prod.abc-123
  [[ "$output" == *"NEW "* ]]
}

@test "distinct fingerprints for fatal and watchdog notice" {
  write_events '[
    {"log_type":"php-error","text":"PHP Fatal error:  Uncaught TypeError in /var/www/html/foo.php on line 1"},
    {"log_type":"drupal-watchdog","text":"Sun, 2026/04/14 - 21:01 | php | Notice: Undefined index in /var/www/html/foo.module (line 99)."},
    {"log_type":"drupal-watchdog","text":"Sun, 2026/04/14 - 21:02 | php | Notice: Undefined index in /var/www/html/foo.module (line 99)."}
  ]'
  run "$SCRIPT" prod.abc-123
  new_count=$(echo "$output" | grep -c "^NEW " || true)
  [ "$new_count" -eq 2 ]
}

@test "emits THRESH at threshold" {
  write_events '[
    {"log_type":"drupal-watchdog","text":"Sun, 2026/04/14 - 21:01 | php | Notice: X in /a.module (line 1)."},
    {"log_type":"drupal-watchdog","text":"Sun, 2026/04/14 - 21:02 | php | Notice: X in /a.module (line 1)."},
    {"log_type":"drupal-watchdog","text":"Sun, 2026/04/14 - 21:03 | php | Notice: X in /a.module (line 1)."}
  ]'
  run "$SCRIPT" prod.abc-123
  [[ "$output" == *"THRESH "* ]]
  [[ "$output" == *"count=3"* ]]
}

@test "state file created per alias" {
  write_events '[{"log_type":"php-error","text":"PHP Fatal error: boom in /x.php on line 1"}]'
  "$SCRIPT" prod.abc-123 > /dev/null
  [ -f "$DROVER_STATE_DIR/prod.abc-123.json" ]
}

@test "rejects legacy single-id alias format" {
  run "$SCRIPT" env-abc
  [ "$status" -eq 2 ]
  [[ "$output" == *"expected alias format"* ]]
}

@test "invalid_id slug classified as permanent (exit 3)" {
  # sprint-cxl safety net. HTTP 400 invalid_id means the UUID we passed to
  # the Acquia API does not exist — no amount of retry will fix it (user
  # needs to re-run /drover:setup or add-project with correct creds).
  # The umbrella quarantines permanent failures (exit 3) for an hour
  # instead of respawning them every 30 seconds.
  #
  # Override the fake logstream to raise an invalid_id-shaped exception.
  cat > "$FAKE_LOGSTREAM" <<'PY'
class AcquiaAPIError(Exception):
    def __init__(self, msg, status, slug):
        super().__init__(msg)
        self.status = status
        self.error_slug = slug
async def connect(app_uuid, env_name, types=None):
    raise AcquiaAPIError("invalid application id", 400, "invalid_id")
    yield  # pragma: no cover
PY
  run "$SCRIPT" prod.abc-123
  [ "$status" -eq 3 ]
  [[ "$output" == *"PERMANENT"* ]]
  [[ "$output" == *"invalid_id"* ]]
}

@test "forbidden_ip slug classified as permanent (regression)" {
  cat > "$FAKE_LOGSTREAM" <<'PY'
class AcquiaAPIError(Exception):
    def __init__(self, msg, status, slug):
        super().__init__(msg)
        self.status = status
        self.error_slug = slug
async def connect(app_uuid, env_name, types=None):
    raise AcquiaAPIError("ip not allowlisted", 403, "forbidden_ip")
    yield  # pragma: no cover
PY
  run "$SCRIPT" prod.abc-123
  [ "$status" -eq 3 ]
}

@test "transient network error stays exit 1 (not permanent)" {
  cat > "$FAKE_LOGSTREAM" <<'PY'
class AcquiaAPIError(Exception):
    def __init__(self, msg, status, slug):
        super().__init__(msg)
        self.status = status
        self.error_slug = slug
async def connect(app_uuid, env_name, types=None):
    raise AcquiaAPIError("gateway timeout", 504, "timeout")
    yield  # pragma: no cover
PY
  run "$SCRIPT" prod.abc-123
  [ "$status" -eq 1 ]
  [[ "$output" == *"TRANSIENT"* ]]
}

@test "missing alias exits 2" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
}
