---
name: asset-audit
description: Structured usage audit of sprint process assets -- agents, skills, hooks, and protocols. Analyzes session logs to classify each asset as actively-used, rarely-used, never-invoked, or trigger-failure. Use when running a deliberate asset audit, evaluating what to retire or merge, or when the user asks "audit sprint assets", "which skills are unused", "what agents are never spawned", "asset usage report". ON-DEMAND ONLY -- do not invoke as part of standard sprint workflow. Only the process-improvement agent or an explicit user request should trigger this.
allowed-tools: Bash, Read, Grep, Glob, Write
---

# Sprint Asset Audit

**Before proceeding:** Confirm you are the process-improvement agent, or the user has
explicitly requested this audit. If neither is true, stop here.

---

## Scope Modes

This skill has two modes. **Sprint-cycle is the default.**

| Mode | When | Coverage | Speed |
|---|---|---|---|
| **Sprint-cycle** (default) | Sprint start/end, retro | 5 recent sessions, current project | Fast |
| **Full** (`--scope full`) | Periodic deep audit, before purge decisions | All sessions across all plugin-using projects | Slow — run intentionally |

Invoke full scope only when you need accurate cross-project verdicts (e.g., before retiring
an asset, or evaluating the 5-session grace period across all work).

---

## When to Run

- **Sprint start** — establish a usage baseline (sprint-cycle)
- **Sprint end / retro** — compare actual usage against baseline (sprint-cycle)
- **Before a retire decision** — confirm truly never-invoked across all projects (full)
- **User request** — scope specified by user or inferred from context

---

## Step 1: Locate Session Logs

### Sprint-cycle (default)

```bash
# 5 most recent sessions in the current project
PROJ=$(pwd | sed 's|/Users/[^/]*/||; s|/|-|g; s|^|/Users/Chris.Weber/.claude/projects/-Users-Chris-Weber-|')
SESSION_FILES=$(ls -t ~/.claude/projects/-Users-Chris-Weber-$(basename $(pwd))/*.jsonl 2>/dev/null | head -5)
echo "$SESSION_FILES"
```

If the path substitution doesn't resolve, use:
```bash
ls -t ~/.claude/projects/ | head -5   # find your project directory name
SESSION_FILES=$(ls -t ~/.claude/projects/<your-project-dir>/*.jsonl | head -5)
```

### Full scope (`--scope full`)

**Step 1a — Discover all projects with plugin activity:**
```bash
# Find all project dirs that contain any plugin skill invocation
for dir in ~/.claude/projects/*/; do
  if ls "$dir"*.jsonl 2>/dev/null | head -1 | xargs grep -l '"tool_name":"Skill"' 2>/dev/null | grep -q .; then
    echo "$dir"
  fi
done
```

**Step 1b — Collect all JSONL from active plugin projects:**
```bash
PLUGIN_DIRS=($(for dir in ~/.claude/projects/*/; do
  ls "$dir"*.jsonl 2>/dev/null | head -1 | xargs grep -l '"tool_name":"Skill"' 2>/dev/null \
    | grep -q . && echo "$dir"
done))

SESSION_FILES=$(ls -t "${PLUGIN_DIRS[@]/%/}"*.jsonl 2>/dev/null)
echo "Sessions found: $(echo "$SESSION_FILES" | wc -l)"
```

---

## Step 2: Extract Usage Data

These commands work for both modes — pass the `$SESSION_FILES` from Step 1.

```bash
# Skills invoked — ranked by frequency
grep -h '"tool_name":"Skill"' $SESSION_FILES \
  | grep -o '"name":"[^"]*"' | sort | uniq -c | sort -rn

# Agents spawned — ranked by frequency
grep -h '"tool_name":"Task"' $SESSION_FILES \
  | grep -o '"subagent_type":"[^"]*"' | sort | uniq -c | sort -rn

# Hook scripts triggered — ranked by frequency
grep -h '"tool_name":"Bash"' $SESSION_FILES \
  | grep "hooks/" | sort | uniq -c | sort -rn

# Skills read directly instead of invoked (trigger failure signal)
grep -h '"tool_name":"Read"' $SESSION_FILES \
  | grep -o '"file_path":"[^"]*SKILL\.md[^"]*"' | sort | uniq -c | sort -rn
```

The last command is key: skills appearing in Read-but-not-Skill invocations are **trigger
failure candidates** — their descriptions likely don't match the conditions where they're needed.

Cross-reference against known assets:

```bash
ls sprint/agents/ drupal-lab/agents/                    # agents
ls sprint/skills/ drupal-lab/skills/ admin/skills/      # skills
ls sprint/hooks/ drupal-lab/hooks/                      # hooks
ls sprint/protocols/                                    # protocols
```

---

## Step 3: Classify Each Asset

### Sprint-cycle thresholds

| Status | Definition |
|---|---|
| `actively-used` | Invoked in 3+ of the last 5 sessions |
| `used-but-untested` | Invoked but correctness unverified |
| `rarely-used` | Invoked in 1–2 of the last 5 sessions |
| `never-invoked` | No invocations found |
| `trigger-failure` | Read directly but never invoked via Skill tool |
| `unclear` | Insufficient data |

### Full-scope thresholds

| Status | Definition |
|---|---|
| `actively-used` | Invoked in 3+ distinct projects, or 10+ total sessions |
| `used-but-untested` | Invoked but correctness unverified |
| `rarely-used` | Invoked in 1–2 projects, or 2–9 total sessions |
| `never-invoked` | Zero invocations across all plugin-using projects |
| `trigger-failure` | Read directly but never invoked via Skill tool |
| `unclear` | Too few sessions to classify (plugin used in <3 projects total) |

**Note on `trigger-failure`:** A skill in this status is not necessarily a candidate for
retirement — it may be actively useful but poorly described. Treat it as a description
quality problem before considering deprecation.

---

## Step 4: Interrogate Before Deciding

For every `never-invoked`, `rarely-used`, or `trigger-failure` asset:

1. **Why was this created?** Read the asset and any retro cards or analysis reports that
   reference it. The JSONL archives often contain the original conversation — read that
   context. Understand the intent.
2. **Is the need still real?** Does the problem it was solving still exist in the current
   workflow, or has the process moved on?
3. **Is it solved elsewhere?** Is another actively-used asset already covering this ground?
4. **For `trigger-failure` specifically:** What scenario was the agent in when it read the
   skill directly? Does the skill description match that scenario? If not, rewrite the
   description before considering any other action.

Thank the asset for its contribution before deciding whether what it offers should live on
elsewhere or be released.

---

## Step 5: Four-Path Decision

| Path | When | Action |
|---|---|---|
| **Distill** | Idea is sound; value belongs inside something active | Extract the core insight into the active asset; archive the original |
| **Merge** | Significant functional overlap with an active asset | Merge content into the active asset; remove the standalone version |
| **Retire** | Need is genuinely gone; idea no longer serves the process | Create a card in `kanban/retrospective-actions/proposed/` documenting: what it was, why it was created, why retiring now. User approves before deletion. |
| **Defer** | Genuinely unclear; too little data | Add `<!-- audit: defer, revisit after <YYYY-MM-DD> -->` to the asset; reassess in 2 sessions |

**`trigger-failure` assets follow a different path first:**
→ Rewrite the description as a triggering condition ("Use when...") → re-run audit after
next sprint → if still failing to trigger, then apply the four-path decision.

---

## Deprecation Authority

| Path | Authority |
|---|---|
| Distill | Autonomous |
| Merge | Autonomous |
| Defer | Autonomous |
| Description rewrite (trigger-failure) | Autonomous |
| Retire | `proposed/` card — user approves before any deletion |

Nothing is retired without interrogation. Nothing is deleted by this skill directly.

---

## Output

Write findings to `analysis-reports/asset-audit-<YYYY-MM-DD>.md` (append `-full` for full scope):

- Scope and session count
- Summary table: asset name, status, assigned path, rationale
- Trigger-failure list with description rewrite recommendations
- Interrogation notes for each flagged asset
- Autonomous actions taken (Distill, Merge, Defer, description rewrites)
- Cards created in `proposed/` (Retire decisions pending user approval)
