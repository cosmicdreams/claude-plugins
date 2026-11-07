// Role-bound decisions checked when read (plan §3, §5, §8): demotion out of a blocking lane, quarantine
// and risk acceptance need the QA role; a record claiming a role its author doesn't hold has no effect.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { effectiveClassification, laneClassOf, quarantines } from '../../src/dispositions.ts';
import type { ClassificationChange, Quarantine } from '../../src/model.ts';
import { DEV, QA, ROLES } from './support.ts';

const change = (id: string, extra: Partial<ClassificationChange>): ClassificationChange => ({
  id,
  target: { suite: 'e2e' },
  from: null,
  to: 'governed',
  by: QA,
  role: 'qa',
  standIn: true,
  at: `2026-10-0${id.length}T00:00:00Z`,
  reason: 'r',
  ...extra,
});

describe('classification', () => {
  const onboarding = change('a', {});

  test('a developer reclassifying a governed path as legacy is refused, and the path stays governed', () => {
    const r = effectiveClassification([onboarding, change('aa', { target: { suite: 'e2e', glob: 'tests/flaky.spec.ts' }, to: 'legacy', by: DEV, role: 'developer', standIn: false })], ROLES);
    assert.equal(r.refused.length, 1);
    assert.equal(laneClassOf(r.rules, 'e2e', 'desktop', 'tests/flaky.spec.ts'), 'governed');
  });

  test('a developer excluding a governed project is refused', () => {
    const r = effectiveClassification([onboarding, change('aa', { target: { suite: 'e2e', project: 'desktop' }, to: 'excluded', by: DEV, role: 'developer', standIn: false })], ROLES);
    assert.equal(laneClassOf(r.rules, 'e2e', 'desktop', 'tests/a.spec.ts'), 'governed');
  });

  test('someone claiming the QA role without holding it is refused', () => {
    const r = effectiveClassification([onboarding, change('aa', { target: { suite: 'e2e', glob: 'tests/**' }, to: 'excluded', by: 'Mallory' })], ROLES);
    assert.equal(r.refused.length, 1);
  });

  test('QA can demote, and the most specific rule wins', () => {
    const r = effectiveClassification([onboarding, change('aa', { target: { suite: 'e2e', glob: 'scratch/**' }, to: 'legacy' })], ROLES);
    assert.equal(laneClassOf(r.rules, 'e2e', 'desktop', 'scratch/x.spec.ts'), 'legacy');
    assert.equal(laneClassOf(r.rules, 'e2e', 'desktop', 'tests/x.spec.ts'), 'governed');
  });

  test('a change that misstates the lane it changes from is refused', () => {
    const r = effectiveClassification([onboarding, change('aa', { from: 'legacy', to: 'excluded' })], ROLES);
    assert.equal(r.refused.length, 1);
  });
});

describe('quarantine', () => {
  const q = (id: string, extra: Partial<Quarantine> = {}): Quarantine => ({
    kind: 'quarantine', id, test: { suite: 'e2e', file: `tests/${id}.spec.ts`, titlePath: [id] }, owner: QA, ticket: 'T-1', expires: '2099-01-01', by: QA, role: 'qa', standIn: true, at: `2026-10-09T00:00:0${id.length}Z`, reason: 'r', ...extra,
  });
  const now = new Date('2026-10-09T12:00:00Z');

  test('the profile cap holds: the earliest win, the rest are refused', () => {
    const r = quarantines([q('a'), q('bb'), q('ccc')], ROLES, now, 2, () => false);
    assert.deepEqual(r.live.map((x) => x.id), ['a', 'bb']);
    assert.match(r.refused[0]?.reason ?? '', /cap of 2/);
  });

  test('a quarantine with no ticket, an expired one, or one in the developer role is refused', () => {
    const r = quarantines([q('a', { ticket: '' }), q('bb', { expires: '2020-01-01' }), q('ccc', { by: DEV, role: 'developer', standIn: false })], ROLES, now, 8, () => false);
    assert.equal(r.live.length, 0);
    assert.equal(r.refused.length, 3);
  });

  test('a quarantine on a required test never takes effect', () => {
    const r = quarantines([q('a')], ROLES, now, 8, () => true);
    assert.equal(r.live.length, 0);
    assert.equal(r.onRequired.length, 1);
  });
});

// Review R1 finding 7: self-reported dates do not establish onboarding.
test('R1-7 backdated developer exclusion cannot precede trusted governed onboarding', () => {
  const baseline = change('base', { at: '2026-10-08', to: 'governed' });
  const proposed = change('backdated', { at: '2026-10-01', target: { suite: 'e2e', glob: 'tests/failing.spec.ts' }, to: 'excluded', by: DEV, role: 'developer', standIn: false });
  const r = effectiveClassification([proposed, baseline], ROLES, [baseline]);
  assert.equal(r.refused.length, 1);
  assert.equal(laneClassOf(r.rules, 'e2e', 'desktop', 'tests/failing.spec.ts'), 'governed');
});

test('R1-7 only trusted baseline history permits developer onboarding exclusions', () => {
  const onboard = change('initial', {to:'excluded',by:DEV,role:'developer',standIn:false});
  assert.equal(effectiveClassification([onboard],ROLES).refused.length,1);
  const accepted = effectiveClassification([onboard],ROLES,[onboard]);
  assert.deepEqual(accepted.refused,[]);
  assert.equal(laneClassOf(accepted.rules,'e2e','desktop','tests/a.spec.ts'),'excluded');
  const tampered = effectiveClassification([{...onboard,to:'legacy'}],ROLES,[onboard]);
  assert.equal(tampered.refused.length,1);
  assert.equal(laneClassOf(tampered.rules,'e2e','desktop','tests/a.spec.ts'),'excluded');
});
