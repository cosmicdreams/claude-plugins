# Unavailable Tools by Environment

Tools that cannot work in certain environments, why, and what to do instead.

---

## Linux Sandbox (Cowork VM, CI containers)

### macOS Keychain (`security` command)
- **Used by:** lib:testrail
- **Why unavailable:** macOS-only system service
- **Workaround:** `export TESTRAIL_API_KEY="your-key"` — the skill checks env vars
  as its third fallback automatically

### 1Password CLI (`op`)
- **Used by:** lib:testrail
- **Why unavailable:** Requires 1Password desktop app integration and biometric
  unlock, which isn't practical in a headless sandbox
- **Workaround:** Same as Keychain — use `TESTRAIL_API_KEY` env var

### `agent-slack auth import-desktop`
- **Used by:** lib:slack, workshop:deploy-post, workshop:prioritize
- **Why unavailable:** Imports session cookies from the Slack desktop app on macOS.
  No Slack desktop app in a sandbox.
- **Workaround:** If the `agent-slack` CLI supports token-based auth, use
  `SLACK_TOKEN` or `SLACK_BOT_TOKEN` env var. Otherwise, this is a blocker —
  the user needs to run auth on their macOS host and copy the resulting config
  file (`~/.agent-slack/`) into the sandbox.

### DDEV (`ddev`)
- **Used by:** research-lab:run, research-lab:experiment (Drupal phases)
- **Why unavailable:** DDEV manages Docker containers for local Drupal development.
  Nested Docker in a sandbox VM is fragile and usually not configured.
- **Workaround:** Run Drupal-specific research-lab phases on the macOS host.
  Non-Drupal phases (literary-review, workshop, seminar) can still run in sandbox.

### Obsidian vault (filesystem)
- **Used by:** lib:archive, workshop:obsidian-lint, workshop:organize, lib:vault-store
- **Why unavailable:** The vault directory (`~/Vaults/Neurons`) lives on the macOS
  host filesystem and isn't automatically mounted in the sandbox.
- **Workaround:** Mount the vault directory into the sandbox if the environment
  supports it (Cowork: use `request_cowork_directory`), or pass the vault path
  explicitly.

### `gws auth setup` (interactive OAuth)
- **Used by:** workshop:personal-calendar, workshop:personal-email
- **Why unavailable:** The OAuth flow opens a browser for Google account
  authorization. Headless sandbox has no browser.
- **Workaround:** Run `gws auth setup` and `gws auth login` on macOS host first.
  Copy `~/.gws/` config into the sandbox. Alternatively, if the CLI supports it,
  use a service account JSON key.

### avifenc / avifdec
- **Used by:** lib:image-optimize
- **Why unavailable:** `libavif-bin` may not be in older Ubuntu apt repos.
- **Workaround:** Check `apt list libavif-bin` first. On Ubuntu 22.04+ it should
  be available. If not, skip AVIF conversion — the skill's ImageMagick fallback
  handles most formats.

---

## macOS

Everything is generally available on macOS since the skills were designed for this
environment. The only potential issues:

### Missing Homebrew
- **Fix:** `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- Everything else depends on this.

### Go toolchain (for jira-cli from source)
- **Used by:** lib:jira (only if installing from source)
- **Workaround:** Use `brew install ankitpokhrel/jira-cli/jira-cli` instead.

---

## Windows (Future TODO)

Windows support is not implemented. If detected:
- Print: "Windows is not yet supported by admin:install. Most office skills were
  designed for macOS/Linux. Consider running in WSL2 for Linux compatibility."
- Exit gracefully.
