import { policyErrors } from './artifact-policy.ts';
import { readFileSync, readdirSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pluginRoot, sharedRequire } from './runtime.ts';
import type { ValidateFunction, ErrorObject } from 'ajv';
import type { ArtifactMap } from './generated/artifacts.ts';
export type { ArtifactMap } from './generated/artifacts.ts';
export type ArtifactKind = keyof ArtifactMap;
// Setup and atomic JSON writes work before the first dependency install.
let instance: InstanceType<typeof import('ajv/dist/2020.js').Ajv2020> | undefined;
function schemaValidator() {
  if (!instance) {
    const { Ajv2020 } = sharedRequire()('ajv/dist/2020.js') as typeof import('ajv/dist/2020.js');
    instance = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
    for (const kind of artifactKinds) instance.addSchema(JSON.parse(readFileSync(resolve(schemaFolder, `${kind}.schema.json`), 'utf8')) as object, kind);
  }
  return instance;
}
const schemaFolder = resolve(pluginRoot, 'schemas');
export const artifactKinds = readdirSync(schemaFolder).filter(name => name.endsWith('.schema.json'))
  .map(name => name.replace('.schema.json', '') as ArtifactKind).sort();
const validators = new Map<ArtifactKind, ValidateFunction>();
function describe(error: ErrorObject): string {
  let path = error.instancePath || '/';
  if (error.keyword === 'required') path = `${error.instancePath}/${String(error.params['missingProperty'])}`;
  if (error.keyword === 'additionalProperties') path = `${error.instancePath}/${String(error.params['additionalProperty'])}`;
  return `${path}: ${error.message ?? error.keyword}`;
}
/** Matches baseline's error-list API, with kind first and JSON Pointer paths. Never mutates input. */
export function validate<K extends ArtifactKind>(kind: K, value: unknown): string[] {
  if (!artifactKinds.includes(kind)) return [`unsupported artifact kind: ${kind}`];
  let validator = validators.get(kind);
  if (!validator) { validator = schemaValidator().getSchema(kind)!; validators.set(kind, validator); }
  const errors = validator(value) ? [] : (validator.errors ?? []).map(describe);
  return [...errors, ...policyErrors(kind, value)];
}
export function assertValid<K extends ArtifactKind>(kind: K, value: unknown): asserts value is ArtifactMap[K] {
  const errors = validate(kind, value);
  if (errors.length) throw new Error(`${kind}:\n${errors.join('\n')}`);
}
export type RecordKind = 'use_figma' | 'upload' | 'screenshot' | 'check' | 'dump' | 'skip';
export type DumpKind = 'root' | 'tree' | 'page' | 'getting-started';
/** The body has no discriminator: only the server's pending step selects its contract. */
export function validateRunnerRecord(kind: RecordKind, value: unknown, dump: DumpKind = 'root'): string[] {
  const definition = kind === 'upload' ? 'UploadResult' : kind === 'screenshot' ? 'Screenshot' : kind === 'skip' ? 'EmptySkip'
    : kind === 'check' ? 'Check' : kind === 'dump'
      ? ({ root: 'RootDump', tree: 'TreeDump', page: 'PageDump', 'getting-started': 'GettingStartedDump' } as const)[dump]
      : 'BuildResult';
  const validator = schemaValidator().getSchema(`https://design-lab.local/schemas/runner-record.schema.json#/$defs/${definition}`)!;
  return validator(value) ? [] : (validator.errors ?? []).map(describe);
}
/** Serialize before touching disk, fsync a private sibling file, then atomically replace. */
export function writeJson(path: string, value: unknown): string {
  const payload = JSON.stringify(value, null, 2);
  if (payload === undefined) throw new TypeError('value is not JSON serializable');
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = resolve(dirname(target), `.${basename(target)}.${randomUUID()}`);
  let fd: number | undefined;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, payload + '\n', 'utf8');
    fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, target);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (cleanup) {
      if ((cleanup as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanup;
    }
    throw error;
  }
  return path;
}
