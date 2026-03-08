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

**After user response — evaluate with rubric. Then update session:**

```bash
python3 -c "
import json

with open('.reality-check.json') as f:
    state = json.load(f)

gate_record = {
    'gate': 1,
    'name': 'Problem clarity',
    'challenge': 'What specific problem does this solve? State it in one sentence without using the word better.',
    'response': 'USER_RESPONSE',
    'result': 'PASS_OR_KILL',
    'evaluator_note': 'EVALUATOR_NOTE'
}
state['gates'].append(gate_record)

if gate_record['result'] == 'PASS':
    state['current_gate'] = 2
else:
    state['status'] = 'killed'
    state['killed_at'] = 1

with open('.reality-check.json', 'w') as f:
    json.dump(state, f, indent=2)
"
```

If KILL → jump to Phase 3 with KILLED verdict.
If PASS → proceed to Gate 2.

---

### Gate 2 — Problem Reality

**Challenge (verbatim):**
> "Is this problem real and confirmed, or is it assumed? Who has actually experienced it and how do you know?"

**KILL condition:** Problem is hypothetical or based on assumption without named evidence.

**Update session after evaluation:**

```bash
python3 -c "
import json

with open('.reality-check.json') as f:
    state = json.load(f)

gate_record = {
    'gate': 2,
    'name': 'Problem reality',
    'challenge': 'Is this problem real and confirmed, or is it assumed? Who has actually experienced it and how do you know?',
    'response': 'USER_RESPONSE',
    'result': 'PASS_OR_KILL',
    'evaluator_note': 'EVALUATOR_NOTE'
}
state['gates'].append(gate_record)

if gate_record['result'] == 'PASS':
    state['current_gate'] = 3
else:
    state['status'] = 'killed'
    state['killed_at'] = 2

with open('.reality-check.json', 'w') as f:
    json.dump(state, f, indent=2)
"
```

If KILL → Phase 3 with KILLED verdict.
If PASS → proceed to Gate 3.

---

### Gate 3 — Simplicity Test

**Challenge (verbatim):**
> "What is the simplest possible solution to this problem? Is the proposed idea simpler than that, or more complex? If more complex, why is the complexity justified?"

**WARN condition (not KILL):** Proposed solution is substantially more complex than the simplest viable approach without clear justification. Complexity can be legitimate — it must be defended, not assumed.

**Update session after evaluation:**

```bash
python3 -c "
import json

with open('.reality-check.json') as f:
    state = json.load(f)

gate_record = {
    'gate': 3,
    'name': 'Simplicity test',
    'challenge': 'What is the simplest possible solution to this problem? Is the proposed idea simpler than that, or more complex? If more complex, why is the complexity justified?',
    'response': 'USER_RESPONSE',
    'result': 'PASS_OR_WARN',
    'evaluator_note': 'EVALUATOR_NOTE'
}
state['gates'].append(gate_record)
state['current_gate'] = 4

with open('.reality-check.json', 'w') as f:
    json.dump(state, f, indent=2)
"
```

Gate 3 never kills. If WARN, note it for the verdict. Proceed to Gate 4.

---

### Gate 4 — Failure Mode

**Challenge (verbatim):**
> "What is the most likely way this fails in the first 90 days? Walk me through the failure scenario concretely — who does what, what breaks, what the consequence is."

**KILL condition:** User cannot describe a concrete, sequential failure scenario.

**Update session after evaluation:**

```bash
python3 -c "
import json

with open('.reality-check.json') as f:
    state = json.load(f)

gate_record = {
    'gate': 4,
    'name': 'Failure mode',
    'challenge': 'What is the most likely way this fails in the first 90 days? Walk me through the failure scenario concretely — who does what, what breaks, what the consequence is.',
    'response': 'USER_RESPONSE',
    'result': 'PASS_OR_KILL',
    'evaluator_note': 'EVALUATOR_NOTE'
}
state['gates'].append(gate_record)

if gate_record['result'] == 'PASS':
    state['current_gate'] = 5
else:
    state['status'] = 'killed'
    state['killed_at'] = 4

with open('.reality-check.json', 'w') as f:
    json.dump(state, f, indent=2)
"
```

If KILL → Phase 3 with KILLED verdict.
If PASS → proceed to Gate 5.

---

### Gate 5 — Killer Assumption

**Challenge (verbatim):**
> "What single assumption, if wrong, makes this entire idea invalid? Is that assumption testable before you commit significant resources?"

**KILL condition:** Killer assumption is untestable until significant investment is made.

**Update session after evaluation:**

```bash
python3 -c "
import json

with open('.reality-check.json') as f:
    state = json.load(f)

gate_record = {
    'gate': 5,
    'name': 'Killer assumption',
    'challenge': 'What single assumption, if wrong, makes this entire idea invalid? Is that assumption testable before you commit significant resources?',
    'response': 'USER_RESPONSE',
    'result': 'PASS_OR_KILL',
    'evaluator_note': 'EVALUATOR_NOTE'
}
state['gates'].append(gate_record)

if gate_record['result'] == 'PASS':
    state['status'] = 'cleared'
else:
    state['status'] = 'killed'
    state['killed_at'] = 5

with open('.reality-check.json', 'w') as f:
    json.dump(state, f, indent=2)
"
```

---

## Phase 3 — Verdict

**Read the gate records and determine verdict:**

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

---

### CLEARED

All five gates passed (Gate 3 may be PASS or WARN with justification accepted).

Output:
1. One-paragraph summary of the idea's validated strengths
2. **Structured evidence record** — one line per gate:
   - Gate N — [name]: [what was challenged] → [what the user said] → [why it passed]
3. Key risks identified and accepted (from gate responses)
4. Chain offer: *"This idea cleared the funnel. The natural next step is `ideate:plan-improvements` to identify gaps and improvement opportunities in the proposed approach. Run it now?"*

---

### CONDITIONAL

All gates passed but Gate 3 produced a WARN (unjustified complexity).

Output:
1. Summary of what passed
2. The specific complexity concern that was flagged
3. Next action: "Build the simplest version first. Return with evidence that the simpler approach is genuinely insufficient for the stated problem — not just less elegant."

---

### KILLED at Gate N

Output:
1. The gate that killed it — state it plainly
2. The specific objection that was not addressed
3. **Gate-specific recovery prescription:**

| Gate | Recovery |
|------|----------|
| Gate 1 | Restate the problem naming one specific person or role affected and one measurable pain they experience. No abstractions. Return when you can state it in one sentence. |
| Gate 2 | Validate with 5 real instances — users interviewed, cases observed, or data points reviewed. Describe the validation method and what you found. Return with evidence. |
| Gate 3 | *(Gate 3 does not kill — this row exists for reference only)* |
| Gate 4 | Write the failure post-mortem before building anything. Walk through the full sequence: who does what, what breaks, what the consequence is, who is affected. Return when you can narrate it concretely. |
| Gate 5 | Name the killer assumption explicitly. Design the cheapest possible test that would prove or disprove it. What is the one-week experiment? Return with the test result. |

Do not substitute a generic suggestion. Use the prescription for the specific gate that killed the idea.

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
