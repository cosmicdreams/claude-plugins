# Step 1 — Scan for Violations

Check for each violation type:

**1. Files in vault root**
```bash
find "$VAULT_ROOT" -maxdepth 1 -type f -name "*.md" \
  ! -name "index.md" \
  ! -name "wiki-schema.md" \
  ! -name "AGENTS.md" \
  | sort
```
```bash
find "$VAULT_ROOT" -maxdepth 1 -type f -name "*.base" | sort
```
Any `.md` file in root that isn't `index.md`, `wiki-schema.md`, or `AGENTS.md` is a violation.
Any `.base` file in root is allowed — not a violation.

**2. Empty folders**
```bash
find "$VAULT_ROOT" -type d -empty | sort
```

Collect all findings and proceed to `steps/02-propose.md`.
