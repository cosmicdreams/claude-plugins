# Step 4 — Store and Output

## Append to vault note

For each **kept** entry, append to the note from Step 1:

```markdown
## Update — [Month Day]

### [N]. [Story Title]
[2-4 sentence summary: what it is, why it matters, specific relevance to this stack]
**For [tool/skill/workflow]:** [concrete implication or action item]
Source: [source name and link if available]
```

For **augment** entries: find the existing entry and append a paragraph starting with
`**Update [date]:**` rather than creating a new top-level entry.

For **watch** items that didn't make Keep: append to `## Watch Item` section at the
bottom of the note (create section if absent).

## Output briefing

No more than 10 lines unless there's a watch hit.

```
**Ecosystem Pulse — [HH:MM]**
Sources: Simon Willison, HN, Anthropic news [+ others that returned results]

NET-NEW ([N] stories):
• [Story title] — [one-line why it matters]
• [Story title] — [one-line why it matters]

AUGMENTED:
• Entry #[N]: [what was added]

WATCH HIT: [item] — [what was found]  ← only if applicable

SKIPPED: [N] duplicates, [N] irrelevant
Vault: [N] entries added to Raw/[filename]
```

If nothing new: `✓ Ecosystem Pulse [HH:MM] — no net-new stories. Vault unchanged.`

## Source candidates

If any source candidates were flagged in Step 3, append to the briefing:

```
NEW SOURCES SPOTTED:
• domain.com — [what it covered, why it scored]
• domain.com — [what it covered, why it scored]
```

These are surfaced for review only — sources are not added automatically. The user decides
whether to promote a candidate to the primary source list in `steps/02-fetch.md`.
