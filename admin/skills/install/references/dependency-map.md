# Dependency Map

Complete mapping of every office and research-lab skill dependency to install commands per environment. Organized by skill, then by dependency.

Legend:
- **macOS**: Assumes Homebrew is available
- **Linux sandbox**: Assumes apt, pip, npm are available (typical Cowork/CI VM)
- **Auth**: Post-install authentication command (if any)
- **Env vars**: Environment variables the skill checks for

---

## workshop:deploy-post

No install. Uses the host's Slack connector, signed in through the host's connector settings.

---

## drover:report (access-log trends)

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| clickhouse (optional, about 1 GB) | `brew install --cask clickhouse` | `curl https://clickhouse.com/ \| sh`, then move `./clickhouse` onto `PATH` | — |

Optional and large: ask before installing, including during a bulk install. Only drover's access-log trend reports need it; error reports run without it.

**Env vars (optional):** `DROVER_CLICKHOUSE` (path to the binary), `DROVER_CLICKHOUSE_MAX_MEMORY` (bytes per query).

---

## lib:github

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| gh CLI | `brew install gh` | `apt install gh` (if in apt repos) or download from https://cli.github.com | `gh auth login` |
| git | Pre-installed | Pre-installed | — |

**Linux note:** `gh` may not be in default apt repos. Install via:
```bash
(type -p wget >/dev/null || sudo apt-get install wget -y) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && sudo apt update \
  && sudo apt install gh -y
```

---

## lib:image-optimize

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| ImageMagick (`magick`) | `brew install imagemagick` | `sudo apt install imagemagick -y` | — |
| pngquant | `brew install pngquant` | `sudo apt install pngquant -y` | — |
| cwebp / dwebp | `brew install webp` | `sudo apt install webp -y` | — |
| gif2webp | Included with `webp` | Included with `webp` | — |
| avifenc / avifdec | `brew install libavif` | `sudo apt install libavif-bin -y` (if available) | — |
| jpegtran | `brew install libjpeg` | `sudo apt install libjpeg-turbo-progs -y` | — |
| cjpeg | Included with `libjpeg` | Included with `libjpeg-turbo-progs` | — |

**Linux notes:**
- `libavif-bin` may not be in older Ubuntu repos (needs 22.04+). If unavailable, `avifenc`/`avifdec` are marked unavailable.
- Most tools have apt equivalents. `magick` (ImageMagick) is the universal fallback.

---

## lib:jira

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| twg | `curl -fsSL --retry 2 https://teamwork-graph.atlassian.com/cli/install | bash` | Same script | `twg login` |

Installs to `~/.local/bin/twg`. `twg update` applies required updates.

**Auth:** `twg login` opens a browser for OAuth. In a sandbox without a browser, or for a site outside the OAuth organization, export `TWG_USER`, `TWG_TOKEN` (an Atlassian API token), `TWG_SITE`, and a separate `TWG_CONFIG_DIR`.

---

## lib:log-analyzer

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| acli (Acquia CLI) | `brew install acquia/tools/acli` or `curl https://acquia.github.io/cli/install.sh \| bash` | `curl https://acquia.github.io/cli/install.sh \| bash` | `acli auth:login` |
| python3 | Pre-installed | Pre-installed | — |

**Env vars (optional):**
- `CF_API_TOKEN` — Cloudflare API token for log analysis
- `CF_ZONE_ID` — Cloudflare zone ID

---

## workshop:prioritize (formerly morning-brief)

Slack and Google Calendar come from the host's connectors (no install). Jira uses `twg` (see lib:jira).

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| python3 | Pre-installed | Pre-installed | — |

---

## workshop:personal-calendar

No install. Uses the host's Google Calendar connector, signed in through the host's connector settings.

---

## workshop:personal-email

No install. Uses the host's Gmail connector, signed in through the host's connector settings.

---

## workshop:scout (formerly pulse)


| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| twg | See lib:jira | See lib:jira | `twg login` |
| python3 | Pre-installed | Pre-installed | — |

---

## lib:slack

No install. Uses the host's Slack connector, signed in through the host's connector settings.

---

## lib:testrail

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| curl | Pre-installed | Pre-installed | — |
| 1Password CLI (`op`) | `brew install 1password-cli` | ⊘ Not practical in sandbox | `op signin` |
| macOS Keychain | Built-in | ⊘ Not available | — |

**Auth priority (skill checks in order):**
1. 1Password CLI: `op read "op://Private/TestRail/credential"`
2. macOS Keychain: `security find-generic-password -s "testrail" -w`
3. Env var: `TESTRAIL_API_KEY`

**Linux sandbox workaround:** Use `export TESTRAIL_API_KEY="your-key"`. The skill checks env vars as a fallback automatically.

---

## lib:archive, workshop:obsidian-lint, workshop:organize, lib:vault-store

These skills have **no external tool dependencies** — they only need filesystem access to the Obsidian vault directory. In a Linux sandbox, the vault path must either be mounted or passed explicitly.

| Dependency | macOS | Linux sandbox |
|---|---|---|
| Obsidian vault path | `~/Vaults/Neurons` (default) | Must be mounted or path overridden via `OBSIDIAN_VAULT_NAME` |

---

## research-lab:gather, research-lab:understand, research-lab:synthesize, research-lab:teach

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| `nlm` (NotebookLM MCP CLI) | `uv tool install notebooklm-mcp-cli` | `uv tool install notebooklm-mcp-cli` | Requires Google auth via `nlm login` |
| python3 | Pre-installed | Pre-installed | — |

**Note:** `nlm` ships in the `notebooklm-mcp-cli` package (also provides the `notebooklm-mcp` Model Context Protocol server). Auth is a one-time interactive browser login; cookies last ~2-4 weeks. The predecessor `notebooklm` CLI (package `notebooklm-py`) was archived upstream 2026-06-26 and no longer authenticates — do not install it.

---

## research-lab:experiment

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| git | Pre-installed | Pre-installed | — |
| python3 | Pre-installed | Pre-installed | — |

No external tool installs needed beyond git and Python.

---

## test-lab:perf-measure

| Dependency | macOS | Linux sandbox |
|---|---|---|
| lighthouse CLI | `npm install -g lighthouse` | `npm install -g lighthouse` |
| hyperfine | `brew install hyperfine` | `cargo install hyperfine` (or apt if available) |
| Node.js | Pre-installed | Pre-installed |

---

## drupal-lab:perf-measure

| Dependency | macOS | Linux |
|---|---|---|
| ddev | Pre-installed (drupal-lab prerequisite) | N/A |
| xhprof | Built into DDEV — `ddev xhprof on` | N/A |
| tbkot/ddev-newrelic | `ddev add-on get tbkot/ddev-newrelic` (project-level) | N/A |
| NEWRELIC_LICENSE_KEY | Env var in `.ddev/config.local.yaml` | N/A |
| NEWRELIC_APPNAME | Env var in `.ddev/config.local.yaml` | N/A |

---

## rtk (Rust Token Killer)

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| rtk binary | Download from GitHub releases — not on Homebrew or npm | Same | — |

Check: `command -v rtk` — verify with `rtk --version` and `rtk gain`. Note: name collision risk with `reachingforthejack/rtk` (Rust Type Kit). Correct binary responds to `rtk gain`.

---

## headroom (context compression)

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| headroom | `pip install "headroom-ai[all]"` or `npm install -g headroom-ai` | Same | — |

Check: `command -v headroom`.

---

## Deduplicated install commands

### npm global packages (both environments)
```bash
npm i -g lighthouse
```

### Homebrew (macOS only)
```bash
brew install gh imagemagick pngquant webp libavif libjpeg \
  1password-cli ddev/ddev/ddev \
  acquia/tools/acli hyperfine
```

### apt (Linux sandbox only)
```bash
sudo apt update && sudo apt install -y \
  imagemagick pngquant webp libjpeg-turbo-progs
# gh — see special install instructions above
# libavif-bin — if available on your Ubuntu version
# twg — install script, see lib:jira above
```
