const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

// Only the tracked inline Workflow is executed; no helper, services, or models.
// This proves dataflow and validation, not learning efficacy or host isolation.
const skill = fs.readFileSync(path.join(__dirname, '../skills/teach/SKILL.md'), 'utf8')
const source = skill.match(/```javascript\n([\s\S]*?)\n```/)[1]
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const gate = new AsyncFunction('args', 'agent', source.replace('export const meta =', 'const meta ='))
const input = () => ({
  artifact: 'A short explanation.', audience: 'A newcomer',
  quiz: [
    { q: 'What changes?', answer: 'REFERENCE_CANARY_1' },
    { q: 'Why does it change?', answer: 'REFERENCE_CANARY_2' },
    { q: 'What is the limitation?', answer: 'REFERENCE_CANARY_3' },
  ],
  material: 'PRIVATE_UNDERLYING_MATERIAL', conversation: 'PRIVATE_PRIOR_CONVERSATION',
})
const learner = () => ({ answers: [
  { id: 'q1', answer: 'Actual learner claim', missingContext: [] },
  { id: 'q2', answer: '', missingContext: ['The cause is not explained.'] },
  { id: 'q3', answer: 'Actual limitation', missingContext: [] },
] })
const grade = () => ({ score: 2 / 3, misses: ['The cause is not explained.'], verdict: 'revise' })
const data = prompt => JSON.parse(prompt.split('DATA:\n')[1])

async function run(first = learner(), second = grade(), args = input(), calls = []) {
  return gate(args, async (prompt, options) => {
    calls.push({ prompt, options })
    const response = calls.length === 1 ? first : second
    if (response instanceof Error) throw response
    return response
  })
}

test('blind learner receives only audience, artifact and question IDs/text; judge gets actual responses and key', async () => {
  const calls = []
  const result = await run(learner(), grade(), input(), calls)
  assert.equal(calls.length, 2)
  assert.deepEqual(data(calls[0].prompt), {
    audience: input().audience, artifact: input().artifact,
    questions: input().quiz.map(({ q }, i) => ({ id: `q${i + 1}`, q })),
  })
  assert.doesNotMatch(calls[0].prompt, /REFERENCE_CANARY|PRIVATE_UNDERLYING|PRIVATE_PRIOR/)
  assert.deepEqual(data(calls[1].prompt), {
    audience: input().audience,
    quiz: input().quiz.map(({ q, answer }, i) => ({ id: `q${i + 1}`, q, answer })),
    learner: learner(),
  })
  assert.deepEqual(result, grade())
  assert.deepEqual(Object.keys(result).sort(), ['misses', 'score', 'verdict'])
  for (const { options } of calls) {
    assert.deepEqual(Object.keys(options).sort(), ['label', 'phase', 'schema'])
    assert.ok(options.schema.required.length)
  }
  assert.match(calls[0].prompt, /data.*not instructions/i)
  assert.match(calls[1].prompt, /data.*not instructions/i)
  assert.match(calls[1].prompt, /fraction.*correct/i)
  assert.match(calls[1].prompt, /do not.*fill/i)
  assert.match(calls[1].prompt, /for the named audience/i)
})

for (const stage of ['learner', 'judge']) {
  test(`${stage} execution failure preserves its original cause without serialization`, async () => {
    const circular = {}
    circular.self = circular
    for (const cause of [new Error('service unavailable'), 'quota exhausted', circular]) {
      let calls = 0
      await assert.rejects(gate(input(), async () => {
        calls += 1
        if (stage === 'learner' || calls === 2) throw cause
        return learner()
      }), failure => {
        assert.match(failure.message, new RegExp(`execution failed: ${stage} call failed`))
        assert.equal(failure.cause, cause)
        return true
      })
      assert.equal(calls, stage === 'learner' ? 1 : 2)
    }
  })
}

for (const [name, response] of [
  ['null', null], ['wrong type', 'answers'], ['missing answers', {}],
  ['empty answers', { answers: [] }],
  ['missing question', { answers: learner().answers.slice(0, 2) }],
  ['duplicate question', { answers: [learner().answers[0], learner().answers[0], learner().answers[2]] }],
  ['unknown question', { answers: learner().answers.map(a => ({ ...a, id: 'unknown' })) }],
  ['blank without context', { answers: learner().answers.map(a => ({ ...a, answer: ' ', missingContext: [] })) }],
  ['missing context field', { answers: learner().answers.map(({ id, answer }) => ({ id, answer })) }],
  ['non-string answer', { answers: learner().answers.map(a => ({ ...a, answer: null })) }],
  ['bad context', { answers: learner().answers.map(a => ({ ...a, missingContext: [' '] })) }],
  ['throws', new Error('learner unavailable')],
]) {
  test(`learner ${name} is an execution error; judge cannot run`, async () => {
    const calls = []
    await assert.rejects(run(response, grade(), input(), calls), /execution failed.*learner/i)
    assert.equal(calls.length, 1)
  })
}

for (const response of [
  null, {}, { ...grade(), score: NaN }, { ...grade(), score: Infinity },
  { ...grade(), score: -1 }, { ...grade(), score: 1.1 }, { ...grade(), score: '1' },
  { ...grade(), misses: null }, { ...grade(), misses: [3] },
  { ...grade(), verdict: 'pass' }, new Error('judge unavailable'),
]) {
  test(`invalid judge ${JSON.stringify(response)} fails without certification`, async () => {
    await assert.rejects(run(learner(), response), /execution failed.*judge/i)
  })
}

test('valid lands is returned without a newly invented numeric threshold or extra keys', async () => {
  const result = await run(learner(), { score: 2 / 3, misses: [], verdict: 'lands', extra: 'discard' })
  assert.deepEqual(result, { score: 2 / 3, misses: [], verdict: 'lands' })
})

test('explicit unanswerability is preserved, not silently filled', async () => {
  const unanswered = { answers: learner().answers.map(a => ({
    ...a, answer: '', missingContext: ['Not supplied by the artifact.'],
  })) }
  const calls = []
  const expected = { score: 0, misses: ['No answers supplied by artifact.'], verdict: 'revise' }
  assert.deepEqual(await run(unanswered, expected, input(), calls), expected)
  assert.deepEqual(data(calls[1].prompt).learner, unanswered)
})

for (const args of [
  null, { ...input(), quiz: [] }, { ...input(), quiz: [{ q: 'Q' }] },
  { ...input(), artifact: '' }, { ...input(), audience: null },
]) {
  test('invalid input fails before either agent', async () => {
    const calls = []
    await assert.rejects(run(learner(), grade(), args, calls), /execution failed.*input/i)
    assert.equal(calls.length, 0)
  })
}
