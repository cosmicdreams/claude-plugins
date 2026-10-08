import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fitFigmaImage, FIGMA_IMAGE_LIMIT } from '../../src/figma-runner.ts';
import { sharedRequire } from '../../src/runtime.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;

void test('tall captures fit the Figma image limit with their aspect ratio preserved', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-image-limit-'));
  try {
    const path = resolve(root, 'tall.png');
    await sharp({ create: { width: 100, height: 5000, channels: 3, background: '#fff' } })
      .png()
      .toFile(path);
    const metadata = await sharp(await fitFigmaImage(path)).metadata();
    assert.equal(metadata.height, FIGMA_IMAGE_LIMIT);
    assert.equal(metadata.width, Math.trunc((100 * FIGMA_IMAGE_LIMIT) / 5000));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
