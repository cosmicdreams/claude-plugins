# Step 1 — Scan for Violations

Check for each violation type:

**1. Legacy `shared/` prefix**
```bash
find "$VAULT_ROOT/shared" -type f 2>/dev/null | sort
```
Any file under `shared/` is a violation.

**2. Drupal content outside OpenSource/**
```bash
find "$VAULT_ROOT/Drupal.org" -type f 2>/dev/null | sort
```
Should live under `OpenSource/Drupal.org/`.

**3. Files in vault root**
```bash
find "$VAULT_ROOT" -maxdepth 1 -type f -name "*.md" ! -name "perfect.md" | sort
```
Treat as **confirm intent**, not automatic violations. Always ask before proposing to move.
`perfect.md` is permanently exempt — never flag or move it.

**4. Empty folders**
```bash
find "$VAULT_ROOT" -type d -empty | sort
```

Collect all findings and proceed to `steps/02-propose.md`.
