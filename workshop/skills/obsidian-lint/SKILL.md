---
name: obsidian-lint
description: >
  Audits the Obsidian vault against obsidian-rules.md and corrects violations:
  misplaced files, wrong folder structure, legacy shared/ prefixes, and naming
  that doesn't follow conventions. Runs a dry-run by default — shows proposed
  moves before applying anything. Trigger phrases: "lint my vault", "audit the
  vault", "fix vault structure", "check vault paths", "vault has wrong folders",
  "clean up vault structure", "remove shared/ from vault".
---

# workshop:obsidian-lint

Audit and correct vault structure against `obsidian-rules.md`. Filesystem-only —
Obsidian does not need to be running.

## Setup

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
RULES="${CLAUDE_PLUGIN_ROOT}/references/obsidian-rules.md"
cat "$RULES"
```

## Steps

1. **Scan** — find violations by type
   → Read `steps/01-scan.md`

2. **Propose** — determine corrections, show dry-run report
   → Read `steps/02-propose.md`

3. **Apply** — move files and clean up empty dirs (only after confirmation)
   → Read `steps/03-apply.md`
