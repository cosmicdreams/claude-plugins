# Drover monitors

## Schema

Array of `{ name, description, command }` entries. No `persistent` —
manifest-declared monitors are always persistent.

Auto-arm: session start, skill invocation from this plugin, or `/reload-plugins`.

## Available watchers

### `scripts/monitors/ddev-watch.sh <project-name>`

Tails one DDEV project's `drush watchdog:tail` + `ddev logs -f --service web`,
fingerprints each error line, and emits only on:

- `NEW <fp> <severity> <source> <project> <message>` — first occurrence
- `THRESH <fp> count=50 ...` — occurrence count hits 50 (Drupal watchdog batch)

State persists at `${CLAUDE_PLUGIN_DATA}/ddev-state/<project>.json`.

## Wiring a project

Add one entry per DDEV project you want watched:

```json
[
  {
    "name": "ddev-ahri-main",
    "description": "Watch AHRI-main for Drupal errors",
    "command": "${CLAUDE_PLUGIN_ROOT}/scripts/monitors/ddev-watch.sh AHRI-main"
  },
  {
    "name": "ddev-pncb-main",
    "description": "Watch PNCB-main for Drupal errors",
    "command": "${CLAUDE_PLUGIN_ROOT}/scripts/monitors/ddev-watch.sh PNCB-main"
  }
]
```

`/reload-plugins` picks up the new entries without a session restart.

## Manual test (no manifest)

```sh
./scripts/monitors/ddev-watch.sh <running-ddev-project>
```

Trigger an error inside the site (e.g. visit a broken page, `drush ev`
a bad expression). The monitor emits a line; subsequent identical
errors stay silent until count hits 50.
