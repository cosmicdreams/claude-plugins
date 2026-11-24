# Screaming Frog wrapper

Shared by test-lab's SEO and accessibility skills. It runs Screaming Frog SEO Spider headless against the local DDEV site only, and checks each run before any skill reads the exports.

## Configs

A config is a partial JSON file in Screaming Frog's own config schema, which its MCP server documents (`sf_list_config_categories`, `sf_get_config_sub_schema`). `--config` applies it over the defaults. Keys are grouped by category:

```json
{"crawlConfig": {"crawlerMode": "STANDARD", "crawlExternalLinks": false},
 "internalUrlConfig": {"crawlOutsideStartFolder": false}}
```

Each skill commits its own JSON config. Screaming Frog exits 0 even when the config is wrong. An unknown key logs `Ignoring unknown config field`, and the crawl then runs with the default value. A bad enum value logs `Failed to load config`. The wrapper fails on both. It also compares every scalar in the JSON with Screaming Frog's startup config dump in its log, where `crawlExternalLinks` appears as `mCrawlExternalLinks`. A mismatch fails the run. A setting the dump doesn't print is listed in `unverified_settings`.

## Local-only

1. `../ddev_guard.py` takes the target from `ddev describe -j`. It never accepts a URL argument, and it refuses `--crawl-list` entries on any other host.
2. `crawlExternalLinks` must be `false` in the effective config, for every run. Screaming Frog then requests no off-site URL of any kind: links, images, CSS, scripts, redirects and canonicals.
3. Text-only crawls run under `localonly.sb`, a macOS `sandbox-exec` profile that allows only loopback connections and local sockets. Other platforms are refused.
4. JavaScript-rendering crawls (`crawlerMode` `RENDER`) can't run in that sandbox, because Chrome fails to start its own nested sandbox and every page fails to render. Before each rendering crawl, `render_selftest` crawls a local probe page with the caller's exact config. The page loads a script, CSS, image, iframe, link, `fetch()` and a script-made image from a second local host. The test passes only if the page's JavaScript ran and the second host received nothing. Then the real crawl runs outside the sandbox. Any `Failed to render` line in the log fails the run.

Tested on 25.1.0: with `crawlExternalLinks` false, a rendering crawl made 0 off-site requests, and with it true, 8. `inspectAccessibility: true` makes Screaming Frog fetch off-site stylesheets even with external links off, so that config fails the self-test.

## Crawl and compare

```
frog_crawl.py crawl --project <ddev root> --config seo-local.json --output <dir> \
  --export-tabs "Internal:All" --bulk-export "Issues:All" --save-report "Issues Overview:All Issues"
frog_crawl.py compare --previous <db id> --current <db id> --output <dir> \
  --save-report "Issues Diff Overview,Crawl Overview Comparison"
```

The JSON result includes `crawl_db_id`, `crawl_status`, `sf_version`, `config_path`, `effective_config`, `sandboxed`, `render_selftest` and a path for every requested export.

Other Screaming Frog behaviour the wrapper handles:

| Screaming Frog behaviour | Wrapper |
| --- | --- |
| Exits 0 and writes no files when a report name is unknown (for example, normal report names in comparison mode) | Fails |
| Ends "Paused" with exit 0 when only unreachable hosts remain | Accepts only if none of those hosts is the local site |
| Keeps every crawl in its database, so `--save-crawl` only adds a large `.seospider` file | Doesn't pass `--save-crawl` |
| `--skip-empty` would make "no file" ambiguous | Never passes it; a missing file is an error |
| Comparison mode needs its own report names: `Issues Diff Overview`, `Crawl Overview Comparison` | — |
