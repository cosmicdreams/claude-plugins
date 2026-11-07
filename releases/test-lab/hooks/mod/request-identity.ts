// Shared by the SDK-only mod and Node core. Values enter the digest, never the persisted identity.
export type RequestContext = {
  operation: 'run' | 'preflight' | 'verify'; appRoot: string; suiteRoot: string;
  environment: string; work: string | null; noWork: boolean;
};
export type RequestIdentity = {
  schema: 1; operationId: string; requestHash: string; inputsHash: string; context: RequestContext;
};
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export async function inputHash(inputs: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(inputs));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function identityOf(operationId: string, cli: readonly string[], deadlineMs: number, context: RequestContext, inputs: unknown): Promise<RequestIdentity> {
  const inputsHash = await inputHash(inputs);
  return { schema: 1, operationId, inputsHash, context: { ...context }, requestHash: await inputHash({ operationId, cli, deadlineMs, context, inputsHash }) };
}
export function parseIdentity(value: unknown): RequestIdentity | null {
  if (!object(value) || value['schema'] !== 1 || Object.keys(value).length !== 5 || typeof value['operationId'] !== 'string' || !/^[A-Za-z0-9-]+$/.test(value['operationId'])) return null;
  for (const key of ['requestHash', 'inputsHash']) if (typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/.test(value[key])) return null;
  const c = value['context'];
  if (!object(c) || Object.keys(c).length !== 6 || !['run', 'preflight', 'verify'].includes(String(c['operation']))) return null;
  for (const key of ['appRoot', 'suiteRoot']) if (typeof c[key] !== 'string' || !c[key].startsWith('/') || c[key].includes('\0') || c[key].split('/').includes('..')) return null;
  if (typeof c['environment'] !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(c['environment']) || typeof c['noWork'] !== 'boolean') return null;
  if (c['work'] !== null && (typeof c['work'] !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(c['work']))) return null;
  if (c['work'] !== null && c['noWork'] === true) return null;
  return value as unknown as RequestIdentity;
}
export const sameIdentity = (a: RequestIdentity | null, b: RequestIdentity | null): boolean => a !== null && b !== null && canonical(a) === canonical(b);
