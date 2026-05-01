---
name: drover:init
description: >
  Discover Drupal/Acquia config in the current project and write
  `.drover/manifest.json`. Looks at drush aliases, composer.json,
  .ddev/config.yaml, and the Acquia Cloud Platform API to resolve the
  application UUID, env IDs, and available log types per env. No prompts
  in the happy path — every value is inferred from disk + API. Trigger
  phrases — "set up drover here", "drover init", "configure drover for
  this project".
allowed-tools: Bash, Read
---

# drover:init

## What it does

Discovers Drupal/Acquia configuration from local breadcrumbs and the
Acquia Cloud Platform API. Writes a `.drover/manifest.json` with:

- App UUID and name
- Every environment's name, env ID, default domain
- Per-env list of available application-error log types
- Hosting profile (`drupal-acquia` — forward-compat for future platforms)
- Schema version + retention window

Once written, `/drover:acquia-pull` and `/drover:report` operate from
that manifest.

## Prerequisites

```bash
test -f ~/.acquia/cloud_api.conf || { echo "Run \`acli auth:login\` first."; exit 1; }
```

## Step 1: Resolve the plugin's init script

```bash
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/ 2>/dev/null | tail -1)
INIT_PY="${PLUGIN_ROOT}scripts/init.py"
test -f "$INIT_PY" || { echo "drover plugin not installed at $INIT_PY"; exit 1; }
```

## Step 2: Run init

```bash
# From the project root
python3 "$INIT_PY"

# Preview what would be written without touching disk
python3 "$INIT_PY" --dry-run

# Re-run after the manifest exists (overwrite)
python3 "$INIT_PY" --force

# Disambiguate when multiple apps match (e.g. "AHRI" vs "AHRI-Prototypes")
python3 "$INIT_PY" --app AHRI
```

## What it looks at

In priority order — any one source is enough to resolve the app:

1. **Drush aliases** — `drush/sites/*.site.yml` (D8+ format). Best
   source: gives `host` (SSH endpoint) and `uri` (site URL) per env,
   which match Acquia env domains directly.
2. **composer.json** — `name` field for the project slug; `acquia/*`
   dependencies as a positive Acquia signal.
3. **`.ddev/config.yaml`** — `name:` field.
4. **`acquia-pipelines.yml`** — presence-only; confirms Acquia project.
5. **git remote** — fallback name source.

## Failure modes (no free-text prompts)

| Condition | Behavior |
|---|---|
| `acli` not authed | Aborts with: *"Run `acli auth:login` then re-run /drover:init."* |
| Credentials present but invalid | Aborts with explicit re-auth instruction. |
| No Drupal/Acquia breadcrumbs | Aborts: *"Drover 2.0 currently only supports Drupal/Acquia."* |
| No Acquia application matched | Aborts; suggests `--app NAME` override. |
| Multiple apps tied at top score | Aborts; lists candidates; requires `--app NAME`. |
| Manifest already exists | Aborts; suggests `--force`. |

The `--app` argument is a case-insensitive substring match — `--app pncb`
matches "Pediatric Nursing Certification Board" if its `name` field
contains "pncb" (it doesn't, in PNCB's case — use the actual app name
substring as visible in `acli api:applications:list`).

## What gets written

```json
{
  "project": "pncb",
  "hosting": "drupal-acquia",
  "drover_schema_version": 1,
  "generated_at": "2026-04-27T18:30:00+00:00",
  "acquia": {
    "app_uuid": "fa5e7770-c451-433d-8dcb-482af08eae21",
    "app_name": "Pediatric Nursing Certification Board",
    "envs": [
      {
        "name": "prod",
        "env_id": "30395-fa5e7770-c451-433d-8dcb-482af08eae21",
        "default_domain": "www.pncb.org",
        "types": ["apache-error", "drupal-watchdog", "php-error"]
      },
      ...
    ]
  },
  "retention_days": 30
}
```

Edit the manifest by hand if you want to narrow types per env, exclude
an env from analysis, or adjust the project slug. The schema is stable
across slice 2.x releases.

## Next steps

```bash
# Pull yesterday's logs for prod
python3 "${PLUGIN_ROOT}scripts/pull.py" --env prod --daily

# 30-day backfill across every env
python3 "${PLUGIN_ROOT}scripts/pull.py" --env all --backfill
```
