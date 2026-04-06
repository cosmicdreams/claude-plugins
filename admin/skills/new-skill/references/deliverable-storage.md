# Deliverable Storage Pattern

Skills that produce a file deliverable (diagrams, reports, plans, etc.) should use this
pattern to decide where to store the output. Read this reference when implementing storage
for any skill that writes an output file.

---

## The pattern

```bash
# Detect vault
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"

if [ -d "$VAULT_ROOT" ]; then
  # Vault exists — store there
  DEST="$VAULT_ROOT/<SUBFOLDER>/<FILENAME>"
  mkdir -p "$(dirname "$DEST")"
  cp "$OUTPUT_FILE" "$DEST"
  echo "Saved to vault: $DEST"
else
  # No vault — output is already in cwd from the write step
  echo "Saved locally: $OUTPUT_FILE"
  echo "Tip: to route deliverables to your Obsidian vault automatically, run /update-config and set OBSIDIAN_VAULT_NAME."
fi
```

Replace `<SUBFOLDER>` and `<FILENAME>` with the skill's appropriate vault path.

---

## Rules

- **Never fail if vault is absent.** The local file is the primary deliverable. Vault storage
  is a bonus archiving step, not a required output path.
- **Always write locally first** (to cwd or a temp path), then copy to vault. This ensures
  the user has the file even if vault detection fails.
- **`${OBSIDIAN_VAULT_NAME:-Neurons}`** — use this default. If the user has set
  `OBSIDIAN_VAULT_NAME` as an environment variable in settings, it overrides. Otherwise
  the skill tries `~/Vaults/Neurons`.
- **Directory existence is the vault check.** Don't test for the env var — test for the
  directory. A vault that exists but isn't named in env is still usable.
- **Point to `/update-config`** in the fallback message, not to raw settings.json.
  That's the right UX entry point for configuration.

---

## Vault subfolder conventions

| Deliverable type | Vault path |
|---|---|
| Architecture / system diagrams | `Architecture/<topic>/` |
| Decision trees, option comparisons | `Architecture/ADRs/<topic>/` |
| Dependency maps, audit diagrams | `Research/<topic>/` |
| Research reports | `Research/<topic>/` |
| Sprint / retro outputs | `Retrospectives/<date>+<project>/` |
| Skill eval records | `Projects/CLAUDE-PLUGINS/Skill-Evals/<plugin>/<skill>/` |

When in doubt: use `Research/<topic>/` for general-purpose output.

---

## Checklist for deliverable skills

- [ ] Write output to a local path first
- [ ] Use the vault detection pattern above for archiving
- [ ] Include the `/update-config` tip in the fallback message
- [ ] Never hardcode a vault path that assumes vault exists
