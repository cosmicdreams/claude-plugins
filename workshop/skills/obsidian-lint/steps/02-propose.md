# Step 2 — Propose Corrections

For each violation, determine the correct destination using `obsidian-rules.md`.
Check whether the target folder already exists — prefer existing folders.

Present a dry-run report:

```
VIOLATIONS FOUND: N

[vault root — misplaced] loose-note.md
  → Projects/CLAUDE-PLUGINS/loose-note.md

[vault root — confirm intent] random-thoughts.md
  → Raw/random-thoughts.md  (inferred from content — or intentional?)
```

Show count by violation type. Ask:
> "Apply these corrections? (yes / no / edit)"

- **"edit"**: walk through each violation individually
- **"no"**: report violations only, apply nothing
- **"yes"**: proceed to `steps/03-apply.md`
