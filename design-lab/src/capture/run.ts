import { existsSync, readFileSync, readdirSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Spec } from '../generated/spec.ts';
import { canonicalJson, roundEven } from '../json.ts';
import { writeJson } from '../contracts.ts';
import { launchBrowser, measureConfig, captureConfig, MEASURE_VIEWPORTS } from './browser.ts';
import { checkSelectors } from './selectors.ts';
import { pool, isolated } from './pool.ts';
import type { ContextFactory } from './pool.ts';
import { registerCapture } from './register.ts';
import { assembleEvidence } from './evidence.ts';
import type { CaptureConfig, CaptureRecord, CaptureRow } from './types.ts';
import type { Component, ComponentDocument } from './scaffold.ts';
import { deriveChildren } from './derive.ts';
import { enabled, rendersWithin } from './twig.ts';
import { fetchImage } from '../fetch-images.ts';
import { scaffold } from './scaffold.ts';
export const stem = (id: string): string => id.replaceAll(':', '__').replaceAll('/', '__');
export function configHash(cfg: CaptureConfig, scale: number): string {
  const keyed = { ...cfg, states: (cfg.states ?? []).map(state => Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'setup' || !('setupKey' in state)))) };
  return digest(keyed, scale);
}
export function legacyHash(cfg: CaptureConfig, scale: number): string {
  const plain = { ...cfg, states: (cfg.states ?? []).map(state => Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'setupKey'))) };
  return digest(plain, scale);
}
// argparse parses screenshot scale as a float: baseline serializes 1 as 1.0 here.
function digest(cfg: unknown, scale: number): string {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('scale must be positive and finite');
  let value = scale < 1e-4 || scale >= 1e16 ? scale.toExponential() : String(scale);
  if (value.includes('e')) value = value.replace(/e([+-]?)(\d+)$/, (_all, sign: string, exponent: string) => 'e' + (sign || '+') + exponent.padStart(2, '0'));
  else if (Number.isInteger(scale)) value += '.0';
  return createHash('sha256').update('[' + canonicalJson(cfg) + ', ' + value + ']').digest('hex');
}
export function candidatePages(cfg: Pick<CaptureConfig, 'path'>, component: Component, limit: number): string[] {
  const paths = [cfg.path];
  for (const key of ['examples', 'renderedExamples', 'exampleCandidates'] as const) for (const example of component.usage?.[key] ?? []) {
    const path = typeof example === 'string' ? example : example.path;
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths.slice(0, limit);
}
export function measurementFailures(spec: Spec, config: CaptureConfig): string[] {
  const expected = (config.viewports ?? MEASURE_VIEWPORTS).map(v => `${v.name}:default`);
  return [...new Set([...expected.filter(k => !spec.measurements[k]), ...Object.entries(spec.measurements).filter(([, v]) => 'error' in v).map(([k]) => k)])];
}
export function readRecord(path: string): CaptureRecord | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as CaptureRecord; } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export interface CaptureOptions {
  project: string; canonicalBaseUrl: string; siteUrl?: string; themeRoot?: string; configs?: CaptureConfig[];
  concurrency?: number; scale?: number; only?: string[]; fresh?: boolean; check?: boolean; noCheck?: boolean; maxPages?: number;
  measureTimeoutMs?: number; captureTimeoutMs?: number;
}
export interface CaptureAdapters {
  launch: typeof launchBrowser; measure: typeof measureConfig; capture: typeof captureConfig; check: typeof checkSelectors;
}
/** One browser for selector checks, measurements and screenshots; isolated contexts per item. */
export async function runCapture(options: CaptureOptions, adapters: CaptureAdapters = { launch: launchBrowser, measure: measureConfig, capture: captureConfig, check: checkSelectors }) {
  const project = resolve(options.project), capture = resolve(project, 'capture'), measurements = resolve(capture, 'measurements'), shots = resolve(capture, 'shots'), records = resolve(capture, 'records'), configsDir = resolve(capture, 'configs');
  for (const folder of [measurements, shots, records, configsDir]) mkdirSync(folder, { recursive: true });
  const scale = options.scale ?? 1, limit = options.concurrency ?? 4, maxPages = options.maxPages ?? 3;
  const doc = existsSync(resolve(project, 'components.json')) ? JSON.parse(readFileSync(resolve(project, 'components.json'), 'utf8')) as ComponentDocument : {};
  const byId = new Map((doc.components ?? []).map(c => [c.id, c]));
  const proposed = options.configs ?? scaffold(doc, { siteUrl: options.siteUrl, canonicalBaseUrl: options.canonicalBaseUrl, themeRoot: options.themeRoot });
  const problems: Record<string, string> = {}, ready: { cfg: CaptureConfig; digest: string; path: string }[] = [];
  if (options.only) for (const id of options.only) if (!byId.has(id) && !proposed.some(c => c.componentId === id)) throw new Error('unknown component id: ' + id);
  for (const cfg of proposed) {
    const id = cfg.componentId, component = byId.get(id);
    if (component?.globallyExcluded || component?.excluded || component?.usage?.globallyExcluded || component?.usage?.excluded) continue;
    if (!cfg.path || !cfg.verificationUrl) { problems[id] = 'Not built — no visual evidence'; continue; }
    if (!cfg.rootSelector) { problems[id] = 'no root selector'; continue; }
    const complete = cfg as CaptureConfig, path = resolve(configsDir, stem(id) + '.json');
    writeJson(path, complete);
    ready.push({ cfg: complete, digest: configHash(complete, scale), path });
  }
  const pending = ready.filter(({ cfg, digest }) => {
    const path = resolve(records, stem(cfg.componentId) + '.json');
    const selected = !options.only || options.only.includes(cfg.componentId);
    if (selected && options.fresh && !options.check) rmSync(path, { force: true });
    // Selector checks must not migrate, replace or create capture records.
    if (options.check) return selected;
    const record = readRecord(path);
    if (record && record.configHash !== digest && record.configHash === legacyHash(cfg, scale)) { record.configHash = digest; writeJson(path, record); }
    if (!selected) return false;
    return options.check || record?.status !== 'complete' || record.configHash !== digest;
  });
  const checks: Awaited<ReturnType<typeof checkSelectors>>[] = [];
  if (pending.length) {
    const browser = await adapters.launch();
    try {
      await pool(pending, limit, async ({ cfg: original, digest, path }) => {
        const start = performance.now(), id = original.componentId;
        let cfg = original, measureMs = 0, captureMs = 0, spec: Spec | undefined;
        const record: CaptureRecord = { componentId: id, configHash: digest, status: 'failed', problems: [], rows: [], seconds: 0, measureMs, captureMs, durationMs: 0 };
        try {
          const paths = candidatePages(cfg, byId.get(id) ?? { id }, maxPages);
          let candidates = paths;
          if (!options.noCheck) {
            const result = await isolated(browser, options.captureTimeoutMs ?? 1800000, scoped => adapters.check(scoped, {
              componentId: id, rootSelector: cfg.rootSelector, setup: cfg.states?.[0]?.setup, anchorText: cfg.anchorText, mustContain: cfg.mustContain,
              pages: paths.map(page => ({ path: page, verificationUrl: move(cfg, page, options).verificationUrl })),
            }));
            checks.push(result); writeJson(resolve(capture, 'selector-check.json'), checks);
            if (!result.chosen) record.problems.push('selector not found on candidate pages');
            else { candidates = [result.chosen]; if (result.revealed) record.revealed = true; }
          }
          if (options.check) return record;
          if (!record.problems.length) {
            const measureStarted = performance.now();
            let failures = ['measure.mjs'];
            for (const candidate of candidates) {
              cfg = move(original, candidate, options);
              for (let attempt = 0; attempt < 2; attempt++) {
                try { spec = await isolated(browser, options.measureTimeoutMs ?? 900000, scoped => adapters.measure(scoped, cfg)); failures = measurementFailures(spec, cfg); break; }
                catch (error) { failures = ['measure.mjs']; if (attempt === 1) record.problems = ['measurement failed: ' + String(error).slice(0, 240)]; }
              }
              if (!failures.length) { record.problems = []; break; }
            }
            record.path = cfg.path; writeJson(path, cfg);
            if (spec) writeJson(resolve(measurements, stem(id) + '.spec.json'), spec);
            if (failures.length && !record.problems.length) record.problems.push('measurement failed: ' + failures.sort().join(', '));
            measureMs = performance.now() - measureStarted;
            const shotStarted = performance.now(), work = resolve(shots, '.work', stem(id));
            rmSync(work, { force: true, recursive: true }); mkdirSync(work, { recursive: true });
            let rows: CaptureRow[] = [];
            for (let attempt = 0; attempt < 2; attempt++) {
              try { rows = await isolated(browser, options.captureTimeoutMs ?? 1800000, scoped => adapters.capture(scoped, cfg, work, scale)); }
              catch (error) { rows = [{ componentId: id, machine: cfg.machineName, viewport: '', error: String(error) }]; }
              if (!rows.some(r => r.error)) break;
            }
            for (const row of rows) if (row.file) {
              const name = stem(id) + row.file.slice(cfg.machineName.length);
              renameSync(resolve(work, row.file), resolve(shots, name)); row.file = name;
            }
            rmSync(work, { force: true, recursive: true }); record.rows = rows;
            record.problems.push(...rows.filter(r => r.error).map(r => `capture failed at ${r.viewport || '?'} (${r.state || 'default'}): ${r.error}`));
            const observed = new Set(rows.filter(r => !r.error && r.state === 'default').map(r => r.viewport.toLowerCase()));
            const missing = (cfg.viewports ?? MEASURE_VIEWPORTS).map(v => v.name.toLowerCase()).filter(v => !observed.has(v)).sort();
            if (missing.length) record.problems.push('default capture missing: ' + missing.join(', '));
            captureMs = performance.now() - shotStarted;
            if (!record.problems.length) record.status = 'complete';
          }
        } catch (error) {
          const detail = String(error).slice(0, 240);
          record.problems.push('capture item failed: ' + detail);
          if (options.check || !options.noCheck && !checks.some(c => c.componentId === id)) {
            checks.push({componentId:id,chosen:null,revealed:false,seconds:(performance.now()-start)/1000,pages:[{path:original.path,error:detail,seconds:(performance.now()-start)/1000}]});
            writeJson(resolve(capture, 'selector-check.json'), checks);
          }
        } finally {
          record.durationMs = performance.now() - start;
          record.seconds = roundEven(record.durationMs / 100) / 10;
          record.measureMs = measureMs; record.captureMs = captureMs;
          if (!options.check) writeJson(resolve(records, stem(id) + '.json'), record);
        }
        return record;
      });
    } finally { await browser.close(); }
  }
  if (options.check) return { checks, captures: {}, problems: checks.filter(c => !c.chosen).map(c => ({ componentId: c.componentId, detail: c.pages.find(p => p.error)?.error ?? 'selector not found' })) };
  const rows: CaptureRow[] = [];
  for (const { cfg, digest } of ready) {
    const record = readRecord(resolve(records, stem(cfg.componentId) + '.json'));
    if (!record || record.configHash !== digest) { problems[cfg.componentId] = 'not captured yet'; continue; }
    rows.push(...record.rows.filter(r => !r.error));
    if (record.problems.length) problems[cfg.componentId] = record.problems.join('; ');
  }
  const eligible = new Set([...byId].filter(([, c]) => !(c.globallyExcluded || c.excluded || c.usage?.globallyExcluded || c.usage?.excluded)).map(([id]) => id));
  for (const [child, derived] of await deriveChildren(byId, eligible, ready, records, measurements, shots, scale)) { rows.push(...derived); delete problems[child]; }
  const relationships: Record<string, unknown> = {};
  for (const { cfg } of ready) {
    const children = [...new Set((byId.get(cfg.componentId)?.slots ?? []).flatMap(s => s.accepts ?? []).filter(c => c.includes(':') && !c.startsWith('sdc.')))].sort();
    const record = readRecord(resolve(records, stem(cfg.componentId) + '.json'));
    if (!children.length || !record?.path) continue;
    let html = ''; try { html = (await fetchImage(move(cfg, record.path, options).verificationUrl, 1)).data.toString('utf8'); } catch { continue; }
    if (enabled(html)) relationships[cfg.componentId] = { page: record.path, ...rendersWithin(html, cfg.componentId, children) };
  }
  writeJson(resolve(capture, 'relationships.json'), relationships);
  const index = resolve(shots, 'index.json'); writeJson(index, rows);
  const evidence = assembleEvidence(index, rows, options.canonicalBaseUrl);
  for (const problem of evidence.problems) problems[problem.componentId!] = [problems[problem.componentId!], problem.detail].filter(Boolean).join('; ');
  evidence.problems = Object.entries(problems).sort(([a], [b]) => a < b ? -1 : 1).map(([componentId, detail]) => ({ componentId, detail }));
  writeJson(resolve(project, 'capture-evidence.json'), evidence);
  registerCapture(project);
  return evidence;
}
function move(cfg: CaptureConfig, path: string, options: CaptureOptions): CaptureConfig {
  return { ...cfg, path, verificationUrl: (options.siteUrl ?? new URL(cfg.verificationUrl).origin).replace(/\/+$/, '') + '/' + path.replace(/^\/+/, ''),
    linkUrl: options.canonicalBaseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '') };
}
