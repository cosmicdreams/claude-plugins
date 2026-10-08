---
description: Show a finished design-lab run's recap: the Figma file, coverage, accuracy, time, tokens and the developer audit
argument-hint: "[run folder]"
---

Read `benchmark/completion.md` in the run folder given (`$ARGUMENTS`), or with none in the active run (`node "${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts" watch` names it), and reply with its contents exactly. If it does not exist, say the run has not finished its benchmark.
