# Watch Items

## Adding a watch item mid-session

When the user says "Keep an eye out for [X]", append to the `## Watch Item` section
of today's vault note:

```markdown
### [Topic] — [GA/Announcement/Release]
Current status: [what's known now]
**Watching for:** [specific trigger]
**Why:** [user's reason]
```

The next pulse run will check fetched stories against all active watch items and
flag any hits with `[WATCH HIT]` in the output.
