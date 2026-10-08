import { readFileSync, statSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pluginRoot } from '../runtime.ts';
import { assertValid } from '../contracts.ts';
import type { CaptureEvidence } from '../generated/capture-evidence.ts';
import type { CaptureRow } from './types.ts';
type Entry = CaptureEvidence['captures'][string];
type Image = Entry['images'][number];
export function assembleEvidence(indexPath: string, rows: CaptureRow[], canonicalBaseUrl: string): CaptureEvidence {
  const gathered = new Map<
    string,
    { path: string; verificationUrl: string; linkUrl: string; selector: string; states: string[]; images: Image[] }
  >();
  const problems: CaptureEvidence['problems'] = [];
  for (const row of rows) {
    const id = row.componentId || row.machine;
    if (row.error) {
      problems.push({ componentId: id, detail: row.error });
      continue;
    }
    const file = resolve(realpathSync(dirname(indexPath)), row.file!);
    let exists = false;
    try {
      const stat = statSync(file);
      exists = stat.isFile() && stat.size > 0;
    } catch {
      /* Missing files remain explicit gaps. */
    }
    if (!exists) {
      problems.push({ componentId: id, detail: `capture file missing or empty: ${row.file}` });
      continue;
    }
    const { path, verificationUrl, linkUrl, selector } = row;
    if (!path || !verificationUrl || !linkUrl || !selector) {
      problems.push({ componentId: id, detail: `capture row has no page address or selector: ${row.file}` });
      continue;
    }
    const entry = gathered.get(id) ?? { path, verificationUrl, linkUrl, selector, states: [], images: [] };
    gathered.set(id, entry);
    const state = row.state || 'default';
    if (!entry.states.includes(state)) entry.states.push(state);
    entry.images.push({
      file,
      hash: 'sha256:' + createHash('sha256').update(readFileSync(file)).digest('hex'),
      viewport: row.viewport,
      state,
      ...(row.width !== undefined ? { width: row.width } : {}),
      ...(row.height !== undefined ? { height: row.height } : {}),
    });
  }
  const captures: CaptureEvidence['captures'] = {};
  for (const [id, entry] of gathered) {
    if (!entry.states.includes('default')) {
      problems.push({ componentId: id, detail: 'no successful default-state capture' });
      continue;
    }
    const [state, ...states] = entry.states,
      [image, ...images] = entry.images;
    if (state === undefined || image === undefined) continue;
    captures[id] = {
      path: entry.path,
      verificationUrl: entry.verificationUrl,
      linkUrl: entry.linkUrl,
      selector: entry.selector,
      states: [state, ...states],
      images: [image, ...images],
    };
  }
  const manifest = JSON.parse(readFileSync(resolve(pluginRoot, '.claude-plugin/plugin.json'), 'utf8')) as {
    version: string;
  };
  const document: CaptureEvidence = {
    standardVersion: '3.0.0',
    toolVersion: 'design-lab ' + manifest.version,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    canonicalBaseUrl: canonicalBaseUrl.replace(/\/+$/, ''),
    captures,
    problems,
  };
  assertValid('capture-evidence', document);
  return document;
}
