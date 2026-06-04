# Step 5 — Feedback (propose-then-apply)

This is the loop that makes scout sharpen over time. Only runs when a human answered the feedback
prompt from step 4 (skip on unattended loop runs).

## Parse the marks

Map the user's reply to marks per item / source / topic:
- `useful <n>` / `more-like-this <n>` — positive signal for that item's source and matched topic(s).
- `not <n>` — negative signal for that item's source/topic(s).
- `mute <source>` / `mute <topic>` — strong suppress.

## Log the feedback (always)

Append one line per mark to the vault feedback log (the reviewable source of truth):

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
mkdir -p "$VAULT_ROOT/Meta"
printf '{"ts":"%s","mark":"%s","target":"%s","item":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "<mark>" "<source-or-topic>" "<title>" \
  >> "$VAULT_ROOT/Meta/scout-feedback.jsonl"
```

## Propose weight changes — do NOT auto-apply

Translate the marks into proposed adjustments to `scout.feedback_weights` /
`interests` / `anti_interests`, and **show them for approval** before writing:

```
Proposed tuning from your feedback:
  • simonwillison.net weight 1.0 → 1.3   (you marked 2 items useful)
  • topic "funding rounds" → anti_interests   (you muted it)
  • add interest "evals"   (more-like-this on 2 eval items)
Apply these? (yes / edit / no)
```

- **yes** → write the changes into the `scout` block of `~/.claude/workshop.json`.
- **edit** → adjust per the user's correction, then write.
- **no** → keep only the raw feedback log (step above); change no weights.

Keep adjustments small (e.g. ±0.3 per cycle) so one session can't whipsaw the profile. The raw log
is always kept regardless of the apply decision, so nothing is lost.
