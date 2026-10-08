/** Typed views of writer extension fields used by the deterministic build. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeJson } from './contracts.ts';
import type { ArtifactKind, ArtifactMap } from './contracts.ts';
import { sorted } from './json.ts';
import type { Components } from './generated/components.ts';
import type { Plan } from './generated/plan.ts';
import type { FigmaState } from './generated/figma-state.ts';
import type { StepResult } from './generated/step-result.ts';
export interface Usage {
  tier?: string;
  placements?: number | null;
  structuralRefs?: number | null;
  structuralReferences?: number | null;
  renderedPages?: number;
  globalTemplate?: boolean;
  status?: string;
  examples?: (string | { path: string })[];
  renderedExamples?: (string | { path: string })[];
  exampleCandidates?: (string | { path: string })[];
  templateRefs?: (string | { file: string; line?: number })[];
}
type Declared<T> = { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] };
export type Component = Omit<Declared<Components['components'][number]>, 'fields' | 'slots'> & {
  group?: string;
  description?: string;
  sourceSdcId?: string;
  usage?: Usage;
  contains?: string[];
  containedBy?: string[];
  _capturePath?: string;
  fields: (Components['components'][number]['fields'][number] & {
    name: string;
    kind: string;
    options?: { value: string; label?: string }[] | null;
  })[];
  slots: (Components['components'][number]['slots'][number] & { name: string })[];
};
export type ComponentPlan = Plan['plans'][number] & { refuseReason?: string };
export type BuildState = Extract<FigmaState, { steps: unknown }>;
export type GeometryBox = { label?: string; x: number; y: number; width: number; height: number };
export type Geometry = {
  variants?: GeometryBox[];
  captures?: GeometryBox[];
  specimen?: { width: number; height: number };
};
export interface NativeMeasurement {
  nodeType?: string;
  rootHasImageFill?: boolean;
  nestedInstances?: { sourceId?: string; instanceId?: string }[];
  documentedFields?: string[];
}
export type BuildResult = Omit<Declared<StepResult>, 'native' | 'geometry'> & {
  native?: NativeMeasurement;
  geometry?: Geometry;
  metric?: string;
};
export function load<T>(project: string, name: string, fallback?: T): T {
  const path = resolve(project, name);
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error('missing artifact: ' + path);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
export function readOptional<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}
export function jsonFiles(folder: string): string[] {
  return existsSync(folder)
    ? readdirSync(folder)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => resolve(folder, f))
    : [];
}
export function writeOnChange(path: string, value: unknown): boolean {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;
  writeJson(path, value);
  return true;
}
/** The artifact write of a deterministic build: the value is the generated type for `kind`. */
export function writeArtifactOnChange<K extends ArtifactKind>(_kind: K, path: string, value: ArtifactMap[K]): boolean {
  return writeOnChange(path, value);
}
export const safe = (step: string): string => step.replace(/[^A-Za-z0-9_.-]+/g, '_');
export const result = (project: string, step: string): BuildResult => load(project, `figma/results/${safe(step)}.json`);
export const nullable = <T>(value: T | undefined): T | null => (value === undefined ? null : value);
export const keyOf = (value: unknown): string => JSON.stringify(sorted(value));
export function slotAccepts(value?: string | string[]): string[] {
  const items = [
    ...new Set(
      (typeof value === 'string' ? [value] : (value ?? [])).filter(Boolean).map((v) => (v === 'any' ? '*' : v)),
    ),
  ].sort();
  return items.length ? items : ['*'];
}
