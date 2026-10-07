import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sharedRequire } from '../runtime.ts';
import { roundEven } from '../json.ts';
import { subtree } from '../nesting.ts';
import { parseColor } from '../spec-to-tree.ts';
import { writeJson } from '../contracts.ts';
import type { Spec } from '../generated/spec.ts';
import type { Component } from './scaffold.ts';
import type { CaptureConfig, CaptureRow } from './types.ts';
import { readRecord, stem } from './run.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
/** Pillow RGB crop/paste semantics: alpha is dropped, overhang uses the child's backdrop. */
export async function cropChild(source: string, out: string, box: { x: number; y: number; width: number; height: number }, scale: number, backdrop: string): Promise<void> {
  const [left, top, right, bottom] = [box.x, box.y, box.x + box.width, box.y + box.height].map(v => roundEven(v * scale));
  const width = right! - left!, height = bottom! - top!;
  if (width <= 0 || height <= 0) throw new Error('empty child crop');
  const image = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const x0 = Math.max(0, left!), y0 = Math.max(0, top!), x1 = Math.min(image.info.width, right!), y1 = Math.min(image.info.height, bottom!);
  const canvas = sharp({ create: { width, height, channels: 3, background: backdrop } });
  if (x1 > x0 && y1 > y0) {
    const clip = await sharp(image.data, { raw: { width: image.info.width, height: image.info.height, channels: 3 } }).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
    canvas.composite([{ input: clip, left: x0 - left!, top: y0 - top! }]);
  }
  await canvas.removeAlpha().png().toFile(out);
}
export async function deriveChildren(byId: Map<string, Component>, eligible: Set<string>, ready: { cfg: CaptureConfig; digest: string }[], records: string, measurements: string, shots: string, scale: number): Promise<Map<string, CaptureRow[]>> {
  const captured = new Set(ready.map(r => r.cfg.componentId)), rowsByChild = new Map<string, CaptureRow[]>();
  for (const { cfg, digest } of ready) {
    const parent = cfg.componentId, record = readRecord(resolve(records, stem(parent) + '.json')), specFile = resolve(measurements, stem(parent) + '.spec.json');
    if (record?.status !== 'complete' || record.configHash !== digest || !existsSync(specFile)) continue;
    const spec = JSON.parse(readFileSync(specFile, 'utf8')) as Spec;
    const children = [...new Set((byId.get(parent)?.slots ?? []).flatMap(s => s.accepts ?? []))].filter(child => !captured.has(child) && !rowsByChild.has(child)).sort();
    for (const child of children) {
      if (!eligible.has(child) || !byId.has(child)) continue;
      const found = subtree(spec, child); if (!found) continue; const [derived, boxes] = found;
      if (Object.keys(boxes).sort().join(',') !== 'desktop,mobile,tablet') continue;
      const rows: CaptureRow[] = [];
      for (const row of record.rows) {
        const viewport = row.viewport.toLowerCase(), box = boxes[viewport]; if (row.error || row.state !== 'default' || !box || !row.file) continue;
        const file = `${stem(child)}__${viewport}.png`, behind = parseColor(derived[`${viewport}:default`]?.backdrop) ?? { hex: '#ffffff' };
        await cropChild(resolve(shots, row.file), resolve(shots, file), box, scale, behind.hex);
        rows.push({ ...row, componentId: child, machine: byId.get(child)!.machineName ?? child, file, width: roundEven(box.width), height: roundEven(box.height), selector: `[data-design-lab-child="${child}"]`, derivedFrom: parent } as CaptureRow);
      }
      if (rows.length !== 3) continue;
      const c = byId.get(child)!;
      writeJson(resolve(measurements, stem(child) + '.spec.json'), { component: c.label || child, machineName: c.machineName, source: { sourceRef: c.sourceRef ?? null }, path: spec.path, verificationUrl: spec.verificationUrl, linkUrl: spec.linkUrl, rootSelector: `[data-design-lab-child="${child}"]`, derivedFrom: parent, measurements: derived });
      rowsByChild.set(child, rows);
    }
  }
  return rowsByChild;
}
