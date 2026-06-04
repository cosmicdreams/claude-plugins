---
name: brainstorm
description: >
  Interactive brainstorming with a visual decision canvas. Generates divergent ideas, opens
  a local browser UI for annotation, and synthesizes the annotated choices into a concrete
  plan. Use this skill when exploring options before implementing, facing architectural
  decisions, choosing between approaches, or when the right path is not obvious. Say
  "brainstorm", "explore options", "help me decide", or "what are my options". Also handles
  the synthesize phase when you return after annotating. Not for quick questions with an
  obvious answer -- only when genuine divergent thinking adds value.
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

# Skill: brainstorm

Interactive brainstorming with a visual decision canvas. Two phases: **Generate** (produce divergent ideas and open the UI) and **Synthesize** (read annotations and produce a concrete plan).

---

## Phase Detection (always run first)

Before doing anything else, determine which phase to run.

```bash
test -f .brainstorm.json && cat .brainstorm.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','pending'))"
```

- If the file does not exist, or status is `pending` → run **Phase 1: Generate**
- If status is `annotated` → skip directly to **Phase 2: Synthesize**

---

## Phase 1: Generate Ideas

Run this phase when there is no `.brainstorm.json` in the current directory, or its status is not `annotated`.

### Step 1.1 — Extract the topic

From the user's message, identify:

- `topic`: A concise statement of the decision or question being explored (10-15 words max)
- `context`: Any relevant background, constraints, or goals from the conversation (1-3 sentences)

If the user's message is vague, make a reasonable inference rather than interrogating them. The goal is to get to ideas quickly.

### Step 1.2 — Generate 3-5 genuinely divergent ideas

Each idea must be meaningfully different — not variations of the same approach. Span the possibility space:

- One **conservative/proven** approach — the safe, established path
- One **bold/unconventional** approach — something that challenges assumptions
- One **"do less"** or minimal approach — the simplest version that could work
- Optionally: one **hybrid** that blends elements, or one **completely different framing** of the problem

For each idea, produce:

- `id`: Single uppercase letter: A, B, C, D, E
- `title`: 5-8 words, action-oriented (e.g. "Build a thin wrapper around existing CLI")
- `description`: 2-4 sentences explaining the approach concretely — what it is, how it works
- `pros`: Array of 2-4 concrete, honest benefits
- `cons`: Array of 1-3 honest drawbacks (do not omit these)
- `risks`: Array of 1-2 risks or unknowns worth flagging

Quality bar: a reader should understand each idea well enough to rate it without asking follow-up questions.

### Step 1.3 — Write `.brainstorm.json`

Use the Write tool to create `.brainstorm.json` in the current working directory with this exact structure:

```json
{
  "version": "1.0",
  "session": {
    "id": "bs-YYYYMMDD-HHMMSS",
    "topic": "...",
    "context": "...",
    "created": "ISO 8601 timestamp"
  },
  "ideas": [
    {
      "id": "A",
      "title": "...",
      "description": "...",
      "pros": ["...", "..."],
      "cons": ["...", "..."],
      "risks": ["...", "..."]
    }
  ],
  "annotations": {},
  "summary": "",
  "status": "pending"
}
```

Generate a real timestamp for the session ID. Get the current timestamp with:

```bash
date '+%Y%m%d-%H%M%S'
```

The `annotations` field starts as an empty object. The UI will populate it with per-idea ratings. The `summary` field starts as an empty string. The `status` field must be `"pending"`.

### Step 1.4 — Launch the UI

Run the following to start the local UI server:

```bash
BRAINSTORM_VERSION=$(ls ~/.claude/plugins/cache/local/ideate/ 2>/dev/null | sort -V | tail -1)
if [ -z "$BRAINSTORM_VERSION" ]; then
  echo "ERROR: ideate plugin not installed. Run: claude plugin install ideate@local --scope user"
  exit 1
fi
BRAINSTORM_SERVER=~/.claude/plugins/cache/local/ideate/$BRAINSTORM_VERSION/tools/ui/server.js
node "$BRAINSTORM_SERVER" --file "$(pwd)/.brainstorm.json" &
echo "Server PID: $!"
```

The server opens a browser window pointing at the `.brainstorm.json` file. It will update the file in place when the user completes annotation and sets `status` to `annotated`.

### Step 1.5 — Tell the user

Output exactly this message in a visually distinct block, substituting `[N]` with the number of ideas generated and `[topic]` with the session topic:

```
🧠 **Brainstorm canvas is open in your browser.**

I've generated [N] approaches for: *[topic]*

Annotate each idea in the browser:
  • Rate each idea: **Strong** / **Consider** / **Skip**
  • Add notes on what you like or want to change
  • Mark combinations if you want to blend ideas
  • Add overall direction notes at the bottom

When you're done, click **"Complete & Return to Claude"** in the browser,
then come back here and say **"synthesize"**.
```

Stop here. Do not proceed to Phase 2. Wait for the user to return.

---

## Phase 2: Synthesize

Run this phase when `.brainstorm.json` exists and its status is `annotated`.

### Step 2.1 — Read the annotations

```bash
cat .brainstorm.json
```

Extract and hold in context:

- `session.topic` — the original decision question
- `session.context` — the background and constraints
- `ideas[]` — all ideas with their titles and descriptions
- `annotations` — the per-idea objects written by the UI, each containing:
  - `rating`: one of `"strong"`, `"consider"`, or `"skip"`
  - `notes`: free-text note from the user (may be empty)
  - `combineWith`: array of idea IDs the user wants to blend with this one (may be empty)
- `summary` — the user's overall direction note from the bottom of the canvas (may be empty)

### Step 2.2 — Produce the synthesis

Output a structured synthesis document using this format:

```
## Decision: [One clear sentence stating what we're doing]

### Why
[2-3 sentences synthesizing the user's annotations and summary into a rationale.
Cite specific notes the user left where relevant. Be concrete, not generic.]

### What we're taking forward
[For each idea rated "strong" or "consider", one entry:]
**[Idea title]** — [What specific elements we're keeping and why, referencing the
user's notes if present. 1-3 sentences.]

### What we're not doing
[For each idea rated "skip" (if any), one entry:]
**[Idea title]** — [Why this was set aside, in one sentence. Do not editorialize —
reflect what the user indicated or what the rating implies.]

### Next steps
[5-8 concrete, actionable steps. Be specific: include file names, commands,
configuration values, or decisions that need to be made. Order by sequence.
Each step should be completable by one person in one sitting.]
```

If no ideas were rated "skip", omit that section entirely. If `combineWith` entries are present, address the blend explicitly in the "What we're taking forward" section.

If the user left no annotations at all (all fields empty), note this and ask them to return to the browser to complete annotation before synthesizing.

### Step 2.3 — Archive the session

After outputting the synthesis, archive the session file:

```bash
mkdir -p .brainstorm-sessions
SESSION_ID=$(cat .brainstorm.json | python3 -c "import sys,json; print(json.load(sys.stdin)['session']['id'])")
mv .brainstorm.json ".brainstorm-sessions/${SESSION_ID}.json"
echo "Session archived to .brainstorm-sessions/${SESSION_ID}.json"
```

The `.brainstorm.json` file is removed from the working directory. Future invocations of this skill will start a new Phase 1 session.

---

## Design Principles

These principles govern how this skill behaves. An agent implementing this skill must respect them.

**Diverge first, evaluate second.** Ideas are generated without judgment. The rating phase is entirely separate and happens in the browser, not in conversation. Do not pre-filter ideas or suggest that some are better than others during generation.

**User drives convergence.** Claude generates the option space and synthesizes the result — the human makes the calls. The synthesis reflects what the user rated and noted, not Claude's independent preference.

**No rigid Socratic interrogation.** This skill is not superpowers brainstorming. Claude does not question the user's framing, challenge their goals, or withhold idea generation until a problem statement is "good enough." Make reasonable inferences and proceed.

**The UI is the interaction surface.** The browser canvas is where the real thinking happens. Claude's job is to prepare good raw material (divergent ideas with honest tradeoffs) and synthesize the annotated result into a concrete plan. Claude does not mediate the annotation process.

**Keep sessions tidy.** The `.brainstorm.json` file is ephemeral — it represents an in-progress session. Completed sessions live in `.brainstorm-sessions/`. Add `.brainstorm.json` to `.gitignore` if working in a git repository.

---

## Obsidian Storage

After producing output, archive to the Neurons vault for long-term memory.

1. **Determine topic slug**: convert the brainstorm topic to kebab-case
   (e.g. "API authentication options" → `api-authentication-options`)

2. **Determine vault path**: read `obsidian-rules.md` from the workflow plugin references
   (`~/.claude/plugins/cache/local/workshop/*/references/obsidian-rules.md`) to confirm
   correct placement. Default: `Architecture/ADRs/<topic>/<YYYY-MM-DD>-<topic>.md`

3. **Write to vault**:
   ```bash
   VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
   DEST_PATH="Architecture/ADRs/<topic>/<YYYY-MM-DD>-<topic>.md"
   mkdir -p "$VAULT_ROOT/$(dirname "$DEST_PATH")"
   cat > "$VAULT_ROOT/$DEST_PATH" << 'EOF'
   <output-content>
   EOF
   ```

4. **Confirm**: "Saved to Neurons: Architecture/ADRs/<topic>/<YYYY-MM-DD>-<topic>.md"
