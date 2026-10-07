import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePair, compare, masked, region } from '../../src/figma-compare.ts';
import { sharedRequire } from '../../src/runtime.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
const pixels = (width: number, height: number, fill = 100) => ({ width, height, data: new Uint8Array(width * height * 3).fill(fill) });
test('identical pixels pass both metrics, missing content and displacement fail', () => {
  const a = pixels(100, 100), b = pixels(100, 100, 255); assert.equal(comparePair(a, a).changed, 0); assert.equal(comparePair(a, a, true).pass, true); assert.equal(comparePair(a, b).pass, false);
  const shifted = pixels(100, 100); for (let y = 0; y < 100; y++) shifted.data.fill(255, y * 300, y * 300 + 60); assert.ok(comparePair(a, shifted).ratio > .06);
});
test('unmatched height and area count in corrected acceptance', () => { const a = pixels(100, 50), b = pixels(100, 80); assert.equal(comparePair(a, b).pass, true); const corrected = comparePair(a, b, true); assert.equal(corrected.changed, 3000); assert.equal(corrected.heightDelta, 30); assert.equal(corrected.pass, false); });
test('tolerance applies per channel and equality at the threshold does not count', () => { const a = pixels(10, 10), b = pixels(10, 10); for (let p = 0; p < 100; p++) b.data[p * 3] = 150; assert.equal(comparePair(a, b).pass, true); assert.equal(comparePair(a, b, true).changed, 100); for (let p = 0; p < 100; p++) b.data[p * 3] = 140; assert.equal(comparePair(a, b, true).changed, 0); });
test('Pillow crop rounding and black padding are retained', () => { const image = pixels(2, 2, 255); const out = region(image, { x: -.5, y: 0, width: 3, height: 2 }); assert.deepEqual([...out.data.subarray(0, 3)], [255, 255, 255]); assert.deepEqual([...out.data.subarray(6, 9)], [0, 0, 0]); });
test('masking expands text boxes by a pixel and keeps other geometry', () => { const img = pixels(10, 10, 0), out = masked(img, [{ x: 3, y: 3, width: 1, height: 1 }]); assert.equal(out.data[(2 * 10 + 2) * 3], 255); assert.equal(out.data[(5 * 10 + 5) * 3], 0); assert.equal(img.data[(2 * 10 + 2) * 3], 0); });
test('Sharp decoding uses white alpha background, corrected metrics and text masks', async () => {
  const png = await sharp({ create: { width: 20, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(); const geometry = { variants: [{ label: 'Mobile', x: 0, y: 0, width: 20, height: 20 }], captures: [{ label: 'Mobile', x: 0, y: 20, width: 20, height: 20 }] };
  const result = await compare(png, geometry, true, [[{ x: 2, y: 2, width: 3, height: 4 }]]); assert.equal(result.metric, 'corrected'); assert.equal(result.pass, true); assert.equal(result.pairs[0]!.ratioUnmasked, 0); assert.equal(result.pairs[0]!.textMasked, 1); assert.equal((await compare(png, { variants: [], captures: [] }, true)).pass, false);
});
