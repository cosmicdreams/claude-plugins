---
description: Show where the design-lab run is, in a pane that stays open until it is done
argument-hint: "[run folder]"
---

Run `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py" watch`, adding `--project "$ARGUMENTS"` when a run folder was given (with none it reads the active run), and reply with its output exactly.
