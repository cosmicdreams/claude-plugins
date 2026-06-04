# Step 1 — Detect Available Tools

Probe the system silently. Do not ask the user anything yet.

```bash
echo "=== CLI tools ==="
for tool in slack jira gh gws rg obsidian trcli; do
  if command -v $tool &>/dev/null; then
    echo "$tool: available ($(command -v $tool))"
  else
    echo "$tool: not found"
  fi
done

echo ""
echo "=== Auth status ==="
gh auth status 2>&1 | head -3 || echo "gh: not authenticated"
jira me 2>&1 | head -2 || echo "jira: not authenticated"
```

Record which tools are present. Build an initial detection map:

| Tool | Present | Authenticated |
|------|---------|---------------|
| slack CLI | ? | n/a (workspace-scoped) |
| jira-cli | ? | ? |
| gh (GitHub) | ? | ? |
| gws (Google Workspace) | ? | n/a |
| obsidian CLI | ? | n/a |
| trcli (TestRail) | ? | n/a |
| rg (ripgrep) | ? | n/a |

Also check for an existing config to merge from:

```bash
[ -f ~/.claude/workshop.json ] && echo "existing workshop.json found" && cat ~/.claude/workshop.json
[ -f ~/.claude/office-pulse.json ] && echo "legacy office-pulse.json found"
```

Proceed to Step 2 with the detection results.
