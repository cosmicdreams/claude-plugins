const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

// Execute the actual Workflow body, changing only its module metadata export.
// These stubs exercise script logic, not Workflow host/tool availability.
const source = fs.readFileSync(path.join(__dirname, '../skills/interrogate/scripts/interrogate-panel.js'), 'utf8')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const panel = new AsyncFunction('args', 'parallel', 'agent', 'budget', 'log',
  source.replace('export const meta =', 'const meta ='))
const lenses = ['evidence-quality', 'alternative-explanation', 'reproducibility', 'internal-consistency']
const clean = () => lenses.map(lens => ({ lens, refuted: false, grounds: 'No factual refutation.', severity: 'none' }))

async function run(responses, { thorough = false, balances = [100000], mutate } = {}) {
  const args = { claim: 'Original claim', evidence: 'Original evidence', question: 'Original question', thorough }
  const calls = []
  let round = -1
  let checks = 0
  const result = await panel(args, async tasks => {
    round++
    assert.ok(round < responses.length, 'unexpected retry after supplied rounds')
    return Promise.all(tasks.map(task => task()))
  }, async (prompt, options) => {
    calls.push({ prompt, options })
    if (mutate) mutate(args)
    return responses[round][lenses.indexOf(options.label.replace('review:', ''))]
  }, { remaining: () => balances[Math.min(checks++, balances.length - 1)] }, () => {})
  return { result, calls }
}

for (const [name, votes] of [
  ['all null', [null, null, null, null]],
  ['three missing', [clean()[0], null, null, null]],
  ['wrong lens', clean().map((v, i) => i === 0 ? { ...v, lens: 'unknown' } : v)],
  ['duplicate lens', clean().map((v, i) => i === 1 ? { ...v, lens: lenses[0] } : v)],
  ['missing schema field', clean().map((v, i) => i === 0 ? { lens: v.lens, refuted: false, severity: 'none' } : v)],
  ['wrong schema type', clean().map((v, i) => i === 0 ? { ...v, refuted: 'false' } : v)],
  ['invalid severity', clean().map((v, i) => i === 0 ? { ...v, severity: 'unknown' } : v)],
]) {
  test(name + ' cannot establish survival', async () => {
    const { result } = await run([votes])
    assert.equal(result.verdict, 'incomplete')
    assert.equal(result.roundCount, 1)
    assert.equal(result.coverage.complete, false)
    assert.ok(result.errors.length > 0)
    assert.ok(result.errors.every(error => error.round === 1 && lenses.includes(error.lens)))
    assert.deepEqual(result.coverage.expectedLenses, lenses)
    assert.deepEqual(result.coverage.rounds[0].missingLenses, result.errors.map(error => error.lens))
    for (const error of result.errors) {
      assert.deepEqual(error.response, votes[lenses.indexOf(error.lens)])
      assert.ok(['missing-response', 'invalid-verdict', 'lens-mismatch'].includes(error.reason))
    }
  })
}

test('thorough missing round stops rather than counting dry or retrying', async () => {
  const { result } = await run([clean(), [null, null, null, null]], { thorough: true })
  assert.equal(result.verdict, 'incomplete')
  assert.equal(result.roundCount, 2)
  assert.equal(result.coverage.rounds[0].complete, true)
  assert.equal(result.coverage.rounds[1].complete, false)
})

test('complete clean panel survives with unchanged model pins and snapshot isolation', async () => {
  const { result, calls } = await run([clean()], { mutate: args => {
    args.claim = 'MUTATED'
    args.evidence = 'MUTATED'
    args.question = 'MUTATED'
  } })
  assert.equal(result.verdict, 'survived')
  assert.equal(result.coverage.complete, true)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(calls.map(call => call.options.model), ['haiku', 'opus', 'haiku', 'haiku'])
  for (const call of calls) {
    assert.deepEqual(JSON.parse(call.prompt.split('SUBMISSION:\n')[1]), {
      claim: 'Original claim', evidence: 'Original evidence', question: 'Original question',
    })
  }
})

test('thorough survival requires two complete clean rounds', async () => {
  const { result } = await run([clean(), clean()], { thorough: true })
  assert.equal(result.verdict, 'survived')
  assert.equal(result.roundCount, 2)
})

test('complete fatal refutation rejects and keeps grounds', async () => {
  const votes = clean()
  votes[0] = { ...votes[0], refuted: true, severity: 'fatal', grounds: 'Source contradicts claim.' }
  const { result } = await run([votes])
  assert.equal(result.verdict, 'rejected')
  assert.equal(result.rounds[0][0].grounds, votes[0].grounds)
})

test('fatal evidence with missing peers remains incomplete and retained', async () => {
  const fatal = { ...clean()[0], refuted: true, severity: 'fatal', grounds: 'Contradiction.' }
  const { result } = await run([[fatal, null, null, null]])
  assert.equal(result.verdict, 'incomplete')
  assert.deepEqual(result.rounds[0], [fatal])
})

test('empty budget reports incomplete without reviewer calls', async () => {
  const { result, calls } = await run([], { balances: [40000] })
  assert.equal(result.verdict, 'incomplete')
  assert.equal(result.roundCount, 0)
  assert.equal(result.ceilingHit, true)
  assert.equal(result.coverage.complete, false)
  assert.ok(result.errors.length > 0)
  assert.equal(calls.length, 0)
})

test('ceiling after one thorough clean round cannot establish survival', async () => {
  const { result } = await run([clean()], { thorough: true, balances: [100000, 40000] })
  assert.equal(result.verdict, 'contested')
  assert.equal(result.ceilingHit, true)
  assert.equal(result.roundCount, 1)
})

test('complete majority and minority results retain their verdicts at ceiling', async () => {
  for (const [count, verdict] of [[3, 'rejected'], [1, 'contested']]) {
    const votes = clean().map((v, i) => i < count ? { ...v, refuted: true, severity: 'major' } : v)
    const { result } = await run([votes], { balances: [100000, 40000] })
    assert.equal(result.verdict, verdict)
  }
})
