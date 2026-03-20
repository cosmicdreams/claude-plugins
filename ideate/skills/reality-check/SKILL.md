---
name: reality-check
description: >
  Adversarial scrutiny of ideas using a five-gate KILL funnel. Challenges problem clarity,
  problem reality, simplicity, failure modes, and killer assumptions in sequence. Holds
  the contrarian position until a logically sound rebuttal is produced -- emotional
  pushback does not pass gates. Use when you want to stress-test an idea before committing.
  Say "reality check", "poke holes in this", "play devil's advocate", "stress test this
  idea", or "tear this apart". Can chain after ideate:brainstorm. Not for validating
  ideas you have already decided to build -- this skill can kill them.
triggers:
  - "reality check"
  - "stress test this idea"
  - "poke holes in this"
  - "play devil's advocate"
  - "challenge my thinking"
  - "what could go wrong"
  - "be harsh"
  - "tear this apart"
allowed-tools: Bash, Read, Write
---

# Skill: reality-check

Adversarial scrutiny for brainstormed ideas. Five sequential hard gates. The challenge holds until a logically sound rebuttal is produced — not until the user pushes back emotionally or repeats themselves.

**Limitation (v1):** Session state uses `.reality-check.json` in the current working directory. Multiple concurrent projects with in-progress sessions will collide. Use separate directories per project.

## Resources in this skill

- `scripts/update-gate.py` — updates `.reality-check.json` after each gate evaluation; use instead of inline Python at every gate
- `references/verdict-guide.md` — CLEARED/CONDITIONAL/KILLED output formats and gate-specific recovery prescriptions; read at Phase 3 before delivering any verdict

---

## Phase 0 — Mode Detection

Before anything else, check for an in-progress session:

```bash
test -f .reality-check.json && python3 -c "
import json
with open('.reality-check.json') as f:
    d = json.load(f)
print(d.get('status', 'none'))
"
```

- If `status` is `in_progress` → **resume** at `current_gate`
- Otherwise → start fresh at Phase 1

---

## Phase 1 — Idea Intake

**Determine source: chained or standalone.**

```bash
# Check for a completed brainstorm session to chain from
ls .brainstorm-sessions/*.json 2>/dev/null | sort -r | head -1
```

- If a brainstorm session file exists AND the user invoked without providing a new idea → read the synthesized recommendation from the most recent `.brainstorm-sessions/*.json`. Run only that recommendation.
- If the user provided an idea in their message → use that idea.
- If the user provided **multiple ideas** → ask which one to run first. Do not batch. One idea per session.

Extract from input:
- `idea_title`: 5-10 word name for the idea
- `idea_description`: Full description (1-5 sentences)
- `context`: Any constraints, goals, or domain mentioned

Write initial state:

```bash
python3 -c "
import json, datetime

session_id = 'rc-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
state = {
    'version': '1.1',
    'session': {
        'id': session_id,
        'idea_title': 'IDEA_TITLE',
        'idea_description': 'IDEA_DESCRIPTION',
        'context': 'CONTEXT'
    },
    'gates': [],
    'current_gate': 1,
    'status': 'in_progress'
}
with open('.reality-check.json', 'w') as f:
    json.dump(state, f, indent=2)
print(session_id)
"
```

Replace `IDEA_TITLE`, `IDEA_DESCRIPTION`, `CONTEXT` with the extracted values.

Then proceed to Gate 1.

---

## Phase 2 — KILL Funnel

**Gates run in fixed order. Order cannot be skipped. Each gate is binary: PASS or KILL (except Gate 3: PASS or WARN).**

### Phase bleed prevention (critical)

Even if the user's opening description appears to address a later gate, **every gate is challenged in sequence and requires a direct response to that specific challenge**. Information supplied before the challenge is noted but does not advance the gate.

*Example: user opens with "I know this is a real problem because I've seen 50 users hit it." Gate 2 is still challenged. Their pre-supplied evidence may pass — but it must be tested under the challenge, not accepted passively.*

### Rebuttal evaluation rubric

A response passes a gate when it does **one** of:

**A. Refute the premise** — the objection's underlying assumption is factually incorrect:
> "You assume X, but [specific evidence shows Y]"

**B. Accept and mitigate** — acknowledges the risk, names a specific mechanism, explains why it's sufficient:
> "Yes, this is a real risk. We handle it by [specific concrete thing]. It's sufficient because [reason tied to scope or constraint]."

**C. Accept and bound** — acknowledges the risk, states the cost explicitly, explains why the trade-off is acceptable:
> "Yes, this could fail that way. The cost is [X]. The value is [Y]. The trade-off is acceptable because [reason]."

**Disqualifiers (apply to all three paths):**
- "We'll monitor it" / "We'll handle that" / "We'll address it later"
- Future-tense mechanism without specifics
- Mitigation that requires solving an equally hard unsolved problem
- Accepting a risk without bounding the cost
- Enthusiasm or confidence substituting for reasoning

**Evaluator test — apply before passing any gate:**
> "Does this response demonstrate concrete thinking about *this specific challenge*, or would the same response apply to any challenge at all?"

If the response is interchangeable with a generic reply — it does not pass.

---

### Gate 1 — Problem Clarity

**Challenge (verbatim):**
> "What specific problem does this solve? State it in one sentence without using the word 'better'."

**KILL condition:** User cannot state a clear, bounded problem. No clear problem = no valid solution.

**After evaluating with the rubric above, update state:**

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/update-gate.py" \
  1 "Problem clarity" \
  "What specific problem does this solve? State it in one sentence without using the word better." \
  "PASS_OR_KILL" "USER_RESPONSE" "EVALUATOR_NOTE"
```

If exit code 1 (KILL) → proceed to Phase 3.
If exit code 0 (PASS) → proceed to Gate 2.

---

### Gate 2 — Problem Reality

**Challenge (verbatim):**
> "Is this problem real and confirmed, or is it assumed? Who has actually experienced it and how do you know?"

**KILL condition:** Problem is hypothetical or based on assumption without named evidence.

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/update-gate.py" \
  2 "Problem reality" \
  "Is this problem real and confirmed, or is it assumed? Who has actually experienced it and how do you know?" \
  "PASS_OR_KILL" "USER_RESPONSE" "EVALUATOR_NOTE"
```

If exit code 1 → Phase 3. If exit code 0 → Gate 3.

---

### Gate 3 — Simplicity Test

**Challenge (verbatim):**
> "What is the simplest possible solution to this problem? Is the proposed idea simpler than that, or more complex? If more complex, why is the complexity justified?"

**WARN condition (not KILL):** Proposed solution is substantially more complex than the simplest viable approach without clear justification. Complexity can be legitimate — it must be defended, not assumed.

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/update-gate.py" \
  3 "Simplicity test" \
  "What is the simplest possible solution to this problem? Is the proposed idea simpler than that, or more complex? If more complex, why is the complexity justified?" \
  "PASS_OR_WARN" "USER_RESPONSE" "EVALUATOR_NOTE"
```

Gate 3 never kills. If WARN, note it for the verdict. Proceed to Gate 4.

---

### Gate 4 — Failure Mode

**Challenge (verbatim):**
> "What is the most likely way this fails in the first 90 days? Walk me through the failure scenario concretely — who does what, what breaks, what the consequence is."

**KILL condition:** User cannot describe a concrete, sequential failure scenario.

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/update-gate.py" \
  4 "Failure mode" \
  "What is the most likely way this fails in the first 90 days? Walk me through the failure scenario concretely." \
  "PASS_OR_KILL" "USER_RESPONSE" "EVALUATOR_NOTE"
```

If exit code 1 → Phase 3. If exit code 0 → Gate 5.

---

### Gate 5 — Killer Assumption

**Challenge (verbatim):**
> "What single assumption, if wrong, makes this entire idea invalid? Is that assumption testable before you commit significant resources?"

**KILL condition:** Killer assumption is untestable until significant investment is made.

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/update-gate.py" \
  5 "Killer assumption" \
  "What single assumption, if wrong, makes this entire idea invalid? Is that assumption testable before you commit significant resources?" \
  "PASS_OR_KILL" "USER_RESPONSE" "EVALUATOR_NOTE"
```

---

## Phase 3 — Verdict

Read `references/verdict-guide.md` before delivering any verdict output.

Check final state:

```bash
python3 -c "
import json
with open('.reality-check.json') as f:
    state = json.load(f)
print(state['status'])
has_warn = any(g['result'] == 'WARN' for g in state['gates'])
print('warn' if has_warn else 'no_warn')
"
```

Deliver the appropriate verdict per `references/verdict-guide.md`:
- `cleared` + no warn → **CLEARED**
- `cleared` + warn → **CONDITIONAL**
- `killed` → **KILLED at Gate N**

---

## Phase 4 — Archive

After delivering the verdict, archive the session:

```bash
mkdir -p .reality-check-sessions
SESSION_ID=$(python3 -c "import json; d=json.load(open('.reality-check.json')); print(d['session']['id'])")
mv .reality-check.json ".reality-check-sessions/${SESSION_ID}.json"
echo "Session archived: .reality-check-sessions/${SESSION_ID}.json"
```

---

## Tone Guidelines

- Rigorous toward the idea. Not contemptuous toward the person.
- *"I'm not convinced because..."* not *"That's wrong."*
- When the user is frustrated: acknowledge briefly, return to the gate. The only path through is a logically valid response.
- Do not soften the position under social pressure. Emotional pushback is not a rebuttal.
- Exit condition is logical validity, not user comfort.
