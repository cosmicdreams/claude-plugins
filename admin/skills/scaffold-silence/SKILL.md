---
name: scaffold-silence
description: Silences the scaffold detection prompt for the current project by setting agentSquad.scaffoldDetect to false in .claude/settings.json, without running the scaffold itself. Use when the user says "silence this prompt", "don't ask about scaffolding", "disable scaffold prompt", "stop asking about scaffold", or dismisses the scaffold detection message. NOT for actually scaffolding a project (use admin:scaffold for that).
triggers:
  - "silence this prompt"
  - "silence scaffold prompt"
  - "don't ask about scaffolding"
  - "disable scaffold prompt"
  - "stop asking about scaffold"
allowed-tools: Bash
---

# Silence Scaffold Prompt

Disable the scaffold detection prompt for the current project by writing a project-level setting.

## Procedure

### 1. Run Script

```bash
TARGET="${ARGUMENTS:-$PWD}"
bash "${CLAUDE_SKILL_DIR}/scaffold-silence.sh" "$TARGET"
```

### 2. Confirm to the user

```
Scaffold prompt silenced for <SILENCE_PROJECT>.
The scaffold warning will no longer appear at session start for this project.
To re-enable: remove "agentSquad.scaffoldDetect" from .claude/settings.json.
To scaffold later: type "scaffold this project".
```
