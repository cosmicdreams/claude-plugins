---
name: brainstorm
description: >
  Diverge on options, open a local browser canvas to annotate them, then synthesize the
  annotated choices into a concrete plan. Also handles the synthesize phase when you
  return from annotating. Not for questions with an obvious answer.
triggers:
  - "brainstorm"
  - "let's brainstorm"
  - "explore options"
  - "help me decide"
  - "what are my options"
  - "synthesize"
  - "I've annotated"
  - "I'm done annotating"
allowed-tools: Bash, Read, Write, Edit
---

# brainstorm

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Interactive brainstorming with a visual decision canvas. Generates divergent ideas, opens a local browser canvas for annotation, and synthesizes the annotated choices into a concrete plan. Use when exploring options before implementing, facing architectural decisions, or when the right path is not obvious. Say "brainstorm", "explore options", "help me decide", or "what are my options". Also handles the synthesize phase when you return after annotating. Not for quick questions with an obvious answer.

Two phases: **Generate** (divergent ideas → browser canvas) and **Synthesize** (annotations → concrete plan). Ideas are generated without judgment; the human rates them in the browser; synthesis reflects their ratings.

If the user says "synthesize" or `.brainstorm.json` exists with `status: "annotated"`, skip to Phase 2.

## Phase 1 — Generate

Extract `topic` (10–15 words) and `context` (constraints, 1–3 sentences) from the conversation. Infer rather than interrogate.

Generate 3–5 genuinely divergent ideas:
- One **conservative/proven** approach
- One **bold/unconventional** approach
- One **"do less"** minimal approach
- Optionally: a **hybrid** or **reframe**

Each idea: `id` (A–E), `title` (5–8 words), `description` (2–4 sentences), `pros` (2–4), `cons` (1–3), `risks` (1–2). Every idea must be rateable without follow-up.

Write `.brainstorm.json`:

```json
{
  "session": { "topic": "...", "context": "..." },
  "ideas": [ { "id": "A", "title": "...", "description": "...",
               "pros": ["..."], "cons": ["..."], "risks": ["..."] } ],
  "annotations": {},
  "summary": "",
  "status": "pending"
}
```

Launch the canvas:

```bash
BRAINSTORM_VERSION=$(ls ~/.claude/plugins/cache/local/ideate/ 2>/dev/null | sort -V | tail -1)
BRAINSTORM_SERVER=~/.claude/plugins/cache/local/ideate/$BRAINSTORM_VERSION/tools/ui/server.js
node "$BRAINSTORM_SERVER" --file "$(pwd)/.brainstorm.json" &
echo "Server PID: $!"
```

Tell the user:

```
🧠 **Brainstorm canvas is open in your browser.**

I've generated [N] approaches for: *[topic]*

Rate each idea (Strong / Consider / Skip), add notes, mark combinations.
Click **"Complete & Return to Claude"** when done, then say **"synthesize"**.
```

Stop and wait.

## Phase 2 — Synthesize

Read `.brainstorm.json`. If `status` is not `annotated`, ask the user to finish in the browser first.

`annotations` entries carry `rating` (`strong` | `consider` | `skip`), `notes`, and `combineWith`. `summary` is the user's overall direction note.

Output:

```
## Decision: [One clear sentence]

### Why
[2-3 sentences citing specific annotation notes.]

### What we're taking forward
**[Idea title]** — [What we keep and why, referencing user notes. 1-3 sentences.]
[One entry per "strong" or "consider" rating. Address combineWith blends explicitly.]

### What we're not doing
**[Idea title]** — [Why set aside, per user indication.]
[Omit section if no "skip" ratings.]

### Next steps
[5-8 concrete ordered steps — file names, commands, decisions. Each completable in one sitting.]
```

Clean up: `rm .brainstorm.json`. Add `.brainstorm.json` to `.gitignore` if not already listed.

## Obsidian storage

Archive to `$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}/Architecture/ADRs/<topic-slug>/<YYYY-MM-DD>-<topic-slug>.md`. Confirm path to user.
