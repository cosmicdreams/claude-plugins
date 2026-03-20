# Step 3 — Apply Changes

Only run after user confirmation in Step 2.

For each approved change:

```bash
mkdir -p "$VAULT_ROOT/<target-folder>"
mv "$VAULT_ROOT/<current-path>" "$VAULT_ROOT/<target-path>"
```

Then update frontmatter tags using the Edit tool on each moved file.

Report: how many notes were moved and tagged.
