---
name: scaffold-silence
description: Silences the scaffold prompt for the current project without running the scaffold. Sets agentSquad.scaffoldDetect to false in the project's .claude/settings.json. Use when asked to "silence this prompt", "don't ask about scaffolding", or "disable scaffold prompt for this project".
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
