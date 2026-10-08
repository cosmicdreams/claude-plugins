import test from 'node:test';
import assert from 'node:assert/strict';
import * as sass from '../../src/extract-tokens-sass.ts';
void test('score and voice report numbers share exact six-digit tie rounding', async () => {
  const score = await import('../../src/score-run.ts'),
    voice = await import('../../src/extract-voice.ts');
  assert.equal(score.formatG, sass.pyFormatG);
  assert.equal(voice.formatG, sass.pyFormatG);
  for (const format of [score.formatG, voice.formatG]) {
    assert.equal(format(1234565), '1.23456e+06');
    assert.equal(format(1234575), '1.23458e+06');
    assert.equal(format(999999.5), '1e+06');
    assert.equal(format(-0), '-0');
  }
});
