# Step 4 — Store and Output

## Append to the vault note

For each **kept** item, append to today's note (from step 1):

```markdown
## Update — [Month Day]

### [N]. [Story Title]
[2-4 sentences: what it is, why it matters, specific relevance to this stack]
**For [tool/skill/workflow]:** [concrete implication or action item]
Matched: [interest topic / source]  ·  Source: [name + link]
```

For **augment** entries: find the existing entry and append `**Update [date]:**` rather than a new
top-level entry.

## Output briefing — most-relevant-to-you first

Rank kept items by their profile score (highest first). Keep it tight (≤10 lines unless there's a
lot of high-signal material).

```
**Scout — [HH:MM]**
Sources checked: [names that returned results]

NET-NEW (ranked):
1. [Story title] — [one-line why it matters]  ·  matched: [interest/source]
2. [Story title] — [one-line why it matters]  ·  matched: [interest/source]

AUGMENTED:
• Entry #[N]: [what was added]

SOURCE CANDIDATES (review):
• domain.com — [what it covered, why it scored]

SKIPPED: [N] duplicates, [N] off-profile
Vault: [N] entries added to Raw/[filename]

Feedback: reply with item numbers — useful / not / more-like-this / mute <source|topic>
```

If nothing new: `✓ Scout [HH:MM] — no net-new items. Vault unchanged.`

## Hand off to feedback

If the user responds to the feedback prompt, proceed to `steps/05-feedback.md`. If running
unattended on a loop, skip feedback (there's no one to answer) and end here.
