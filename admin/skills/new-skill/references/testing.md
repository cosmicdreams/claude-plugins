# Testing Skills

## The eval loop

`admin:new-skill` bundles its own eval infrastructure in `scripts/`. All scripts use `claude -p` (subscription auth) throughout — no `ANTHROPIC_API_KEY` needed.

Use evals when:
- The skill has objectively verifiable outputs (fixed workflow steps, required output format)
- You want to compare the skill against a baseline (no skill, or previous version)
- You want to optimize the description for triggering accuracy

## Running evals

Scripts run as Python modules from the skill directory:

**IMPORTANT: If the skill is installed as a plugin (the normal case), you MUST pass `--plugin-skill plugin:skill-name`.** Without it, the eval runs in "command mode" — it creates a temp file and can never detect the installed skill, producing 0% recall on all true positives regardless of how good the description is. The optimization loop has the same requirement.

```bash
SKILL_DIR="${CLAUDE_PLUGIN_ROOT}/skills/new-skill"

# Test trigger accuracy (single pass) — skill installed as plugin
cd "$SKILL_DIR"
python3 -m scripts.run_eval \
  --eval-set /path/to/trigger-evals.json \
  --skill-path /path/to/skill \
  --plugin-skill <plugin>:<skill-name> \
  --verbose

# If the skill is NOT yet installed (testing before install), omit --plugin-skill:
python3 -m scripts.run_eval \
  --eval-set /path/to/trigger-evals.json \
  --skill-path /path/to/skill \
  --verbose
```

Eval set format (`trigger-evals.json`):
```json
[
  {"query": "create a skill that formats git commits", "should_trigger": true},
  {"query": "fix the login bug in auth.py", "should_trigger": false}
]
```

## Running the optimization loop

The loop evaluates the current description, asks Claude to propose improvements, and iterates — selecting the best result by held-out test score to avoid overfitting:

```bash
cd "$SKILL_DIR"
python3 -m scripts.run_loop \
  --eval-set /path/to/trigger-evals.json \
  --skill-path /path/to/skill \
  --plugin-skill <plugin>:<skill-name> \
  --model claude-sonnet-4-6 \
  --max-iterations 5 \
  --verbose
```

The loop outputs JSON with `best_description` — apply it to the skill's SKILL.md frontmatter when satisfied.

Optional: save all iteration results for review. Store workspaces at the project root (alongside `kanban/`, `analysis-reports/`) — never inside the plugin source tree:
```bash
python3 -m scripts.run_loop \
  --eval-set /path/to/trigger-evals.json \
  --skill-path /path/to/skill \
  --plugin-skill <plugin>:<skill-name> \
  --model claude-sonnet-4-6 \
  --results-dir ~/Tools/CLAUDE-PLUGINS/skill-eval/<skill-name> \
  --verbose
```

## Smoke testing without evals

For a quick check after installing:

1. Ask Claude: *"When would you use the [skill-name] skill?"* — it quotes the description back, revealing triggering gaps.
2. Say something that should trigger the skill and verify it loads.
3. Say something adjacent that should NOT trigger it and verify it doesn't.
