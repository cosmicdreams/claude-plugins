import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { identityOf, inputHash, parseIdentity } from '../../hooks/mod/request-identity.ts';
import { coordinate } from '../../src/coordinator.ts';
import { tmp } from './support.ts';

test('request identity binds exact argv, deadline, work and input values without persisting values', async () => {
  const context = { operation: 'run' as const, appRoot: '/app', suiteRoot: '/suite', environment: 'local', work: 'WORK-1', noWork: false };
  const inputs = { LANGUAGE: { state: 'set', value: 'value-never-in-artifacts' }, OPTIONAL: { state: 'unset' } };
  const base = await identityOf('op-one', ['run', '--work', 'WORK-1'], 60_000, context, inputs);
  assert.deepEqual(parseIdentity(base), base);
  assert.ok(!JSON.stringify(base).includes(inputs.LANGUAGE.value));
  assert.equal(base.inputsHash, await inputHash({ OPTIONAL: inputs.OPTIONAL, LANGUAGE: inputs.LANGUAGE }));
  for (const other of [
    await identityOf('op-two', ['run', '--work', 'WORK-1'], 60_000, context, inputs),
    await identityOf('op-one', ['run', '--work', 'WORK-2'], 60_000, context, inputs),
    await identityOf('op-one', ['run', '--work', 'WORK-1'], 61_000, context, inputs),
    await identityOf('op-one', ['run', '--work', 'WORK-1'], 60_000, { ...context, work: 'WORK-2' }, inputs),
    await identityOf('op-one', ['run', '--work', 'WORK-1'], 60_000, context, { ...inputs, LANGUAGE: { state: 'unset' } }),
  ]) assert.notEqual(other.requestHash, base.requestHash);
});

test('core persists validated identity in verdict and manifest even for a refused profile', async () => {
  const root = realpathSync(tmp('test-lab-identity-'));
  const inputs = { LANGUAGE: { state: 'set' as const, value: 'value-never-in-artifacts' } };
  try {
    const context = { operation: 'run' as const, appRoot: root, suiteRoot: root, environment: 'local', work: 'WORK-1', noWork: false };
    const identity = await identityOf('op-core', ['run', '--work', 'WORK-1'], 60_000, context, inputs);
    const r = await coordinate({ ...context, work: 'WORK-1', environmentValues: inputs, requestIdentity: identity });
    assert.equal(r.verdict.verdict, 'not-evaluable');
    for (const name of ['manifest.json', 'verdict.json']) {
      const text = readFileSync(join(r.runDir, name), 'utf8');
      assert.deepEqual(JSON.parse(text).requestIdentity, identity);
      assert.ok(!text.includes(inputs.LANGUAGE.value));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const field of ['work', 'inputs', 'context', 'format'] as const) test(`core refuses a mismatched ${field} identity before creating run artifacts`, async () => {
  const root = realpathSync(tmp('test-lab-identity-refuse-'));
  try {
    const context = { operation: 'run' as const, appRoot: root, suiteRoot: root, environment: 'local', work: 'WORK-1', noWork: false };
    const identity = await identityOf('op-core', ['run'], 60_000, context, null);
    const request = { ...context, work: 'WORK-1', requestIdentity: identity };
    if (field === 'work') identity.context.work = 'WORK-OTHER';
    if (field === 'inputs') identity.inputsHash = await inputHash({ OTHER: { state: 'unset' } });
    if (field === 'context') identity.context.suiteRoot = '/other';
    if (field === 'format') identity.requestHash = 'invalid';
    await assert.rejects(coordinate(request), /request identity/);
    assert.equal(existsSync(join(root, '.test-lab/runs')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
