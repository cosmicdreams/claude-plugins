// Canonical JSON and hashing. Every hash test-lab records is taken over canonical JSON, so the same
// value always hashes the same way whatever order its keys were written in.

import { createHash } from 'node:crypto';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** JSON with object keys sorted at every depth. `undefined` fields are dropped, as JSON.stringify does. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const field = (value as Record<string, unknown>)[key];
      if (field !== undefined) out[key] = sortKeys(field);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`cannot hash a non-finite number: ${value}`);
  return value;
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `sha256:<hex>` over the canonical JSON of a value. */
export function hashOf(value: unknown): string {
  return `sha256:${sha256(canonicalJson(value))}`;
}
