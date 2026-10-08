import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../../src/contracts.ts';
import type { Project } from '../../src/generated/project.ts';
const project = (detail: NonNullable<Project['phases'][string]['detail']>): Project => ({
  schemaVersion: 1,
  standardVersion: '4.1.0',
  pluginVersion: '0.24.0',
  repository: { root: '/repo', commit: null, dirty: false },
  decisions: {},
  phases: { verify: { status: 'complete', detail } },
  artifacts: {},
});
void test('project contract accepts the verification details evaluate writes', () => {
  assert.deepEqual(
    validate(
      'project',
      project({ execution: 'finished', quality: 'passed', verifyExit: 0, receiptsExit: 0, gateExit: 0, gate: '{}' }),
    ),
    [],
  );
  assert.deepEqual(validate('project', project({ expected: 1, built: 0, invalid: ['card'] })), []);
  assert.notDeepEqual(
    validate(
      'project',
      project({
        execution: 'finished',
        quality: 'passed',
        verifyExit: 0,
        receiptsExit: 0,
        gateExit: 0,
        gate: '{}',
        ...{ qualty: 'passed' },
      }),
    ),
    [],
  );
});
void test('connection omissions remain null and browser executable paths remain strings', () => {
  assert.deepEqual(
    validate(
      'project',
      project({
        coverPageId: null,
        coverId: null,
        font: null,
        fontLoaded: null,
        runnerConnected: null,
        fileKeyMatches: null,
        empty: null,
        onlyPreflightCover: null,
        checks: {
          browser: { nodeCwd: null, executable: '/usr/bin/chromium' },
          pluginVersion: { recorded: null, current: '0.24.0' },
        },
      }),
    ),
    [],
  );
});
