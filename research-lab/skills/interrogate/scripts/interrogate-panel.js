export const meta = {
  name: 'interrogate-panel',
  description: 'Adversarial peer review: four context-isolated lens reviewers vote on a formed claim',
  phases: [{ title: 'Review' }],
}

// args: {
//   claim: string,      the formed position under review
//   evidence: string,   the assembled supporting evidence
//   question: string,   the question the claim answers
//   thorough: boolean,  true = loop until two consecutive clean rounds, at most MAX_ROUNDS;
//                       false/absent = exactly one round
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
    locator: { type: 'string' },
  },
  required: ['lens', 'refuted', 'grounds', 'severity'],
}

// A major or fatal refutation counts only after a fresh verifier confirms its
// locator. Unverified refutations are dropped and reported, never counted.
const CHECKS = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lens: { type: 'string' },
          confirmed: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['lens', 'confirmed', 'reason'],
      },
    },
  },
  required: ['checks'],
}

const submission = JSON.stringify({
  claim: args.claim,
  evidence: args.evidence,
  question: args.question,
})

const cleanRoundsNeeded = args.thorough ? 2 : 1
const MAX_ROUNDS = args.thorough ? 4 : 1
const BUDGET_FLOOR = 40000
// Only major and fatal refutations count against the claim. Minor ones are
// fixes to make, reported in the votes; they never trigger another round.
const weighty = (v) => v.refuted && (v.severity === 'major' || v.severity === 'fatal')
const hasLocator = (v) => typeof v.locator === 'string' && v.locator.trim() !== ''
let dryRounds = 0
const dropped = []
// Verified major/fatal votes per round, as lens keys.
const confirmedByRound = []
let fatalHit = false
const rounds = []

while (dryRounds < cleanRoundsNeeded && rounds.length < MAX_ROUNDS && budget.remaining() > BUDGET_FLOOR) {
  const responses = await parallel(LENSES.map((L) => () =>
    agent(
      'You are a hostile peer reviewer using ONLY the ' + L.key + ' lens: ' + L.charge + '\n' +
      'Assume the claim is wrong and build the case against it on EVIDENCE AND FACTS only - ' +
      'unsupported or emotional objections do not count. If you cannot refute it on facts, ' +
      'return refuted: false with severity: none. For a major or fatal refutation, set locator to ' +
      'something a fresh checker can verify: the exact passage quoted from the submission, a source ' +
      'path or URL with the quoted passage, or a command with its output. A major or fatal ' +
      'refutation without a checkable locator is dropped. You see only this submission, nothing else.\n\n' +
      'SUBMISSION:\n' + submission,
      { label: 'review:' + L.key, phase: 'Review', schema: VERDICT, model: L.model }
    )
  ))

  // Validate against the assigned lens, not a self-reported identity. A missing
  // or malformed response is failed coverage, never a vote for the claim.
  const votes = []
  const failures = []
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
      failures.push(L.key + ': ' + reason)
    } else {
      votes.push(vote)
    }
  }

  rounds.push(votes)
  const confirmed = new Set()
  const toCheck = []
  for (const v of votes.filter(weighty)) {
    if (hasLocator(v)) {
      toCheck.push(v)
    } else {
      dropped.push({ round: rounds.length, lens: v.lens, reason: 'no-locator' })
    }
  }
  if (toCheck.length > 0) {
    const result = await agent(
      'You verify refutations from a peer review. For each one, check its locator against the ' +
      'submission and, when the locator names an outside source or a command, against that source ' +
      'or command output, read-only. Confirm a refutation only when the located text or output exists ' +
      'and shows what the grounds claim. Anything you could not check is confirmed: false, with the reason. ' +
      'Return one check per refutation, keyed by its lens. You see only this submission and these refutations.\n\n' +
      'SUBMISSION:\n' + submission + '\n\nREFUTATIONS:\n' +
      JSON.stringify(toCheck.map((v) => ({ lens: v.lens, severity: v.severity, grounds: v.grounds, locator: v.locator }))),
      { label: 'verify:round-' + rounds.length, phase: 'Review', schema: CHECKS, model: 'opus' }
    )
    const checks = result && Array.isArray(result.checks) ? result.checks : null
    const problems = []
    for (const v of toCheck) {
      const matches = checks ? checks.filter((c) => c && c.lens === v.lens) : []
      const check = matches[0]
      if (matches.length !== 1 || typeof check.confirmed !== 'boolean' || typeof check.reason !== 'string') {
        problems.push(v.lens + ': invalid-check')
      } else if (check.confirmed) {
        confirmed.add(v.lens)
      } else {
        dropped.push({ round: rounds.length, lens: v.lens, reason: 'unverified: ' + check.reason })
      }
    }
    if (problems.length > 0) {
      throw new Error('Interrogation verification failed in round ' + rounds.length + ': ' + problems.join('; '))
    }
  }
  confirmedByRound.push(confirmed)
  const live = votes.filter((v) => weighty(v) && confirmed.has(v.lens))
  log('round ' + rounds.length + ': ' + live.length + ' live refutation(s) from ' + votes.length + ' votes, ' +
    (votes.filter(weighty).length - live.length) + ' dropped as unverified')

  if (failures.length > 0) {
    log('incomplete coverage in round ' + rounds.length + ': ' + failures.join('; '))
  }
  // A valid fatal refutation is sufficient to reject, even with missing peers.
  // Otherwise only a complete panel can contribute to a substantive verdict.
  if (live.some((v) => v.severity === 'fatal')) { fatalHit = true; break }
  if (failures.length > 0) {
    throw new Error('Interrogation execution failed in round ' + rounds.length + ': ' + failures.join('; '))
  }
  if (live.length === 0) { dryRounds += 1 } else { dryRounds = 0 }
}

if (rounds.length === 0) {
  throw new Error('Interrogation execution failed: budget-before-review (no round ran)')
}

// Valid fatal grounds reject; a complete dry finish survives; otherwise the
// complete final round's majority decides, with a minority split reported as contested.
const finalRound = rounds[rounds.length - 1]
const finalConfirmed = confirmedByRound[confirmedByRound.length - 1]
const refuting = finalRound.filter((v) => weighty(v) && finalConfirmed.has(v.lens))
let verdict
if (fatalHit) {
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
  roundCapHit: verdict !== 'survived' && !fatalHit && rounds.length >= MAX_ROUNDS,
  dropped,
}
