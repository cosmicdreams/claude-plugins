import { oracleScript, oracleScripts, oracleExecutable } from './oracle.ts';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sharedRequire, pluginRoot } from '../../src/runtime.ts';
import { fetchImages } from '../../src/fetch-images.ts';
import { fitFigmaImage } from '../../src/figma-runner.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
export { assertPixels, EXACT, JPEG, EDGE } from './pixel-compare.ts';
import { assertPixels, EXACT, JPEG, EDGE } from './pixel-compare.ts';
export interface OracleImage {
  source: string;
  target: string;
  action: 'fit' | 'convert';
  contentType?: string;
}
export function oracleImages(rows: OracleImage[], root: string) {
  assert.ok(root.startsWith('/tmp/'));
  mkdirSync(root, { recursive: true });
  const input = resolve(root, 'image-oracle-input.json');
  writeFileSync(input, JSON.stringify(rows));
  const out = spawnSync(oracleExecutable, [oracleScript('image-oracle.py'), input], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(out.status, 0, out.stderr);
}
export async function freshImages(root: string) {
  mkdirSync(root, { recursive: true });
  const svg = resolve(root, 'fresh.svg');
  writeFileSync(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><rect width="128" height="96" fill="#245678"/><circle cx="64" cy="48" r="31" fill="#efbc23"/></svg>',
  );
  const raw = Buffer.alloc(5000 * 24 * 4);
  for (let i = 0; i < raw.length; i += 4) {
    const x = (i / 4) % 5000,
      y = Math.floor(i / 4 / 5000);
    raw[i] = x % 256;
    raw[i + 1] = y * 10;
    raw[i + 2] = Math.floor(x / 20) % 256;
    raw[i + 3] = 100 + (x % 156);
  }
  const png = resolve(root, 'fresh-wide.png'),
    webp = resolve(root, 'fresh.webp'),
    jpeg = resolve(root, 'fresh-wide.jpg');
  await sharp(raw, { raw: { width: 5000, height: 24, channels: 4 } })
    .png()
    .toFile(png);
  await sharp(raw, { raw: { width: 5000, height: 24, channels: 4 } })
    .webp({ lossless: true })
    .toFile(webp);
  await sharp(raw, { raw: { width: 5000, height: 24, channels: 4 } })
    .jpeg({ quality: 90 })
    .toFile(jpeg);
  const rows: OracleImage[] = [
    { source: svg, action: 'convert', contentType: 'image/svg+xml', target: resolve(root, 'svg-oracle.png') },
    { source: webp, action: 'convert', contentType: 'image/webp', target: resolve(root, 'webp-oracle.png') },
    ...[png, jpeg].map((source, i) => ({
      source,
      action: 'fit' as const,
      target: resolve(root, `fit-${i}.${i ? 'jpg' : 'png'}`),
    })),
  ];
  oracleImages(rows, root);
  const stats = [];
  for (const row of rows) {
    let actual: Buffer;
    if (row.action === 'fit') actual = await fitFigmaImage(row.source);
    else {
      // Exercise fresh fetch/conversion/artifact dispatch, with injected raw responses and no network.
      const manifest = await fetchImages(
        { tree: { kind: 'image', src: '/fresh', name: 'fresh', source: '/img', sizing: 'FIXED' } },
        { out: resolve(root, 'fetch-' + stats.length), baseUrl: 'https://fixture.test' },
        async () => ({ data: readFileSync(row.source), contentType: row.contentType! }),
      );
      actual = readFileSync(manifest[0]!.file!);
      const fitted = resolve(root, 'served-' + stats.length + '.png');
      oracleImages([{ source: row.target, target: fitted, action: 'fit' }], root);
      const served = await fitFigmaImage(manifest[0]!.file!);
      stats.push({
        source: row.source,
        phase: 'served',
        ...(await assertPixels(served, readFileSync(fitted), 'fresh served ' + row.source, EDGE)),
      });
    }
    stats.push({
      source: row.source,
      phase: row.action,
      ...(await assertPixels(
        actual,
        readFileSync(row.target),
        'fresh ' + row.source,
        row.contentType === 'image/webp' ? EXACT : row.source.endsWith('.jpg') ? JPEG : EDGE,
      )),
    });
  }
  return stats;
}
