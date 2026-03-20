# Dependency Map

Complete mapping of every office and research-lab skill dependency to install commands
per environment. Organized by skill, then by dependency.

Legend:
- **macOS**: Assumes Homebrew is available
- **Linux sandbox**: Assumes apt, pip, npm are available (typical Cowork/CI VM)
- **Auth**: Post-install authentication command (if any)
- **Env vars**: Environment variables the skill checks for

---

## lib:csv-analysis

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| Python ≥ 3.8 | Pre-installed or `brew install python` | Pre-installed | — |
| pandas ≥ 2.0 | `pip install pandas` | `pip install pandas --break-system-packages` | — |
| matplotlib ≥ 3.7 | `pip install matplotlib` | `pip install matplotlib --break-system-packages` | — |
| seaborn ≥ 0.12 | `pip install seaborn` | `pip install seaborn --break-system-packages` | — |

**Batch install:**
- macOS: `pip install pandas matplotlib seaborn`
- Linux: `pip install pandas matplotlib seaborn --break-system-packages`

---

## workflow:deploy-post

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| Node.js | Pre-installed or `brew install node` | Pre-installed | — |
| agent-slack | `npm i -g agent-slack` | `npm i -g agent-slack` | `agent-slack auth import-desktop` (macOS) or `SLACK_TOKEN` env var (Linux) |

**Auth notes:** `agent-slack auth import-desktop` pulls the session from the Slack
desktop app, which only works on macOS. In a Linux sandbox, the user would need to
set a `SLACK_TOKEN` env var or use `agent-slack auth` with a token directly.

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
- `libavif-bin` may not be in older Ubuntu repos (needs 22.04+). If unavailable,
  `avifenc`/`avifdec` are marked unavailable.
- Most tools have apt equivalents. `magick` (ImageMagick) is the universal fallback.

---

## lib:jira

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| jira-cli | `brew install ankitpokhrel/jira-cli/jira-cli` | Download binary from GitHub releases or `go install github.com/ankitpokhrel/jira-cli/cmd/jira@latest` | `jira init` |

**Linux install (no Go):**
```bash
# Download latest release binary
JIRA_VERSION=$(curl -s https://api.github.com/repos/ankitpokhrel/jira-cli/releases/latest | grep tag_name | cut -d '"' -f4)
curl -sL "https://github.com/ankitpokhrel/jira-cli/releases/download/${JIRA_VERSION}/jira_$(echo ${JIRA_VERSION} | tr -d v)_linux_x86_64.tar.gz" | tar xz
sudo mv jira /usr/local/bin/jira
```

**Auth:** `jira init` requires Jira server URL, email, and API token interactively.

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

## workflow:morning-brief

Same dependencies as `lib:slack` (agent-slack). Also uses Python 3 for timestamp
math (pre-installed in both environments).

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| agent-slack | `npm i -g agent-slack` | `npm i -g agent-slack` | See deploy-post |
| python3 | Pre-installed | Pre-installed | — |

---

## workflow:personal-calendar

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| gws CLI | `npm install -g @googleworkspace/cli` | `npm install -g @googleworkspace/cli` | `gws auth setup` (first time), `gws auth login` (subsequent) |

**Auth notes:** `gws auth setup` creates a Google Cloud project and enables the
Calendar API. This is an interactive OAuth flow that requires a browser. In a
headless Linux sandbox, the user may need to run auth on their host machine first.

---

## workflow:personal-email

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| gws CLI | `npm install -g @googleworkspace/cli` | `npm install -g @googleworkspace/cli` | `gws auth setup` (first time), `gws auth login` (subsequent) |

Same as personal-calendar — the gws CLI handles both Gmail and Calendar APIs.

---

## workflow:pulse

Combines dependencies from jira + slack:

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| jira-cli | See lib:jira | See lib:jira | `jira init` |
| agent-slack | `npm i -g agent-slack` | `npm i -g agent-slack` | See deploy-post |
| python3 | Pre-installed | Pre-installed | — |

---

## lib:slack

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| agent-slack | `npm i -g agent-slack` | `npm i -g agent-slack` | `agent-slack auth import-desktop` (macOS) or token-based (Linux) |

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

**Linux sandbox workaround:** Use `export TESTRAIL_API_KEY="your-key"`. The skill
checks env vars as a fallback automatically.

---

## lib:archive, workflow:obsidian-lint, workflow:organize, lib:vault-store

These skills have **no external tool dependencies** — they only need filesystem access
to the Obsidian vault directory. In a Linux sandbox, the vault path must either be
mounted or passed explicitly.

| Dependency | macOS | Linux sandbox |
|---|---|---|
| Obsidian vault path | `~/Vaults/Neurons` (default) | Must be mounted or path overridden via `OBSIDIAN_VAULT_NAME` |

---

## research-lab:literary-review, research-lab:workshop, research-lab:seminar

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| notebooklm CLI | Custom install (check project scripts) | Custom install (check project scripts) | Requires Google auth |
| python3 | Pre-installed | Pre-installed | — |

**Note:** The notebooklm CLI is a custom/internal tool. Check
`${CLAUDE_PLUGIN_ROOT}/scripts/` for install instructions.

---

## research-lab:experiment

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| git | Pre-installed | Pre-installed | — |
| python3 | Pre-installed | Pre-installed | — |

No external tool installs needed beyond git and Python.

---

## research-lab:run

| Dependency | macOS | Linux sandbox | Auth |
|---|---|---|---|
| ddev | `brew install ddev/ddev/ddev` | ⊘ Not practical in sandbox | — |
| drush | Via DDEV (`ddev drush`) | ⊘ Needs DDEV | — |
| git | Pre-installed | Pre-installed | — |
| python3 | Pre-installed | Pre-installed | — |
| notebooklm CLI | See literary-review | See literary-review | — |
| agent-slack | `npm i -g agent-slack` | `npm i -g agent-slack` | See deploy-post |

**Linux sandbox note:** research-lab:run requires a full Drupal + DDEV environment.
This is a macOS-host workflow. In a sandbox, only the non-Drupal phases can run.

---

## Deduplicated install commands

### npm global packages (both environments)
```bash
npm i -g agent-slack @googleworkspace/cli
```

### pip packages
```bash
# macOS
pip install pandas matplotlib seaborn

# Linux sandbox
pip install pandas matplotlib seaborn --break-system-packages
```

### Homebrew (macOS only)
```bash
brew install gh imagemagick pngquant webp libavif libjpeg \
  ankitpokhrel/jira-cli/jira-cli 1password-cli ddev/ddev/ddev \
  acquia/tools/acli
```

### apt (Linux sandbox only)
```bash
sudo apt update && sudo apt install -y \
  imagemagick pngquant webp libjpeg-turbo-progs
# gh — see special install instructions above
# libavif-bin — if available on your Ubuntu version
# jira-cli — download binary, see above
```
