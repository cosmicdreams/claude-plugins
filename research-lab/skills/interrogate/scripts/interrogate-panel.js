export const meta = {
  name: 'interrogate-panel',
  description: 'Adversarial peer review: four context-isolated lens reviewers vote on a formed claim',
  phases: [{ title: 'Review' }],
}

// args: {
//   claim: string,      the formed position under review
//   evidence: string,   the assembled supporting evidence
//   question: string,   the question the claim answers
//   thorough: boolean,  true = loop-until-dry (two consecutive clean rounds); false/absent = single pass
// }

const LENSES = [
  {
    key: 'evidence-quality',
    charge: 'Is the support strong, sufficient, and actually cited? Attack missing, weak, or miscited evidence.',
    model: 'haiku',
  },
  {
    key: 'alternative-explanation',
    charge: 'Does another hypothesis explain the same evidence as well or better? Construct the strongest rival explanation.',
    model: 'opus',
  },
  {
    key: 'reproducibility',
    charge: 'Would an independent party get the same result from the same data and method? Attack unstated choices the result depends on.',
    model: 'haiku',
  },
  {
    key: 'internal-consistency',
    charge: 'Does the claim contradict itself or its own evidence anywhere? Attack every internal tension.',
    model: 'haiku',
  },
]

const VERDICT = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    refuted: { type: 'boolean' },
    grounds: { type: 'string' },
    severity: { type: 'string', enum: ['fatal', 'major', 'minor', 'none'] },
  },
  required: ['lens', 'refuted', 'grounds', 'severity'],
}

const submission = JSON.stringify({
  claim: args.claim,
  evidence: args.evidence,
  question: args.question,
})

const cleanRoundsNeeded = args.thorough ? 2 : 1
const BUDGET_FLOOR = 40000
let dryRounds = 0
let fatalHit = false
const rounds = []
const errors = []
const coverage = { expectedLenses: LENSES.map((L) => L.key), rounds: [], complete: false }

while (dryRounds < cleanRoundsNeeded && budget.remaining() > BUDGET_FLOOR) {
  const responses = await parallel(LENSES.map((L) => () =>
    agent(
      'You are a hostile peer reviewer using ONLY the ' + L.key + ' lens: ' + L.charge + '\n' +
      'Assume the claim is wrong and build the case against it on EVIDENCE AND FACTS only - ' +
      'unsupported or emotional objections do not count. If you cannot refute it on facts, ' +
      'return refuted: false with severity: none. You see only this submission, nothing else.\n\n' +
      'SUBMISSION:\n' + submission,
      { label: 'review:' + L.key, phase: 'Review', schema: VERDICT, model: L.model }
    )
  ))

  // Validate against the assigned lens, not a self-reported identity. A missing
  // or malformed response is failed coverage, never a vote for the claim.
  const votes = []
  const missingLenses = []
  for (const [index, L] of LENSES.entries()) {
    const vote = responses[index]
    let reason
    if (vote == null) {
      reason = 'missing-response'
    } else if (typeof vote !== 'object' || Array.isArray(vote) ||
      typeof vote.lens !== 'string' || typeof vote.refuted !== 'boolean' ||
      typeof vote.grounds !== 'string' || !VERDICT.properties.severity.enum.includes(vote.severity)) {
      reason = 'invalid-verdict'
    } else if (vote.lens !== L.key) {
      reason = 'lens-mismatch'
    }
    if (reason) {
      missingLenses.push(L.key)
      errors.push({ round: rounds.length + 1, lens: L.key, reason, response: vote ?? null })
    } else {
      votes.push(vote)
    }
  }

  rounds.push(votes)
  coverage.rounds.push({
    validLenses: votes.map((vote) => vote.lens),
    missingLenses,
    complete: missingLenses.length === 0,
  })
  const live = votes.filter((v) => v.refuted && v.severity !== 'none')
  log('round ' + rounds.length + ': ' + live.length + ' live refutation(s) from ' + votes.length + ' votes')

  // Fail closed and stop: retrying a failed panel could hide missing evidence.
  // Even fatal grounds remain evidence only until the whole panel is covered.
  if (missingLenses.length > 0) { break }
  if (live.length === 0) { dryRounds += 1 } else { dryRounds = 0 }
  if (live.some((v) => v.severity === 'fatal')) { fatalHit = true; break }
}

if (rounds.length === 0) {
  errors.push({ round: 0, lens: null, reason: 'budget-before-review' })
}
coverage.complete = rounds.length > 0 && coverage.rounds.every((round) => round.complete)

// Only complete panels can decide: fatal grounds reject; a dry finish survives;
// otherwise the final round's majority decides, with a minority split reported as contested.
const finalRound = rounds.length > 0 ? rounds[rounds.length - 1] : []
const refuting = finalRound.filter((v) => v.refuted && v.severity !== 'none')
let verdict
if (!coverage.complete) {
  verdict = 'incomplete'
} else if (fatalHit) {
  verdict = 'rejected'
} else if (dryRounds >= cleanRoundsNeeded) {
  verdict = 'survived'
} else if (refuting.length * 2 > finalRound.length) {
  verdict = 'rejected'
} else {
  verdict = 'contested'
}

return {
  verdict,
  rounds,
  roundCount: rounds.length,
  ceilingHit: budget.remaining() <= BUDGET_FLOOR,
  errors,
  coverage,
}
