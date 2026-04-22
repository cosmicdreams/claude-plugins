#!/usr/bin/env bash
# acquia-download.sh <app_uuid> <env_name> <log-type>
#
# Downloads one Acquia log type for one environment to stdout.
# Uses the Acquia Cloud API directly via acquia_api.py — no acli needed.
#
# Arguments:
#   app_uuid  Acquia application UUID
#   env_name  Environment name (dev, test, prod)
#   log-type  One of: php-error, apache-error, apache-access, drupal-watchdog
#
# Exits 0 on success, 1 on arg errors, 2 on download failure.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_SCRIPT="${SCRIPT_DIR}/monitors/acquia_api.py"

APP_UUID="${1:-}"
ENV_NAME="${2:-}"
LOG_TYPE="${3:-}"

if [ -z "$APP_UUID" ] || [ -z "$ENV_NAME" ] || [ -z "$LOG_TYPE" ]; then
  echo "Usage: acquia-download.sh <app_uuid> <env_name> <log-type>" >&2
  exit 1
fi

python3 - "$API_SCRIPT" "$APP_UUID" "$ENV_NAME" "$LOG_TYPE" <<'PY'
import importlib.util, json, os, sys, time, tempfile, urllib.request

api_path, app_uuid, env_name, log_type = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

spec = importlib.util.spec_from_file_location("acquia_api", api_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

client = mod.AcquiaClient()
env_id = client.resolve_env_id(app_uuid, env_name)

# Request log archive creation.
resp = client.request_log_download(env_id, log_type)
notification_url = resp.get("_links", {}).get("notification", {}).get("href")
if not notification_url:
    print(f"ERROR: no notification URL in response", file=sys.stderr)
    sys.exit(2)

# Poll until the archive is ready (up to 5 minutes).
print(f"Requested {log_type} download for {env_name}. Waiting...", file=sys.stderr)
for attempt in range(30):
    time.sleep(10)
    status = client.check_log_download(notification_url)
    progress = status.get("progress", 0)
    state = status.get("status", "")
    if state == "completed":
        # The notification does not include a download URL in _links —
        # fetch the logs list and pull the href from the matching entry.
        download_url = status.get("_links", {}).get("download", {}).get("href")
        if not download_url:
            logs = client._get(f"/environments/{env_id}/logs")
            for item in (logs.get("_embedded", {}).get("items", [])):
                if item.get("type") == log_type:
                    download_url = item.get("_links", {}).get("download", {}).get("href")
                    break
        if download_url:
            # The Acquia download URL redirects to a signed S3 URL.
            # We must NOT forward the bearer token to S3 (S3 returns 400).
            # Disable automatic redirect handling so we get the 302 directly,
            # then follow the Location header without auth headers.
            import urllib.error

            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, req, fp, code, msg, headers, newurl):
                    return None  # don't follow

            token = client._get_token()
            opener = urllib.request.build_opener(NoRedirect)
            req = urllib.request.Request(download_url, headers={"Authorization": f"Bearer {token}"})
            try:
                with opener.open(req, timeout=30) as r:
                    # Unlikely to reach here without redirect, but handle it.
                    while chunk := r.read(8192):
                        sys.stdout.buffer.write(chunk)
                    sys.exit(0)
            except urllib.error.HTTPError as e:
                if e.code in (301, 302, 303, 307, 308):
                    s3_url = e.headers.get("Location", "")
                    if not s3_url:
                        print("ERROR: redirect with no Location header", file=sys.stderr)
                        sys.exit(2)
                    # Fetch S3 URL without auth headers.
                    with urllib.request.urlopen(s3_url, timeout=120) as r:
                        while chunk := r.read(8192):
                            sys.stdout.buffer.write(chunk)
                    sys.exit(0)
                raise
        else:
            print("ERROR: completed but no download URL", file=sys.stderr)
            sys.exit(2)
    elif state == "failed":
        print(f"ERROR: download failed: {status.get('description','?')}", file=sys.stderr)
        sys.exit(2)
    print(f"  ...{progress}%", file=sys.stderr)

print("ERROR: timed out waiting for log archive", file=sys.stderr)
sys.exit(2)
PY
