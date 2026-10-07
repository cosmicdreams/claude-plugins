import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sources, fetchImages, convertImage, publicUrl, offlineManifest, verifyTls, fetchImage } from '../../src/fetch-images.ts';
import type { TreeNode } from '../../src/generated/tree.ts';
import { sharedRequire } from '../../src/runtime.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
const image = (src: string): TreeNode => ({ kind: 'image', src, name: 'image', source: '/img', sizing: 'FIXED' });
const tree = (...children: TreeNode[]): TreeNode => ({ kind: 'frame', name: 'root', source: '/root', sizing: 'FIXED', children });
test('collect nested images and backgrounds but exclude capture crops', () => {
  const root = tree(image('/a.jpg'), tree(image('https://x.test/b.webp')), image('capture:desktop:0,0,10,10')); root.backgroundImage = { src: '/bg.png' };
  assert.deepEqual([...sources(root)].sort(), ['/a.jpg', '/bg.png', 'https://x.test/b.webp']);
});
test('one missing asset preserves successful converted assets', async () => {
  const out = mkdtempSync('/tmp/design-lab-p2-image-'), svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><rect width="8" height="6" fill="red"/></svg>');
  const manifest = await fetchImages({ tree: tree(image('/good.svg'), image('/missing.png')) }, { out, baseUrl: 'https://local.test' }, async url => { if (url.endsWith('missing.png')) throw new Error('missing'); return { data: svg, contentType: 'image/svg+xml' }; });
  assert.equal(manifest.length, 2); assert.ok(manifest.find(e => e.src === '/missing.png')!.error);
  const successful = manifest.find(e => e.src === '/good.svg')!; assert.ok(successful.file); assert.equal(successful.contentType, 'image/png');
  const pixels = await sharp(readFileSync(successful.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([pixels.info.width, pixels.info.height], [8, 6]); for (let i = 0; i < pixels.data.length; i += 4) assert.deepEqual([...pixels.data.subarray(i, i + 4)], [255, 0, 0, 255]);
});
test('SVG is rasterized and WebP converted; accepted bytes stay untouched', async () => {
  const original = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#123456' } }).png().toBuffer();
  assert.equal((await convertImage(original, 'image/png')).data, original);
  const webp = await sharp(original).webp({ lossless: true }).toBuffer(), converted = await convertImage(webp, 'image/webp');
  assert.equal(converted.contentType, 'image/png'); assert.deepEqual([converted.width, converted.height], [8, 6]);
  assert.deepEqual(await sharp(converted.data).raw().toBuffer(), await sharp(original).raw().toBuffer());
});
test('public fallback retries only a local missing path', async () => {
  const out = mkdtempSync('/tmp/design-lab-p2-image-'), visited: string[] = [];
  const manifest = await fetchImages({ tree: image('/missing.png') }, { out, baseUrl: 'https://local.test', fallbackBaseUrl: 'https://public.test' }, async url => { visited.push(url); if (url.includes('local')) throw new Error('missing'); return { data: Buffer.from('PNG'), contentType: 'image/png' }; });
  assert.equal(manifest[0]!.error, undefined); assert.deepEqual(visited, ['https://local.test/missing.png', 'https://public.test/missing.png']);
  assert.equal(publicUrl('https://other.test/a', 'https://local.test', 'https://public.test'), null);
});
test('offline cache resolves copied basenames and refuses escaping symlinks', () => {
  const out = mkdtempSync('/tmp/design-lab-p2-image-'), foreign = mkdtempSync('/tmp/design-lab-p2-image-');
  writeFileSync(resolve(out, 'one.png'), 'image'); writeFileSync(resolve(foreign, 'foreign.png'), 'foreign'); symlinkSync(resolve(foreign, 'foreign.png'), resolve(out, 'two.png'));
  writeFileSync(resolve(out, 'images.json'), JSON.stringify([{ src: '/one', file: '/old/run/one.png' }, { src: '/two', file: '/old/run/two.png' }]));
  const manifest = offlineManifest(new Set(['/one', '/two', '/absent']), out);
  assert.ok(manifest.find(m => m.src === '/one')!.file!.endsWith('/one.png')); assert.ok(manifest.find(m => m.src === '/two')!.error); assert.ok(manifest.find(m => m.src === '/absent')!.error);
});
test('TLS verification exceptions are limited to actual development hosts', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'demo.ddev.site', 'demo.localhost']) assert.equal(verifyTls(new URL('https://' + host)), false);
  for (const host of ['public.test', 'not-ddev.site', 'ddev.site.attacker.test']) assert.equal(verifyTls(new URL('https://' + host)), true);
});
test('HTTP fetch follows redirects and does not retry missing files', async () => {
  let misses = 0; const server = createServer((req, res) => { if (req.url === '/redirect') { res.writeHead(302, { Location: '/image' }); res.end(); } else if (req.url === '/image') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end('PNG'); } else { misses++; res.writeHead(404); res.end('missing'); } });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { const result = await fetchImage(base + '/redirect'); assert.equal(result.data.toString(), 'PNG'); assert.equal(result.contentType, 'image/png'); await assert.rejects(fetchImage(base + '/missing'), /HTTP 404/); assert.equal(misses, 1); }
  finally { await new Promise<void>((r, reject) => server.close(error => error ? reject(error) : r())); }
});
