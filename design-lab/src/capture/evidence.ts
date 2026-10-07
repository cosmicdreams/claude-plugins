import { readFileSync, statSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pluginRoot } from '../runtime.ts';
import { assertValid } from '../contracts.ts';
import type { CaptureEvidence } from '../generated/capture-evidence.ts';
import type { CaptureRow } from './types.ts';
export function assembleEvidence(indexPath: string, rows: CaptureRow[], canonicalBaseUrl: string): CaptureEvidence {
  const captures: Record<string, { path: string | null; verificationUrl: string | null; linkUrl: string | null; selector: string | null; states: string[]; images: {file: string; hash: string; viewport: string; state: string; width: number | null; height: number | null}[] }> = {}, problems: {componentId: string; detail: string}[] = [];
  for (const row of rows) {
    const id = row.componentId || row.machine;
    if (row.error) { problems.push({ componentId: id, detail: row.error }); continue; }
    const file = resolve(realpathSync(dirname(indexPath)), row.file!);
    let exists = false; try { const stat = statSync(file); exists = stat.isFile() && stat.size > 0; } catch { /* Missing files remain explicit gaps. */ }
    if (!exists) { problems.push({ componentId: id, detail: `capture file missing or empty: ${row.file}` }); continue; }
    const entry = captures[id] ??= { path: row.path ?? null, verificationUrl: row.verificationUrl ?? null, linkUrl: row.linkUrl ?? null, selector: row.selector ?? null, states: [], images: [] };
    const state = row.state || 'default';
    if (!entry.states.includes(state)) entry.states.push(state);
    entry.images.push({ file, hash: 'sha256:' + createHash('sha256').update(readFileSync(file)).digest('hex'), viewport: row.viewport,
      state, width: row.width ?? null, height: row.height ?? null });
  }
  for (const [id, entry] of Object.entries(captures)) if (!entry.states.includes('default')) {
    problems.push({ componentId: id, detail: 'no successful default-state capture' }); delete captures[id];
  }
  const manifest = JSON.parse(readFileSync(resolve(pluginRoot, '.claude-plugin/plugin.json'), 'utf8')) as { version: string };
  const document = { standardVersion: '3.0.0', toolVersion: 'design-lab ' + manifest.version, generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    canonicalBaseUrl: canonicalBaseUrl.replace(/\/+$/, ''), captures, problems };
  assertValid('capture-evidence', document);
  return document;
}
