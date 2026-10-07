import { isEntrypoint } from './entrypoint.ts';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { sharedRequire } from './runtime.ts';
import { writeJson } from './contracts.ts';
import type { Tree, TreeNode } from './generated/tree.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
export interface ImageEntry { src: string; file?: string; contentType?: string; width?: number | null; height?: number | null; bytes?: number; error?: string; [key: string]: unknown }
export function sources(node: TreeNode, found = new Set<string>()): Set<string> {
  if (node.kind === 'image' && node.src && !node.src.startsWith('capture:')) found.add(node.src);
  if (node.backgroundImage?.src) found.add(node.backgroundImage.src);
  for (const child of node.children ?? []) sources(child, found); return found;
}
export function verifyTls(url: URL): boolean { return !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) && !url.hostname.endsWith('.ddev.site') && !url.hostname.endsWith('.localhost'); }
class HttpError extends Error { status: number; constructor(status: number) { super(`HTTP ${status}`); this.status = status; } }
async function get(url: string, redirects = 5): Promise<{ data: Buffer; contentType: string }> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported image URL protocol: ' + parsed.protocol);
  return new Promise((resolveResult, reject) => {
    const req = (parsed.protocol === 'https:' ? httpsRequest : httpRequest)(parsed, { headers: { 'User-Agent': 'design-lab' }, rejectUnauthorized: verifyTls(parsed) }, response => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        try { if (!redirects) reject(new Error('too many redirects')); else get(new URL(response.headers.location, parsed).href, redirects - 1).then(resolveResult, reject); } catch (error) { reject(error); }
        return;
      }
      if (status >= 400) { response.resume(); reject(new HttpError(status)); return; }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk)); response.on('error', reject);
      response.on('end', () => resolveResult({ data: Buffer.concat(chunks), contentType: (response.headers['content-type'] ?? 'text/plain').split(';')[0]!.trim() }));
    });
    req.on('error', reject); req.setTimeout(60000, () => req.destroy(new Error('image request timed out'))); req.end();
  });
}
export async function fetchImage(url: string, attempts = 4): Promise<{ data: Buffer; contentType: string }> {
  for (let attempt = 0; ; attempt++) try { return await get(url); } catch (error) {
    if (attempt >= attempts - 1 || error instanceof HttpError && error.status < 500) throw error;
    await delay(2000 * (attempt + 1));
  }
}
export async function convertImage(data: Buffer, contentType: string): Promise<{ data: Buffer; contentType: string; width: number | null; height: number | null }> {
  if (['image/png', 'image/jpeg', 'image/gif'].includes(contentType)) return { data, contentType, width: null, height: null };
  const converted = await sharp(data).png().toBuffer({ resolveWithObject: true });
  return { data: converted.data, contentType: 'image/png', width: converted.info.width, height: converted.info.height };
}
export function publicUrl(url: string, base: string, publicBase?: string): string | null {
  const clean = base.replace(/\/+$/, ''); return publicBase && url.startsWith(clean + '/') ? publicBase.replace(/\/+$/, '') + url.slice(clean.length) : null;
}
export function offlineManifest(found: Set<string>, out: string): ImageEntry[] {
  const cached = existsSync(resolve(out, 'images.json')) ? JSON.parse(readFileSync(resolve(out, 'images.json'), 'utf8')) as ImageEntry[] : [], by = new Map(cached.map(item => [item.src, item]));
  return [...found].sort().map(src => {
    const item = by.get(src), local = item?.file ? resolve(out, basename(item.file)) : undefined;
    return local && existsSync(local) && dirname(realpathSync(local)) === realpathSync(out) ? { ...item, src, file: realpathSync(local) } : { src, error: 'offline image is absent from the frozen cache' };
  });
}
export async function fetchImages(tree: { tree?: TreeNode; breakpoints?: { tree?: TreeNode | null }[] }, options: { out: string; baseUrl?: string; fallbackBaseUrl?: string; offline?: boolean }, fetcher = fetchImage): Promise<ImageEntry[]> {
  if (!options.offline && !options.baseUrl) throw new Error('--base-url is required unless --offline is used');
  const found = new Set<string>(); if (tree.tree) sources(tree.tree, found); for (const bp of tree.breakpoints ?? []) if (bp.tree) sources(bp.tree, found);
  mkdirSync(options.out, { recursive: true }); const manifest = options.offline ? offlineManifest(found, options.out) : [];
  if (!options.offline) for (const src of [...found].sort()) {
    const url = new URL(src, options.baseUrl!.replace(/\/+$/, '') + '/').href; let converted: Awaited<ReturnType<typeof convertImage>>;
    try { const result = await fetcher(url); converted = await convertImage(result.data, result.contentType); }
    catch (error) {
      const publicSite = publicUrl(url, options.baseUrl!, options.fallbackBaseUrl);
      try { if (!publicSite) throw error; const result = await fetcher(publicSite); converted = await convertImage(result.data, result.contentType); }
      catch (again) { manifest.push({ src, error: `${error instanceof Error ? error.name : 'Error'}: ${String(error)}`.slice(0, 300) + (publicSite ? `; public site: ${again instanceof Error ? again.name : 'Error'}` : '') }); continue; }
    }
    const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' } as Record<string, string>)[converted.contentType];
    const file = resolve(options.out, createHash('sha256').update(src).digest('hex').slice(0, 16) + '.' + ext);
    writeFileSync(file, converted.data); manifest.push({ src, file, contentType: converted.contentType, width: converted.width, height: converted.height, bytes: converted.data.length });
  }
  writeJson(resolve(options.out, 'images.json'), manifest); return manifest;
}
if (isEntrypoint(import.meta.url)) {
  const args = process.argv.slice(2), get = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
  const treePath = args.find((arg, i) => !arg.startsWith('--') && (i === 0 || !['--out', '--base-url', '--fallback-base-url'].includes(args[i - 1]!)))!;
  if (!args.includes('--out')) throw new Error('usage: fetch-images.ts TREE.json --out DIR [--base-url URL] [--fallback-base-url URL] [--offline]');
  const baseUrl = args.includes('--base-url') ? get('--base-url') : undefined, fallbackBaseUrl = args.includes('--fallback-base-url') ? get('--fallback-base-url') : undefined;
  const manifest = await fetchImages(JSON.parse(readFileSync(treePath, 'utf8')) as Tree, { out: get('--out')!, offline: args.includes('--offline'), ...(baseUrl !== undefined ? { baseUrl } : {}), ...(fallbackBaseUrl !== undefined ? { fallbackBaseUrl } : {}) });
  console.log(`${manifest.filter(m => !m.error).length} images; ${manifest.filter(m => m.error).length} failed`);
}
