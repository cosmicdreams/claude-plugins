// Invocation-owned, explicitly nonsecret behavior inputs. No ambient environment is consulted here.
// The preload observes values before config/spec loading; the reporter persists only named bindings.
import { createHash } from 'node:crypto';

export const ENVIRONMENT_INPUTS_VERSION = 1;
export const ENVIRONMENT_INPUTS_ENV = 'TEST_LAB_ENVIRONMENT_INPUTS';
export const ENVIRONMENT_INPUTS_DIR = 'environment-inputs';
export type EnvironmentInputDeclaration = { name: string; classification: 'nonsecret'; readers: string[] };
export type EnvironmentInputValue = { state: 'unset' } | { state: 'set'; value: string };
export type EnvironmentBinding = { name: string; state: 'unset' } | { name: string; state: 'set'; hash: string };
export type EnvironmentProcess = { pid: number; bindings: EnvironmentBinding[]; changed: string[]; closed: boolean };
export type EnvironmentInputObservation = {
  version: 1; invocation: string; phase: 'begin' | 'complete';
  declarations: EnvironmentInputDeclaration[]; bindings: EnvironmentBinding[];
  processes: EnvironmentProcess[]; workers: number; problems: string[];
};
export type EnvironmentInputRequest = { version: 1; invocation: string; declarations: EnvironmentInputDeclaration[]; values: Record<string, EnvironmentInputValue> };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const forbidden = /SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|PRIVATE_KEY|API_KEY/;
const reserved = /^(TEST_LAB_|PLAYWRIGHT_|NODE_)|^(PATH|HOME|USER|SHELL|TMPDIR)$/;

/** Serialization is untrusted. Exact source paths, explicit classification, no wildcard authority. */
export function declarationProblems(value: unknown): string[] {
  if (!Array.isArray(value)) return ['environment input declarations must be an array'];
  const problems: string[] = [], seen = new Set<string>();
  for (const d of value) {
    if (!object(d) || !keys(d, ['name', 'classification', 'readers']) || typeof d['name'] !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(d['name']) || forbidden.test(d['name']) || reserved.test(d['name']) || d['classification'] !== 'nonsecret' || !strings(d['readers']) || d['readers'].length === 0 || new Set(d['readers']).size !== d['readers'].length || d['readers'].some(p => !/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:[cm]?[jt]sx?)$/.test(p) || p.split('/').some(s => s === '.' || s === '..'))) {
      problems.push('invalid nonsecret environment declaration or source reader scope'); continue;
    }
    if (seen.has(d['name'])) problems.push(`duplicate environment declaration ${d['name']}`);
    seen.add(d['name']);
  }
  return problems;
}
export function canonicalDeclarations(d: EnvironmentInputDeclaration[]): EnvironmentInputDeclaration[] {
  return d.map(x => ({ name: x.name, classification: x.classification, readers: [...x.readers].sort() })).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
export function valueProblems(declarations: EnvironmentInputDeclaration[], values: unknown): string[] {
  if (!object(values)) return ['environment input values must be an explicit object'];
  const names = declarations.map(d => d.name), problems: string[] = [];
  if (Object.keys(values).length !== names.length || Object.keys(values).some(n => !names.includes(n))) problems.push('environment input values must match declared names exactly');
  for (const name of names) {
    const v = values[name];
    if (!object(v) || !(v['state'] === 'unset' && keys(v, ['state']) || v['state'] === 'set' && keys(v, ['state','value']) && typeof v['value'] === 'string' && !v['value'].includes('\0'))) problems.push(`missing or invalid invocation value for ${name}`);
  }
  return problems;
}
export function bindingsOf(declarations: EnvironmentInputDeclaration[], values: Record<string, EnvironmentInputValue>): EnvironmentBinding[] {
  return canonicalDeclarations(declarations).map(d => {
    const v = values[d.name]!;
    return v.state === 'unset' ? { name: d.name, state: 'unset' } : { name: d.name, state: 'set', hash: createHash('sha256').update(v.value).digest('hex') };
  });
}
export function sameBindings(a: EnvironmentBinding[], b: EnvironmentBinding[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function validBindings(v: unknown, declarations: EnvironmentInputDeclaration[]): v is EnvironmentBinding[] {
  if (!Array.isArray(v) || v.length !== declarations.length) return false;
  return v.every((b,i) => object(b) && b['name'] === canonicalDeclarations(declarations)[i]?.name && (b['state'] === 'unset' && keys(b,['name','state']) || b['state'] === 'set' && keys(b,['name','state','hash']) && typeof b['hash'] === 'string' && /^[a-f0-9]{64}$/.test(b['hash'])));
}
export function validProcess(v: unknown, d: EnvironmentInputDeclaration[]): v is EnvironmentProcess {
  return object(v) && keys(v,['pid','bindings','changed','closed']) && count(v['pid']) && validBindings(v['bindings'],d) && strings(v['changed']) && v['changed'].every(n => d.some(x => x.name === n)) && typeof v['closed'] === 'boolean';
}
export function validObservation(v: unknown): v is EnvironmentInputObservation {
  return object(v) && keys(v,['version','invocation','phase','declarations','bindings','processes','workers','problems']) && v['version'] === 1 && typeof v['invocation'] === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(v['invocation']) && (v['phase'] === 'begin' || v['phase'] === 'complete') && declarationProblems(v['declarations']).length === 0 && validBindings(v['bindings'],v['declarations'] as EnvironmentInputDeclaration[]) && Array.isArray(v['processes']) && v['processes'].every(p => validProcess(p,v['declarations'] as EnvironmentInputDeclaration[])) && count(v['workers']) && strings(v['problems']);
}
/** Before source loading only the open coordinator is observed; workers have not run yet. */
export function beginObservationProblems(o: EnvironmentInputObservation): string[] {
  const problems = [...o.problems];
  if (o.phase !== 'begin') problems.push('invalid environment input begin phase');
  if (o.workers !== 0 || o.processes.length !== 1) problems.push('missing or conflicting pre-load coordinator environment observation');
  for (const p of o.processes) {
    if (p.closed || !sameBindings(p.bindings,o.bindings) || p.changed.length > 0) problems.push('environment input changed or coordinator was closed before begin');
  }
  return problems;
}
export function observationProblems(o: EnvironmentInputObservation): string[] {
  const problems = [...o.problems];
  if (o.phase !== 'complete') problems.push('environment invocation observations are incomplete');
  if (o.processes.length === 0 || new Set(o.processes.map(p => p.pid)).size !== o.processes.length || o.processes.length < o.workers + 1) problems.push('missing or duplicate environment process observations');
  for (const p of o.processes) {
    if (!p.closed || !sameBindings(p.bindings,o.bindings) || p.changed.length > 0) problems.push('environment input changed or process observation is incomplete');
  }
  return problems;
}
export function parseRequest(text: string): EnvironmentInputRequest {
  let r: unknown;
  try { r = JSON.parse(text); } catch { throw new Error('invalid nonsecret environment invocation request'); }
  if (!object(r) || !keys(r,['version','invocation','declarations','values']) || r['version'] !== 1 || typeof r['invocation'] !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(r['invocation']) || declarationProblems(r['declarations']).length > 0 || valueProblems(r['declarations'] as EnvironmentInputDeclaration[],r['values']).length > 0) throw new Error('invalid nonsecret environment invocation request');
  return r as EnvironmentInputRequest;
}
