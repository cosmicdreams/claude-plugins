# Step 3 — Apply Corrections

Only run after user confirmation in Step 2.

For each correction:
```bash
mkdir -p "$VAULT_ROOT/$(dirname "<destination>")"
mv "$VAULT_ROOT/<source>" "$VAULT_ROOT/<destination>"
```

After all moves, remove empty directories:
```bash
find "$VAULT_ROOT" -type d -empty -delete
```

Report:
- Files moved: N
- Violations remaining (skipped by user): N
- Empty folders removed: N
