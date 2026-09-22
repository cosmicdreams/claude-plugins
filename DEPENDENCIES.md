# Dependencies

External tools, runtimes, and credentials the plugins use. Not every plugin needs every
tool. Find your plugins in the first table, then install only what they list.

## By plugin

"Optional" means the plugin still works without it: only the named feature is unavailable,
or the plugin falls back to other behavior.

| Plugin | Required | Optional |
|--------|----------|----------|
| admin | [python3](#python3) | [Beads](#bd-beads) (`scaffold`), [jq](#jq) (scaffold detection hook), [headroom](#headroom-and-rtk) |
| design-lab | [python3](#python3), [Figma](#figma) | [node / npm](#node--npm) and [Playwright](#playwright) (`capture`) |
| drover | [python3](#python3), [Acquia credentials](#acli-acquia-command-line-tool) | [node / npm](#node--npm) (web-page reports), [Chrome or Chromium](#chrome-or-chromium) (Portable Document Format reports), [TypeSafe](#typesafe-api-key) |
| drupal-lab | [python3](#python3), [ddev](#ddev), [jq](#jq) | [twg](#twg) (`sprint-start`, `release-cut`, `branch-audit`), [Beads](#bd-beads) (development-environment slot tracking), [Obsidian](#obsidian), [headroom and rtk](#headroom-and-rtk) |
| ideas-funnel | [python3](#python3), [Obsidian](#obsidian) | [Beads](#bd-beads), [TypeSafe](#typesafe-api-key), [headroom](#headroom-and-rtk) |
| ideate | [node / npm](#node--npm) (`brainstorm`), [python3](#python3) (`diagram`) | [Obsidian](#obsidian) (archiving) |
| improve | [node / npm](#node--npm), [lighthouse](#lighthouse), [pa11y](#pa11y), [hyperfine](#hyperfine), [jq](#jq) | [Chrome or Chromium](#chrome-or-chromium), [headroom and rtk](#headroom-and-rtk) |
| lib | Per skill: [gh](#gh-github-command-line-tool), [twg](#twg), [agent-slack](#agent-slack), [ddev](#ddev), [acli](#acli-acquia-command-line-tool), [python3](#python3), [ffmpeg](#ffmpeg), [lighthouse](#lighthouse), [pa11y](#pa11y), [hyperfine](#hyperfine), [jq](#jq), [Bun](#bun-and-image-tools), [TestRail credentials](#testrail-credentials), [Obsidian](#obsidian), [data analysis packages](#data-analysis-python-packages) | [op](#op-1password-command-line-tool), [Cloudflare credentials](#cloudflare-credentials), [image tools](#bun-and-image-tools), [logstream](#acli-acquia-command-line-tool) |
| research-lab | [nlm](#nlm-notebooklm-command-line-tool), [python3](#python3) | [Obsidian](#obsidian), [headroom](#headroom-and-rtk) |
| retro | [Beads](#bd-beads), [jq](#jq), [python3](#python3) | [Obsidian](#obsidian), [headroom](#headroom-and-rtk) |
| sprint | [Beads](#bd-beads), [jq](#jq) | [ddev](#ddev) (Drupal work), [Obsidian](#obsidian) (`project-notes`) |
| test-lab | [python3](#python3), [node / npm](#node--npm), [Playwright](#playwright) | [TestRail credentials](#testrail-credentials) (when TestRail is the source), [TypeSafe](#typesafe-api-key) |
| workshop | [python3](#python3); per integration: [gws](#gws-google-workspace-command-line-tool), [twg](#twg), [agent-slack](#agent-slack), [gh](#gh-github-command-line-tool) | [Obsidian](#obsidian), [TypeSafe](#typesafe-api-key) |

## Quick install

| Tool | Install |
|------|---------|
| [bd (Beads)](#bd-beads) | `brew install beads` |
| [python3](#python3) | built into macOS; `brew install python3` if missing |
| [jq](#jq) | `brew install jq` |
| [node / npm](#node--npm) | `brew install node` |
| [ddev](#ddev) | `brew install ddev/ddev/ddev` (needs Docker) |
| [acli (Acquia)](#acli-acquia-command-line-tool) | see below |
| [gh (GitHub)](#gh-github-command-line-tool) | `brew install gh` |
| [twg](#twg) | `curl -fsSL --retry 2 https://teamwork-graph.atlassian.com/cli/install \| bash` |
| [agent-slack](#agent-slack) | `npm i -g agent-slack` |
| [gws (Google Workspace)](#gws-google-workspace-command-line-tool) | `npm i -g @googleworkspace/cli` |
| [op (1Password)](#op-1password-command-line-tool) | see below |
| [Obsidian](#obsidian) | see below |
| [Figma](#figma) | `claude plugin install figma@claude-plugins-official` |
| [Playwright](#playwright) | `npm i -D playwright && npx playwright install chromium` (per project) |
| [Chrome or Chromium](#chrome-or-chromium) | any desktop install |
| [nlm (NotebookLM)](#nlm-notebooklm-command-line-tool) | `uv tool install notebooklm-mcp-cli` |
| [ffmpeg](#ffmpeg) | `brew install ffmpeg` |
| [lighthouse](#lighthouse) | `npm i -g lighthouse` |
| [pa11y](#pa11y) | `npm i -g pa11y` |
| [hyperfine](#hyperfine) | `brew install hyperfine` |
| [Bun and image tools](#bun-and-image-tools) | `brew install oven-sh/bun/bun` |
| [Data analysis packages](#data-analysis-python-packages) | `pip install pandas matplotlib seaborn` |
| [TestRail credentials](#testrail-credentials) | no package; see below |
| [Cloudflare credentials](#cloudflare-credentials) | no package; see below |
| [TypeSafe](#typesafe-api-key) | no package; `export TYPESAFE_API_KEY=...` |
| [headroom and rtk](#headroom-and-rtk) | `pip install "headroom-ai[all]"` |

---

## bd (Beads)

Kanban and issue-tracking database. Every sprint and retro board operation (`bd list`,
`bd create`, `bd update`, and so on) depends on it.

```bash
brew install beads
```

After installing, initialize the board in your project:

```bash
bd init --prefix sprint
```

Run `bd init` once per project; a second run errors if the board already exists. Use
`bd create --prefix retro` for retro cards on the same database.

**Used by:** sprint, retro; optionally admin (`scaffold`), drupal-lab (`ddev` slot
tracking), ideas-funnel (`supervise`)

---

## python3

Python 3 runtime for plugin scripts. Built into macOS.

```bash
python3 --version   # should be 3.8+
```

If missing or outdated:

```bash
brew install python3
```

**Used by:** admin (`bump-version`, `new-skill`), design-lab (all skills), drover (all
skills), drupal-lab (`browse-drupal-issues`, `module-dev-starter`), ideas-funnel (`ingest`),
ideate (`diagram`), lib (`log-analyzer`, `csv-analysis`), research-lab (notebook scripts),
retro (`transcript`), test-lab (`ingest`), workshop (`sync`, `scout`, `prioritize`)

---

## jq

Processor for structured data on the command line.

```bash
brew install jq
```

**Used by:** drupal-lab (`ddev`), improve (`perf-measure`), lib (several skills), retro
(`kanban`), sprint (`board`); optionally admin (scaffold detection hook)

---

## node / npm

Node.js runtime and package manager. Also needed to install `gws`, `agent-slack`,
`lighthouse`, `pa11y`, and Playwright.

```bash
brew install node
```

Or use [nvm](https://github.com/nvm-sh/nvm) to manage Node versions. Drover's web-page
renderer needs Node 20 or later.

**Used by:** design-lab (`capture`), drover (web-page and Portable Document Format reports),
ideate (`brainstorm` canvas), improve (`accessibility-scan`), test-lab (running generated
suites); indirectly lib and workshop through the tools above

---

## ddev

Docker-based PHP and Drupal development environment. Required for every drupal-lab skill
that runs phpcs, phpstan, phpunit, drush, or composer inside containers. Needs Docker
Desktop or another Docker runtime.

Install through the [official DDEV documentation](https://ddev.readthedocs.io/en/stable/users/install/ddev-installation/):

```bash
brew install ddev/ddev/ddev
```

Drover does not need `ddev` installed; `drover:init` only reads a project's
`.ddev/config.yaml` when one exists.

**Used by:** drupal-lab (all development and validation skills), lib (`ddev`); optionally
sprint (Drupal work)

---

## acli (Acquia command-line tool)

Acquia Cloud Platform command-line tool. Drover calls the Acquia Cloud interface directly
with Python, but reads its credentials from `~/.acquia/cloud_api.conf`, which
`acli auth:login` creates. `lib:log-analyzer` uses `acli` to fetch logs from
Acquia-hosted environments, or `logstream` when that is installed instead.

```bash
curl -OL https://github.com/acquia/cli/releases/latest/download/acli.phar
chmod +x acli.phar
mv acli.phar /usr/local/bin/acli
acli auth:login
```

**Used by:** drover (`acquia-pull`, credentials only), lib (`log-analyzer`)

---

## gh (GitHub command-line tool)

GitHub pull request and issue management.

```bash
brew install gh
gh auth login
```

**Used by:** lib (`github`); optionally workshop (GitHub integration in `config`)

---

## twg

Atlassian's official Teamwork Graph command-line tool: Jira, Confluence, Bitbucket, and
Rovo search. Replaces jira-cli.

```bash
curl -fsSL --retry 2 https://teamwork-graph.atlassian.com/cli/install | bash
twg login
```

`twg login` signs in through the browser and covers every site in your Atlassian
organization. A site owned by another organization needs token sign-in; see
`workshop:config`. Enriched and Rovo commands can spend Rovo credits; plain Jira reads do not.

**Used by:** lib (`jira`), workshop (`prioritize`, `config`), drupal-lab (`sprint-start`,
`release-cut`, `branch-audit`)

---

## agent-slack

Slack command-line tool for reading channels and searching messages. Read-only; it does
not send or post.

```bash
npm i -g agent-slack
agent-slack auth import-desktop   # imports the token from the Slack desktop app
```

Or run `agent-slack auth whoami` to verify an existing session.

**Used by:** lib (`slack`), workshop (`prioritize`, `deploy-post`)

---

## gws (Google Workspace command-line tool)

Gmail and Google Calendar access.

```bash
npm i -g @googleworkspace/cli
gws auth setup
```

Follow the setup prompts to connect a Google account. Requires a Google Cloud project
with the Gmail and Calendar interfaces enabled.

**Used by:** workshop (`personal-email`, `personal-calendar`, `prioritize`)

---

## op (1Password command-line tool)

Used by `lib:testrail` to read the TestRail key from 1Password. Falls back to macOS
Keychain, then the `TESTRAIL_API_KEY` environment variable.

Install through the [1Password desktop app](https://developer.1password.com/docs/cli/get-started/)
→ Settings → Developer → Integrate with 1Password command-line tool.

```bash
op signin
```

**Used by:** lib (`testrail`, optional)

---

## Obsidian

Skills that archive output write into an Obsidian vault. Most write files straight into
the vault folder; `lib:vault-store` and `drupal-lab:issue-summary` also call the
`obsidian` command-line tool.

1. Install the [Obsidian](https://obsidian.md) desktop app and open your vault at least once.
2. In Obsidian, install and enable the **Local REST API** community plugin.
3. Install the command-line tool:

```bash
npm i -g @obsidian-tools/obsidian-cli
obsidian help   # verify
```

**Vault configuration:** skills default to a vault named `Neurons` at `~/Vaults/Neurons`.
Override with the `OBSIDIAN_VAULT_NAME` environment variable.

**Used by:** ideas-funnel (all skills), lib (`archive`, `vault-store`, `vault-search`,
`wiki-query`), workshop (`organize`, `obsidian-lint`); optionally sprint
(`project-notes`), retro (`session`), ideate (archiving), drupal-lab (`analyze-issue`,
`issue-summary`), research-lab (`gather`, `understand`, `synthesize`, `teach`)

---

## Figma

design-lab builds component libraries through Figma's Model Context Protocol server and
its `figma-use` and `figma-generate-library` skills, which must load before any Figma
write.

```bash
claude plugin install figma@claude-plugins-official
```

Sign in to Figma when the plugin first asks. Connecting Figma under claude.ai connector
settings also provides the server, but not the skills.

**Used by:** design-lab (`figma-foundation`, `figma-component`, `figma-index`, `verify`)

---

## Playwright

Browser automation. The plugins ship no browser binary; install Playwright and Chromium
in the project that needs them.

```bash
npm i -D playwright
npx playwright install chromium
```

**Used by:** test-lab (running generated suites); optionally design-lab (`capture`)

---

## Chrome or Chromium

Drover renders Portable Document Format reports with a local Chrome or Chromium. Point
`DROVER_PDF_BROWSER` at the browser binary if it is not found automatically.
`improve:accessibility-scan` drives Chrome through Puppeteer, which can download its own
Chromium.

**Used by:** optionally drover (`report`), improve (`accessibility-scan`)

---

## nlm (NotebookLM command-line tool)

Command-line access to Google NotebookLM, from the `notebooklm-mcp-cli` package.

```bash
uv tool install notebooklm-mcp-cli     # recommended
pipx install notebooklm-mcp-cli        # alternative
nlm login
```

**Used by:** research-lab (`gather`, `understand`, and other notebook-backed work)

---

## ffmpeg

Audio and video processing. Used by `lib:ffmpeg` for compression, format conversion, and
media inspection.

```bash
brew install ffmpeg
```

**Used by:** lib (`ffmpeg`)

---

## lighthouse

Web performance and accessibility auditing tool. Produces structured scores consumed by
`improve` experiments.

```bash
npm i -g lighthouse
```

**Used by:** lib (`lighthouse`), improve (`accessibility-scan`, `perf-measure`)

---

## pa11y

Web Content Accessibility Guidelines audit tool.

```bash
npm i -g pa11y
```

**Used by:** lib (`pa11y`), improve (`accessibility-scan`)

---

## hyperfine

Command-line benchmarking tool. Produces structured timing results for
`improve:perf-measure` experiments.

```bash
brew install hyperfine
```

**Used by:** lib (`hyperfine`), improve (`perf-measure`)

---

## Bun and image tools

`lib:image-optimize` needs Bun 1.3.14 or later; its built-in image support covers resizing,
rotation, metadata stripping, and encoding to the common web formats.

```bash
brew install oven-sh/bun/bun
```

Install the other tools only when a task needs what Bun cannot do:

| Need | Install |
|------|---------|
| Scalable Vector Graphics, favicons, Photoshop files, TIFF | `brew install imagemagick` · `npm i -g svgo` |
| Animated GIF to animated WebP | `brew install webp` |
| Maximum AVIF compression | `brew install libavif` |
| Lossless JPEG optimization | `brew install mozjpeg` |

**Used by:** lib (`image-optimize`)

---

## Data analysis Python packages

```bash
pip install pandas matplotlib seaborn
```

**Used by:** lib (`csv-analysis`)

---

## TestRail credentials

No package. `lib:testrail` needs the TestRail host, user, and key. It reads the key from
1Password ([op](#op-1password-command-line-tool)), then macOS Keychain, then the
`TESTRAIL_API_KEY` environment variable.

**Used by:** lib (`testrail`); optionally test-lab (`ingest`, when TestRail is the source)

---

## Cloudflare credentials

No package. `lib:log-analyzer` adds Cloudflare traffic data when both variables are set:

```bash
export CF_API_TOKEN=...
export CF_ZONE_ID=...
```

**Used by:** lib (`log-analyzer`, optional)

---

## TypeSafe API key

Optional. [TypeSafe](https://docs.typesafe.ai)'s Jev model returns typed judgments (a
choice, a yes-or-no probability, a score) that several skills use as an added layer:
test-case triage, raw-item ranking and duplicate matching, scout relevance, prioritize
action classification, and drover's severity, cause-merging, and ticket-worthiness calls.
Nothing to install; each plugin ships its own Python client (`scripts/jev_client.py`).

```bash
export TYPESAFE_API_KEY=...     # from console.typesafe.ai; put it in ~/.zshrc
export JEV_DISABLED=1           # opt out without removing the key
```

Everything works without the key: every skill falls back to its previous behavior and
records each verdict's source as `fallback` with a reason. Calls cost fractions of a cent
and accept text only.

**Used by:** drover (`report`), ideas-funnel (`ingest`), test-lab (`ingest`), workshop
(`scout`, `prioritize`)

---

## headroom and rtk

Optional output compressors. Skills use them when present and skip them otherwise.

`headroom` compresses large artifacts such as logs, fetched articles, and session
transcripts:

```bash
pip install "headroom-ai[all]"
# or
npm install -g headroom-ai
```

`rtk` shortens verbose command output. Several unrelated projects share the name; install
the "Rust Token Killer" and check with `rtk gain`.

**Used by:** optionally admin, drupal-lab (`ddev`), ideas-funnel (`ingest`), improve
(`lint`), research-lab (`gather`), retro (`session`)
