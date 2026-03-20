# admin:install — Full Bootstrap Output

## Step 1: Environment Detection

```json
{
  "os": "linux",
  "env_type": "sandbox",
  "distro": "ubuntu",
  "distro_version": "22.04",
  "has_brew": false,
  "has_apt": true,
  "has_pip": true,
  "has_npm": true,
  "has_git": true,
  "has_go": false,
  "has_python": true,
  "has_node": true,
  "shell": "bash"
}
```

Environment: **Linux sandbox** (Ubuntu 22.04, aarch64)

**Constraints detected:**
- No `sudo` access (container with "no new privileges" flag)
- No outbound network to GitHub API or npm registry (403/blocked)
- apt is present but requires sudo → unusable
- npm is present but registry is blocked → unusable for global installs

## Step 2: Dependency Manifest (Linux sandbox)

Categorized all dependencies by install method:

| Category | Dependencies |
|---|---|
| apt (needs sudo) | imagemagick, pngquant, webp, libjpeg-turbo-progs, libavif-bin |
| pip | pandas, matplotlib, seaborn |
| npm global | agent-slack, @googleworkspace/cli |
| Binary download | gh CLI, jira-cli |
| Pre-installed | python3, node, npm, git, curl, convert (ImageMagick 6) |
| Unavailable in sandbox | 1Password CLI, macOS Keychain, DDEV, Obsidian vault |

## Step 3: Installation Results

### pip packages (csv-analysis)
```
✓ pandas 2.3.3       already installed
✓ matplotlib 3.10.8  already installed
✓ seaborn 0.13.2     already installed
```

### apt packages (image-optimize)
```
✗ pngquant           sudo blocked in this container
✗ webp (cwebp/dwebp) sudo blocked in this container
✗ libjpeg-turbo-progs sudo blocked in this container
✗ libavif-bin        sudo blocked + may not be in repos
✓ convert            pre-installed (ImageMagick 6.9.11-60)
```

### npm global packages
```
✗ agent-slack        npm registry blocked (403)
✗ gws                npm registry blocked (403)
```

### Standalone CLI binaries
```
✗ gh                 GitHub API unreachable (network blocked)
✗ jira-cli           GitHub API unreachable (network blocked)
```

## Summary Table

```
✓ pandas             pip (pre-installed)         ready
✓ matplotlib         pip (pre-installed)         ready
✓ seaborn            pip (pre-installed)         ready
✓ python3            system                      ready
✓ git                system                      ready
✓ curl               system                      ready
✓ convert            system (ImageMagick 6)      ready (partial — no magick v7)
✗ agent-slack        npm i -g agent-slack        BLOCKED — npm registry inaccessible
✗ gws                npm i -g @googleworkspace/cli  BLOCKED — npm registry inaccessible
✗ gh                 binary download             BLOCKED — GitHub API inaccessible
✗ jira-cli           binary download             BLOCKED — GitHub API inaccessible
✗ pngquant           apt install                 BLOCKED — no sudo
✗ cwebp/dwebp        apt install                 BLOCKED — no sudo
✗ jpegtran/cjpeg     apt install                 BLOCKED — no sudo
✗ avifenc/avifdec    apt install                 BLOCKED — no sudo
⊘ 1Password CLI      n/a                         unavailable in sandbox
⊘ macOS Keychain     n/a                         unavailable in sandbox
⊘ DDEV               n/a                         not practical in sandbox
⊘ Obsidian vault     n/a                         not mounted
```

## Tools That Need Authentication

(Would apply if the tools were installable)

```
  agent-slack  →  SLACK_TOKEN env var (import-desktop unavailable in sandbox)
  gh           →  gh auth login
  gws          →  gws auth setup (needs browser — headless workaround: run on host)
  jira         →  jira init (interactive — needs server URL + API token)
  acli         →  acli auth:login
  testrail     →  export TESTRAIL_API_KEY="your-key"
  log-analyzer →  export CF_API_TOKEN="..." CF_ZONE_ID="..."
```

## Unavailable Tools

| Tool | Why | Workaround |
|---|---|---|
| macOS Keychain | macOS-only system service | Use TESTRAIL_API_KEY env var |
| 1Password CLI | Needs desktop app + biometric | Use env vars for secrets |
| agent-slack auth import-desktop | Needs Slack desktop on macOS | Use SLACK_TOKEN env var |
| DDEV | Nested Docker not available | Run Drupal phases on macOS host |
| Obsidian vault | Not mounted in sandbox | Use request_cowork_directory to mount |
| gws auth setup | OAuth needs browser | Run auth on host, copy ~/.gws/ in |

## Bootstrap Complete

```
Environment:      Linux sandbox (Ubuntu 22.04, aarch64, no-sudo, no-network)
Skills ready:     csv-analysis, obsidian-lint (no external deps), archive/organize/vault-store (if vault mounted)
Partially ready:  image-optimize (only convert available, missing pngquant/cwebp/avif/jpeg tools)
Need install+auth: github, slack, deploy-post, morning-brief, pulse, jira, personal-calendar, personal-email, log-analyzer
Unavailable:      testrail (keychain/1password), research-lab:run (DDEV)
```

**Note:** This sandbox has restricted sudo and no outbound network. Most npm/apt/binary installs are blocked. In a less-restricted Cowork VM or CI container, these would succeed. The pip packages were already pre-installed.
