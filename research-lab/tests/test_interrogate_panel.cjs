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

async function run(responses, { thorough = false, balances = [100000], mutate, agentError, parallelError } = {}) {
  const args = { claim: 'Original claim', evidence: 'Original evidence', question: 'Original question', thorough }
  const calls = []
  const logs = []
  let round = -1
  let checks = 0
  const result = await panel(args, async tasks => {
    if (parallelError) throw parallelError
    round++
    assert.ok(round < responses.length, 'unexpected retry after supplied rounds')
    return Promise.all(tasks.map(task => task()))
  }, async (prompt, options) => {
    calls.push({ prompt, options })
    if (agentError) throw agentError
    if (mutate) mutate(args)
    return responses[round][lenses.indexOf(options.label.replace('review:', ''))]
  }, { remaining: () => balances[Math.min(checks++, balances.length - 1)] }, message => logs.push(message))
  return { result, calls, logs }
}

for (const [name, votes, diagnostic] of [
  ['all null', [null, null, null, null], /evidence-quality: missing-response/],
  ['three missing', [clean()[0], null, null, null], /alternative-explanation: missing-response/],
  ['wrong lens', clean().map((v, i) => i === 0 ? { ...v, lens: 'unknown' } : v), /evidence-quality: lens-mismatch/],
  ['duplicate lens', clean().map((v, i) => i === 1 ? { ...v, lens: lenses[0] } : v), /alternative-explanation: lens-mismatch/],
  ['missing schema field', clean().map((v, i) => i === 0 ? { lens: v.lens, refuted: false, severity: 'none' } : v), /evidence-quality: invalid-verdict/],
  ['wrong schema type', clean().map((v, i) => i === 0 ? { ...v, refuted: 'false' } : v), /evidence-quality: invalid-verdict/],
  ['invalid severity', clean().map((v, i) => i === 0 ? { ...v, severity: 'unknown' } : v), /evidence-quality: invalid-verdict/],
]) {
  test(name + ' raises an execution error rather than a verdict', async () => {
    await assert.rejects(run([votes]), error => {
      assert.match(error.message, /execution failed.*round 1/i)
      assert.match(error.message, diagnostic)
      return true
    })
  })
}

test('thorough missing round stops rather than counting dry or retrying', async () => {
  await assert.rejects(run([clean(), [null, null, null, null]], { thorough: true }),
    /execution failed.*round 2.*evidence-quality: missing-response/i)
})

test('complete clean panel survives with unchanged model pins and snapshot isolation', async () => {
  const { result, calls } = await run([clean()], { mutate: args => {
    args.claim = 'MUTATED'
    args.evidence = 'MUTATED'
    args.question = 'MUTATED'
  } })
  assert.equal(result.verdict, 'survived')
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

test('valid fatal evidence rejects despite missing peers with diagnostics and retained grounds', async () => {
  const fatal = { ...clean()[0], refuted: true, severity: 'fatal', grounds: 'Contradiction.' }
  const { result, logs } = await run([[fatal, null, null, null]])
  assert.equal(result.verdict, 'rejected')
  assert.deepEqual(result.rounds[0], [fatal])
  for (const lens of lenses.slice(1)) {
    assert.ok(logs.some(message => message.includes(lens + ': missing-response')))
  }
  assert.ok(logs.some(message => /incomplete.*round 1/i.test(message)))
})

test('empty budget raises an execution error without reviewer calls', async () => {
  await assert.rejects(run([], { balances: [40000] }), /execution failed.*budget-before-review/i)
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

test('successful results retain exactly the original public keys and vocabulary', async () => {
  for (const [count, verdict] of [[0, 'survived'], [3, 'rejected'], [1, 'contested']]) {
    const votes = clean().map((v, i) => i < count ? { ...v, refuted: true, severity: 'major' } : v)
    const { result } = await run([votes], { balances: [100000, 40000] })
    assert.equal(result.verdict, verdict)
    assert.deepEqual(Object.keys(result).sort(), ['ceilingHit', 'roundCount', 'rounds', 'verdict'])
  }
})

test('invalid or misattributed fake fatal votes cannot reject', async () => {
  for (const change of [{ lens: 'unknown' }, { refuted: 'true' }, { grounds: null }]) {
    const votes = clean()
    votes[0] = { ...votes[0], refuted: true, severity: 'fatal', ...change }
    votes[0].circular = votes[0]
    await assert.rejects(run([votes]), /execution failed.*evidence-quality: (invalid-verdict|lens-mismatch)/i)
  }
})

test('agent and parallel exceptions propagate without serializing circular errors', async () => {
  for (const source of ['agentError', 'parallelError']) {
    const failure = new Error(source + ' unavailable')
    failure.circular = failure
    await assert.rejects(run([clean()], { [source]: failure }), error => error === failure)
  }
})

test('a nonfatal refutation resets consecutive clean rounds in thorough mode', async () => {
  const disputed = clean()
  disputed[0] = { ...disputed[0], refuted: true, severity: 'minor', grounds: 'Small factual gap.' }
  const { result } = await run([clean(), disputed, clean(), clean()], { thorough: true })
  assert.equal(result.verdict, 'survived')
  assert.equal(result.roundCount, 4)
  assert.deepEqual(result.rounds[1], disputed)
})
