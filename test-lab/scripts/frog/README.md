# Screaming Frog wrapper

Shared by test-lab's SEO and accessibility skills. It runs Screaming Frog SEO Spider headless against the local DDEV site only, and checks the run before any skill reads the exports.

## Local-only, in three layers

1. `../ddev_guard.py` takes the target from `ddev describe -j`. It never accepts a URL argument, and it refuses `--crawl-list` entries on any other host.
2. `localonly.sb` runs Screaming Frog under macOS `sandbox-exec`, so only loopback connections and local sockets work. Other platforms are refused.
3. The saved config must have external crawling off. The wrapper reads Screaming Frog's startup config dump from its log and refuses the run if `mCrawlExternalLinks` isn't `false`, or if any `--require key=value` doesn't match.

## Configs

Configs are built, not committed. A skill keeps a readable JSON spec of dotted field paths. `BuildConfig.java` sets those fields on Screaming Frog's own default config object and serializes it, using the app's bundled Java:

```
frog_crawl.py build-config --spec <skill>/config/seo-local.json --name seo-local
```

Each built file goes to `~/.config/test-lab/screaming-frog/<name>.seospiderconfig` (override the folder with `FROG_CONFIG_DIR`). To list every field and its default:

```
"/Applications/Screaming Frog SEO Spider.app/Contents/jre/bin/java" \
  -cp "/Applications/Screaming Frog SEO Spider.app/Contents/Java/ScreamingFrogSEOSpider.jar:/Applications/Screaming Frog SEO Spider.app/Contents/Java/lib/*" \
  BuildConfig.java --dump
```

Field names come from Screaming Frog's internals. After a Screaming Frog upgrade, rebuild the configs. An unknown field stops the build with exit 2.

## Crawl and compare

```
frog_crawl.py crawl --project <ddev root> --config-name seo-local --output <dir> \
  --export-tabs "Internal:All" --bulk-export "Issues:All" --save-report "Issues Overview:All Issues"
frog_crawl.py compare --previous <db id> --current <db id> --output <dir> \
  --save-report "Issues Diff Overview,Crawl Overview Comparison"
```

The JSON result includes `crawl_db_id`, `sf_version`, `config_path`, `effective_config` and a path for every requested export.

Behaviour tested on Screaming Frog 25.1.0, and what the wrapper does about it:

| Screaming Frog behaviour | Wrapper |
| --- | --- |
| Exits 0 and writes no files when a report name is unknown (for example, normal report names in comparison mode) | Fails |
| Ends "Paused" with exit 0 when only unreachable hosts remain | Accepts only if none of those hosts is the local site |
| Keeps every crawl in its database, so `--save-crawl` only adds a large `.seospider` file | Doesn't pass `--save-crawl` |
| `--skip-empty` would make "no file" ambiguous | Never passes it; a missing file is an error |
| Comparison mode needs its own report names: `Issues Diff Overview`, `Crawl Overview Comparison` | — |
