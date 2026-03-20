# Step 2 — Propose Corrections

For each violation, determine the correct destination using `obsidian-rules.md`.
Check whether the target folder already exists — prefer existing folders.

Present a dry-run report:

```
VIOLATIONS FOUND: N

[legacy shared/] shared/Research/topic/file.md
  → Research/topic/file.md

[wrong location] Drupal.org/drupal/3345989-issue.md
  → OpenSource/Drupal.org/drupal/3345989-issue.md

[vault root — confirm intent] my-loose-note.md
  → Research/topic/my-loose-note.md  (inferred from content — or intentional?)
```

Show count by violation type. Ask:
> "Apply these corrections? (yes / no / edit)"

- **"edit"**: walk through each violation individually
- **"no"**: report violations only, apply nothing
- **"yes"**: proceed to `steps/03-apply.md`
