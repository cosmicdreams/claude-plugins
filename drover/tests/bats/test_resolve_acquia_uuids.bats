#!/usr/bin/env bats

# Tests for scripts/resolve-acquia-uuids.sh — stubs acli.

setup() {
  DROVER_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$DROVER_ROOT/scripts/resolve-acquia-uuids.sh"
  TMP="$(mktemp -d)"

  # Fake acli that responds to two subcommands.
  export DROVER_ACLI="$TMP/fake-acli"
  cat > "$DROVER_ACLI" <<'EOF'
#!/usr/bin/env bash
case "$1-$2" in
  api:applications-list:)
    # No-op, fall through to full match below.
    ;;
esac
if [ "$1" = "api:applications:list" ]; then
  cat <<'JSON'
[
  {"uuid": "app-pncb-uuid", "name": "Pediatric Nursing Certification Board"},
  {"uuid": "app-other-uuid", "name": "Other"}
]
JSON
elif [ "$1" = "api:applications:environment-list" ]; then
  if [ "$2" = "app-pncb-uuid" ]; then
    cat <<'JSON'
[
  {"id": "30395-pncb-prod", "name": "prod", "domains": ["pncb.prod.acquia-sites.com", "www.pncb.org"], "default_domain": "pncb.prod.acquia-sites.com"},
  {"id": "30396-pncb-dev",  "name": "dev",  "domains": ["pncbdev.prod.acquia-sites.com"],           "default_domain": "pncbdev.prod.acquia-sites.com"}
]
JSON
  else
    echo '[]'
  fi
fi
EOF
  chmod +x "$DROVER_ACLI"
}

teardown() {
  rm -rf "$TMP"
}

@test "resolves app_uuid and env_uuid for pncb dev/prod" {
  echo '[{"alias":"pncb.dev","env":"dev","site":"pncb","drush_alias":"@pncb.dev"},{"alias":"pncb.prod","env":"prod","site":"pncb","drush_alias":"@pncb.prod"}]' \
    | "$SCRIPT" > "$TMP/out.json"
  python3 -c "
import json
d = json.load(open('$TMP/out.json'))
by_env = {e['env']: e for e in d}
assert by_env['dev']['app_uuid']  == 'app-pncb-uuid',   by_env['dev']
assert by_env['dev']['env_uuid']  == '30396-pncb-dev',  by_env['dev']
assert by_env['prod']['app_uuid'] == 'app-pncb-uuid',   by_env['prod']
assert by_env['prod']['env_uuid'] == '30395-pncb-prod', by_env['prod']
"
}

@test "passes through unresolvable entries without crashing" {
  echo '[{"alias":"ghost.dev","env":"dev","site":"ghost","drush_alias":"@ghost.dev"}]' \
    | "$SCRIPT" > "$TMP/out.json"
  python3 -c "
import json
d = json.load(open('$TMP/out.json'))
assert len(d) == 1
assert 'app_uuid' not in d[0]
"
}

@test "empty input returns empty array" {
  run bash -c 'echo "[]" | '"$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$output" = "[]" ]
}
