import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRunnerClientParity } from '../runner-client-parity.ts';
test('stripped runner client matches the oracle except the reviewed cache and timing code', () => {
  assert.deepEqual(assertRunnerClientParity(), { runner: 1, cache: true, timing: true });
});
