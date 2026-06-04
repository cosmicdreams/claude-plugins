# Step 1 — Find Loose Notes

Scan the vault for notes that need organizing:

```bash
# Notes sitting in vault root
find "$VAULT_ROOT" -maxdepth 1 -name "*.md" | sort

# Notes with no YAML frontmatter anywhere in vault
grep -rL "^---" "$VAULT_ROOT" --include="*.md" | sort
```

Collect both lists. Read each note to determine appropriate tags and target folder.
Proceed to `steps/02-propose.md`.
