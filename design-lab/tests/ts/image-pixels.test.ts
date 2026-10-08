import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPixels } from '../equivalence/image-pixels.ts';
import { sharedRequire } from '../../src/runtime.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
void test('served-image verification rejects nonempty wrong pixels and accepts different PNG compression', async () => {
  const image = sharp({ create: { width: 24, height: 18, channels: 4, background: '#4287ff' } });
  const a = await image.clone().png({ compressionLevel: 1 }).toBuffer(),
    b = await image.clone().png({ compressionLevel: 9 }).toBuffer();
  assert.ok(!a.equals(b));
  await assertPixels(a, b, 'compression');
  const wrong = await sharp({ create: { width: 24, height: 18, channels: 4, background: '#ff0000' } })
    .png()
    .toBuffer();
  assert.ok(wrong.length > 0);
  await assert.rejects(assertPixels(a, wrong, 'wrong served pixels'), /tolerance/);
});
