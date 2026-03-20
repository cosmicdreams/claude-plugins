# Step 1 — Detect Available Tools

Probe silently. Do not ask the user anything yet.

```bash
echo "=== Core tools ==="
for tool in ddev git; do
  command -v $tool &>/dev/null && echo "$tool: $(command -v $tool)" || echo "$tool: not found"
done

echo ""
echo "=== Optional tools ==="
for tool in acli drush composer; do
  command -v $tool &>/dev/null && echo "$tool: available" || echo "$tool: not found"
done

echo ""
echo "=== DDEV status ==="
ddev version 2>/dev/null | head -2 || echo "DDEV unavailable"
ddev list 2>/dev/null | head -20 || echo "No DDEV projects running"
```

Also check for an existing config to merge from:

```bash
[ -f ~/.claude/drupal-lab.json ] && echo "existing drupal-lab.json found:" && cat ~/.claude/drupal-lab.json
```

Record tool availability. If `ddev` is not found, warn:
> "DDEV not found. drupal-lab skills require DDEV for running PHP tools. Install from https://ddev.com before proceeding."

Proceed to Step 2 regardless — the config may still be useful for project path mapping.
