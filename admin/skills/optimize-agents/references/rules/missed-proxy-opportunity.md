---
id: lint-009
name: missed-proxy-opportunity
tier: watch
applies-to: any
pattern: Bash commands in plugin code that rtk discover identifies as proxiable for token savings
created: 2026-06-10
source: rtk integration — rtk discover mines Claude Code history for verbose commands not routed through the rtk proxy
---

## Problem

Plugin skills and agent definitions invoke Bash commands (git log/diff, test runners, linters, composer, npm, DDEV output) that produce verbose output. When `rtk` is present and a user-level hook is not already rewriting these calls, the output is consumed raw by the model — 60-90% more tokens than necessary.

## Detection

When `rtk` is present, run discovery against plugin code:

```bash
if command -v rtk >/dev/null 2>&1; then
  rtk discover --json 2>/dev/null
fi
```

Flag any command pattern in plugin SKILL.md or agent `.md` files that `rtk discover` identifies as a candidate, AND that is not already prefixed with `rtk` or routed through the hook.

Does NOT apply when:
- The call is inside a top-level Bash block that the user-level hook already rewrites
- `rtk` is not present (detection is skipped entirely when `command -v rtk` fails)

## Fix

For commands inside skill scripts or workflow-spawned agent Bash blocks, prefix with `rtk`:

```bash
# Before
git log --oneline -20
# After
rtk git log --oneline -20
```

For commands that cannot be prefixed (e.g. inside heredocs or complex pipelines), route through `rtk proxy`:

```bash
rtk proxy -- ddev exec composer install 2>&1
```

This is a watch rule because the fix is mechanical but the list of candidate commands changes as rtk's proxy coverage grows. Promote to warn when `rtk discover` consistently identifies the same commands across multiple sessions.
