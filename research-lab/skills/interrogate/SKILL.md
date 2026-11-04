---
name: interrogate
description: >
  Score one formed claim against its evidence, the research goal and the corpus. Desk-rejects a
  submission with no claim, no evidence or no goal, then sends five context-isolated examiners
  (evidence strength, rival explanations, reproducibility, internal consistency, relevance to
  the goal) to score 0–3 with exact quotes; low scores get one rebuttal pass; a fixed rule
  returns survived, contested, rejected or incomplete. Never revises the claim. Use for
  "interrogate this", "peer-review this claim", "stress-test these findings". Not for an
  unformed idea (ideate:reality-check) or for questioning a whole corpus (research-lab:seminar).
allowed-tools: Bash, Read, Write, Agent
---

# Interrogate

Try to prove a formed claim wrong and report whether it survived. `synthesize` argues a claim is right; `interrogate` scores it from five angles that never see the reasoning that produced it. That isolation is the point: an agent re-reading its own reasoning convinces itself. Do not collapse the examiners into one in-context review.

A deterministic script, `interrogate.py`, writes the examiner briefs, checks every reply, and applies the verdict rule. It makes no model calls; you start the examiners and save their replies.

```bash
I="${CLAUDE_PLUGIN_ROOT}/skills/interrogate/scripts/interrogate.py"
```

---

## Input contract

Assemble one submission file, `submission.json`:

```json
{
  "claim": "The formed position, one or two sentences.",
  "evidence": "The supporting evidence: quotes, results, citations.",
  "goal": "The research goal or decision the claim is meant to inform.",
  "question": "The question the claim answers (optional).",
  "corpus": {"paths": ["/path/to/source/texts"]}
}
```

- `claim`, `evidence` and `goal` are required. Relevance cannot be judged without a goal.
- `corpus.paths` lists local files or directories holding the source text. Examiner quotes are checked against these files and the evidence; nothing else counts as a citation. Examiners name a citation's source by the file's full path, or `evidence` for the evidence field.
- `research-lab:seminar` writes this file for each settled claim; use it as is.

Put the submission and every result in an engagement directory outside the plugin, for example `ENGAGEMENT/interrogate/CLAIM_ID/`.

## Preflight — desk-reject before any examiner runs

```bash
python3 "$I" check submission.json
```

- Exit 2 `no claim` → "No formed claim to interrogate. For an unformed idea use `ideate:reality-check`." Stop.
- Exit 2 `no evidence` → "Claim present but no evidence. Bring the support, or run `research-lab:synthesize` first." Stop.
- No `goal` → stop and ask for the goal. The script rejects a missing goal before starting examiners.

---

## Round 1 — five examiners

```bash
python3 "$I" briefs submission.json --out DIR
```

Writes `DIR/brief-<dimension>.md` for each dimension:

| Dimension | 0 | 3 |
| --- | --- | --- |
| evidence-strength | no source supports it | several independent sources, quoted |
| rival-explanations | a stronger rival in the corpus defeats it | rivals ruled out with corpus evidence |
| reproducibility | cannot be re-derived | re-derived from the cited sources |
| internal-consistency | contradicts itself or its evidence | consistent throughout |
| relevance | does not bear on the goal | decides part of the goal |

The script assigns each examiner its dimension and stamps it on the result; examiners never name their own role. Start five child tasks in one turn, each given one brief verbatim and nothing else: not this conversation, not the reasoning behind the claim. Save each reply, then extract its JSON:

```bash
python3 "$I" extract REPLY.txt > DIR/<dimension>.r1.json     # exit 3: no JSON found
```

A reply with no JSON, an empty reply, or a usage-limit reply is an execution failure. Leave that dimension's file absent rather than inventing one; the verdict will be `incomplete`.

## Round 2 — one rebuttal for low scores

```bash
python3 "$I" rebuttal submission.json --results DIR --out DIR
```

Prints the dimensions that scored 0 or 1 and writes `DIR/brief-<dimension>.r2.md` for each. Start each as a **new** child task, save to `DIR/<dimension>.r2.json`. There is only one rebuttal pass.

## Verdict

```bash
python3 "$I" verdict submission.json --results DIR --out DIR/interrogate.json \
  --md DIR/interrogate.md --calls N
```

`N` is the number of examiner calls you made. For seminar submissions, an `evidence` citation must quote a verified source quotation embedded in the submission, never the moderator's answer prose.

The script validates each result (score 0–3, nonempty reasons, every quote at least 12 characters and found verbatim in its named corpus source or evidence) and applies a fixed rule, first match wins:

1. Any dimension missing or invalid → **incomplete**. Report which and why; no verdict.
2. Evidence strength 0, or any dimension 0 with a stated fatal reason → **rejected**.
3. Every dimension 2 or higher → **survived**.
4. Otherwise → **contested**, with the low dimensions named.

`interrogate.json` holds the verdict, per-dimension scores, reasons, checked citations, rounds, calls, any errors, and `submission_sha256`, a fingerprint binding the result to the exact claim, evidence, goal and corpus paths in the submission it scored. Edit the submission and the fingerprint no longer matches; `seminar` refuses such a result.

---

## Children

- **In T3 Code:** `delegate_task`, one fresh task per brief, never a follow-up into an earlier task. Read `orchestrator_capabilities` once, take model ids and effort options from it, and filter them through the user's model-access and routing rules. Examiners do expert review. Follow each task's returned `next`; do not poll.
- **Elsewhere:** the host's native subagent tool.
- If no child-agent mechanism exists, stop and say so. Do not fall back to an unsupported workflow runner or a raw command-line model call.

## Report to the user

Show `interrogate.md`, then in plain sentences: the verdict, each low dimension with its quoted reason, and any execution errors. An `incomplete` result says nothing about the claim; say what failed. Never rewrite the claim.

## Chaining

- **rejected or contested** → `research-lab:synthesize` to revise the position, then resubmit.
- **survived** → `research-lab:teach` for an outside audience, or `research-lab:experiment` if it implies a measurable hypothesis.
- **incomplete** → fix the failed calls and rerun the missing dimensions.
