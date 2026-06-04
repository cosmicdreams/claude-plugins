# Managing Sources and Watch Items

All edits here update the `scout` block of `~/.claude/workshop.json`. Confirm each change back to
the user.

## Add a source

"add Ben Thompson to my scout" / "follow stratechery":
- Resolve the feed/page URL (ask if ambiguous), then append to `scout.sources`:
  ```json
  { "type": "feed", "url": "https://stratechery.com/feed/", "name": "Stratechery", "cadence": "3d", "weight": 1.0 }
  ```
- Confirm: "Added Stratechery (feed). Scout now follows N sources."

## Remove or mute a source

- "drop The Batch" → remove that entry from `scout.sources`.
- "mute Hacker News" → keep the source but set its `weight` toward 0 (suppress without losing it),
  or add a `topic:`/source mute via `feedback_weights`.

## Promote a source candidate

When a prior run flagged `[SOURCE CANDIDATE: domain — reason]`, "add it" appends it to
`scout.sources` with a starting `weight` of 1.0.

## Tune interests

- "I care more about evals" → append to `scout.interests`.
- "stop showing me funding news" → append to `scout.anti_interests`.

## Watch items (one-off triggers)

For a specific thing to watch for ("keep an eye out for GA of X"), append to the `## Watch Item`
section of today's vault note:

```markdown
### [Topic] — [GA/Announcement/Release]
Current status: [what's known now]
**Watching for:** [specific trigger]
**Why:** [reason]
```

The next run flags any fetched item that matches an active watch item with `[WATCH HIT]` in the
briefing. Watch items are transient (per the vault note); sources and interests are durable (config).
