import test from 'node:test';
import assert from 'node:assert/strict';
import { pyJson } from './python-oracle.ts';
import { sharedRequire } from '../../src/runtime.ts';

const sharp = sharedRequire()('sharp') as typeof import('sharp').default;

// Every gray level against every alpha value, composited onto white with Pillow's paste(mask=alpha).
const PY = `
from PIL import Image
image = Image.new('RGBA', (256, 256))
image.putdata([(g, g, g, a) for a in range(256) for g in range(256)])
canvas = Image.new('RGB', image.size, 'white')
canvas.paste(image, mask=image.split()[-1])
print(json.dumps(list(canvas.tobytes())))
`;

test('flattening RGBA onto white matches Pillow paste(mask=alpha) for every gray and alpha', async () => {
  const { flattenRgbaOverWhite } = await import('../../src/figma-compare.ts');
  const pillow = pyJson<number[]>(PY);
  const rgba = new Uint8Array(256 * 256 * 4);
  let p = 0;
  for (let a = 0; a < 256; a++) for (let g = 0; g < 256; g++, p++) rgba.set([g, g, g, a], p * 4);
  const flat = flattenRgbaOverWhite(rgba);
  assert.equal(flat.length, pillow.length);
  const mismatches: string[] = [];
  for (let i = 0; i < pillow.length; i++) if (flat[i] !== pillow[i]) mismatches.push(`pixel ${i / 3 | 0} channel ${i % 3}: ${flat[i]} != ${pillow[i]}`);
  assert.deepEqual(mismatches.slice(0, 5), [], `${mismatches.length} mismatches`);
});

test('the thumbnail decode path yields 255 for gray 128 at alpha 1 over white, as Pillow does', async () => {
  const { flattenRgbaOverWhite } = await import('../../src/figma-compare.ts');
  const png = await sharp(Buffer.from([128, 128, 128, 1]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
  const raw = await sharp(png).ensureAlpha().raw().toBuffer();
  assert.deepEqual([...flattenRgbaOverWhite(new Uint8Array(raw))], [255, 255, 255]);
});
