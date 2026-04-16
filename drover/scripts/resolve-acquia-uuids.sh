#!/usr/bin/env bash
# resolve-acquia-uuids.sh — enrich Acquia env entries with cached UUIDs.
#
# stdin : JSON array of {"alias","env","site","drush_alias"}
# stdout: same array plus app_uuid, env_uuid, default_domain where discoverable.
#
# Uses the Acquia Cloud API directly — no acli needed.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_SCRIPT="${SCRIPT_DIR}/monitors/acquia_api.py"

python3 - "$API_SCRIPT" <<'PY'
import importlib.util, json, sys

spec = importlib.util.spec_from_file_location("acquia_api", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

client = mod.AcquiaClient()
envs_in = json.load(sys.stdin)
if not envs_in:
    print(json.dumps([]))
    sys.exit(0)

sites = sorted({e.get("site") for e in envs_in if e.get("site")})

apps = client.list_applications()
app_by_site = {}
cache_envs_per_app = {}

def envs_for(app_uuid):
    if app_uuid not in cache_envs_per_app:
        cache_envs_per_app[app_uuid] = client.list_environments(app_uuid)
    return cache_envs_per_app[app_uuid]

for app in apps:
    uuid = app.get("uuid")
    if not uuid:
        continue
    for env in envs_for(uuid):
        for dom in env.get("domains", []) or []:
            parts = dom.split(".")
            if len(parts) >= 4 and parts[-1] == "com" and parts[-2] == "acquia-sites":
                prefix = parts[0]
                for site in sites:
                    if prefix == site or prefix.startswith(site):
                        app_by_site.setdefault(site, uuid)

out = []
for e in envs_in:
    enriched = dict(e)
    site = e.get("site")
    env_name = e.get("env")
    app_uuid = app_by_site.get(site) if site else None
    if app_uuid:
        enriched["app_uuid"] = app_uuid
        for env in envs_for(app_uuid):
            if env.get("name") == env_name:
                enriched["env_uuid"] = env.get("id", "")
                enriched["default_domain"] = env.get("default_domain", "")
                break
    out.append(enriched)
print(json.dumps(out))
PY
