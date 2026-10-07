/** Read-only adapters for the verification inputs assembled by the baseline workflow. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import type { Component } from './build-artifacts.ts';

export type JsonObject = Record<string, any>;
export const readJson = <T = JsonObject>(path?: string): T | null => path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : null;
export const readDirJson = (folder?: string): { path: string; name: string; value: JsonObject }[] => !folder || !existsSync(folder) ? [] : readdirSync(folder).filter(n => n.endsWith('.json')).sort().map(name => { const path = resolve(folder, name); try { return { path, name, value: JSON.parse(readFileSync(path, 'utf8')) as JsonObject }; } catch { return { path, name, value: {} }; } });

export function mergeVerifyState(folder: string): JsonObject {
  const state = readJson<JsonObject>(resolve(folder, 'root.json')) ?? {};
  const project = resolve(folder, '..', '..');
  const variablePlan = readJson<JsonObject>(resolve(project, 'variable-plan.json'));
  const reason = variablePlan?.collectionStrategy?.reason;
  if (reason && (state.collections ?? []).length > 1) state.collectionStrategyReason = reason + '; separate collections are reserved for an independent mode boundary';
  const run = readJson<JsonObject>(resolve(project, 'project.json'))?.run;
  if (!state.brand) state.brand = String(run?.siteLabel ?? '').trim() || null;
  const lists = ['components', 'cards', 'breakpointFrames', 'exampleInvalidNodes'];
  for (const key of lists) state[key] ??= [];
  const children: Record<string, unknown> = {};
  for (const { name, value } of readDirJson(folder).filter(x => /^page-.*\.json$/.test(x.name))) {
    for (const key of lists) state[key].push(...(value[key] ?? []));
    if (value.breakpointCollection && !state.breakpointCollection) state.breakpointCollection = value.breakpointCollection;
    const page = value.page ?? {}; children[page.id] = page.children;
  }
  for (const page of state.pages ?? []) if (page.id in children) page.children = children[page.id];
  const started = readJson<JsonObject>(resolve(folder, 'getting-started.json'));
  if (started) Object.assign(state, started);
  return state;
}

/** Build the same accepted desktop measurement map as verify_inputs.ts. */
export function buildMeasurements(project: string, componentInput?: Component[]): JsonObject {
  const components = componentInput ?? readJson<{ components: Component[] }>(resolve(project, 'components.json'))?.components ?? [];
  const folder = resolve(project, 'capture/measurements'), out: JsonObject = {};
  for (const component of components) {
    const qualified = component.id.replace(/[:/]/g, '__') + '.spec.json';
    const candidates = [resolve(folder, qualified), resolve(folder, (component.machineName || component.id.split(':').at(-1)) + '.spec.json')];
    const path = candidates.find(existsSync); if (!path) continue;
    const spec = readJson<JsonObject>(path)!;
    const source = spec.source?.sourceRef;
    if (source && component.sourceRef && source !== component.sourceRef) continue;
    const measurement = spec.measurements?.['desktop:default'];
    if (measurement && !measurement.error && measurement.nodes?.length) out[component.id] = measurement;
  }
  return out;
}

export const inputBasename = basename;
export const inputDirname = dirname;
