---
name: ideas-funnel:init
description: >
  One-time bootstrap for the ideas-funnel plugin. Creates the user config
  directory, writes a starter domain YAML if none exist, verifies the vault has
  the required scaffold (Raw/Inbox, Domains/, _meta/, CRITICAL_FACTS.md),
  appends the v2 schema extension to wiki-schema.md if not already present,
  registers the singleton daily pipeline cron via ideas-funnel:schedule, and
  prints a next-steps checklist. Trigger phrases: "init ideas-funnel",
  "bootstrap the funnel", "/ideas-funnel:init".
triggers:
  - init
  - /ideas-funnel:init
  - bootstrap the funnel
  - init ideas-funnel
allowed-tools:
  - Bash
  - Read
  - Write
---

**Used by:** human — one-time at plugin install.

# ideas-funnel:init

Idempotent bootstrap. Safe to run every session; only creates what's missing.

## Step 1 — Verify vault path

```bash
VAULT="${OBSIDIAN_VAULT:-$HOME/Vaults/Neurons}"
test -d "$VAULT" || { echo "Vault not found at $VAULT"; exit 1; }
```

## Step 2 — Create user config directory

```bash
CONFIG_DIR="$HOME/.config/ideas-funnel/domains"
mkdir -p "$CONFIG_DIR"
```

If `$CONFIG_DIR` is empty, copy the starter domain template in:

```bash
if [ -z "$(ls -A "$CONFIG_DIR" 2>/dev/null)" ]; then
  cp "${CLAUDE_PLUGIN_ROOT}/templates/domain.yaml" "$CONFIG_DIR/ai-workflows.yaml"
  echo "Created starter domain config: $CONFIG_DIR/ai-workflows.yaml"
fi
```

## Step 3 — Verify vault scaffold

```bash
mkdir -p "$VAULT/_meta" "$VAULT/Raw/Inbox" "$VAULT/Raw/Assets" \
         "$VAULT/Domains" "$VAULT/Bridges" "$VAULT/Conflicts"

for d in Bridges Conflicts Raw/Assets; do
  [ -f "$VAULT/$d/README.md" ] || echo "# placeholder" > "$VAULT/$d/README.md"
done

[ -f "$VAULT/Raw/.manifest.json" ] || echo '{"version": 1, "entries": {}}' > "$VAULT/Raw/.manifest.json"
```

## Step 4 — CRITICAL_FACTS.md

```bash
if [ ! -f "$VAULT/CRITICAL_FACTS.md" ]; then
  cp "${CLAUDE_PLUGIN_ROOT}/templates/critical-facts.md" "$VAULT/CRITICAL_FACTS.md"
  echo "Created: $VAULT/CRITICAL_FACTS.md — EDIT THIS with operator identity."
fi
```

## Step 5 — Extend wiki-schema.md

```bash
MARKER="<!-- ====== ideas-funnel v2 extension — appended on init ====== -->"
if [ -f "$VAULT/wiki-schema.md" ] && ! grep -q "$MARKER" "$VAULT/wiki-schema.md"; then
  {
    echo ""
    echo "$MARKER"
    echo ""
    cat "${CLAUDE_PLUGIN_ROOT}/templates/wiki-schema-extension.md"
  } >> "$VAULT/wiki-schema.md"
  echo "Appended v2 extension to wiki-schema.md."
fi

if [ ! -f "$VAULT/wiki-schema.md" ]; then
  cp "${CLAUDE_PLUGIN_ROOT}/templates/wiki-schema-extension.md" "$VAULT/wiki-schema.md"
  echo "Created: $VAULT/wiki-schema.md — REVIEW and reconcile with your conventions."
fi
```

## Step 6 — Register the singleton pipeline cron

Invoke `ideas-funnel:schedule`. It is idempotent — if a cron already exists it
reports that and does nothing more.

## Step 7 — Report + next-steps checklist

```
✓ ideas-funnel initialized.

Vault:          $VAULT
Config:         $HOME/.config/ideas-funnel/domains/
Active domains: $(ls $HOME/.config/ideas-funnel/domains/ 2>/dev/null)

Next steps:
  [ ] Edit $VAULT/CRITICAL_FACTS.md with operator identity + timezone.
  [ ] Edit $HOME/.config/ideas-funnel/domains/ai-workflows.yaml — feeds, keywords, bootstrap seeds.
  [ ] Edit $VAULT/Domains/AI-Workflows/_landing.md — write the landscape paragraph.
  [ ] Review the v2 extension block at the bottom of $VAULT/wiki-schema.md.
  [ ] Drop 2–3 bootstrap articles into $VAULT/Raw/Inbox/ai-workflows/.
  [ ] Run /ideas-funnel:ingest manually to test.
```
