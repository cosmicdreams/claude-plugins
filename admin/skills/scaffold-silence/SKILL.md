---
name: scaffold-silence
description: Silences the scaffold prompt for the current project without running the scaffold. Sets agentSquad.scaffoldDetect to false in the project's .claude/settings.json. Use when asked to "silence this prompt", "don't ask about scaffolding", or "disable scaffold prompt for this project".
triggers:
  - "silence this prompt"
  - "silence scaffold prompt"
  - "don't ask about scaffolding"
  - "disable scaffold prompt"
  - "stop asking about scaffold"
allowed-tools: Read, Write, Bash
---

# Silence Scaffold Prompt

Disable the scaffold detection prompt for the current project by writing a project-level setting.

## Procedure

1. Resolve the target project directory — use `$PWD` unless `$ARGUMENTS` specifies a path.

2. Ensure `.claude/` exists in the target directory:
   ```bash
   mkdir -p <target>/.claude
   ```

3. Write `agentSquad.scaffoldDetect: false` into `<target>/.claude/settings.json`, merging safely without overwriting existing keys:
   ```python
   import json, pathlib

   settings_path = pathlib.Path("<target>/.claude/settings.json")
   settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
   settings.setdefault("agentSquad", {})["scaffoldDetect"] = False
   settings_path.write_text(json.dumps(settings, indent=2) + "\n")
   ```

4. Confirm to the user:
   ```
   Scaffold prompt silenced for <project-name>.
   The scaffold warning will no longer appear at session start for this project.
   To re-enable: remove "agentSquad.scaffoldDetect" from .claude/settings.json.
   To scaffold later: type "scaffold this project".
   ```
