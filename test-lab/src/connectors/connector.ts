// Source connectors (plan §3, 2026-10-18 "Source"). The core reads cases only through this interface,
// so moving off TestRail means writing a new connector, not changing the core. Every connector is
// read-only; none can publish a result or set a case field.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { fetchSnapshot, validateSnapshot, type SourceSnapshot } from '../source.ts';

export type RawCase = Record<string, unknown>;
export type Priority = { id: number; name: string };

export interface SourceConnector {
  /** Stable name recorded in every snapshot index: which connector produced it. */
  readonly name: string;
  /** Where the data came from, without credentials: helper path and version, or a responses file. */
  readonly origin: string;
  priorities(): Promise<Priority[]>;
  /** The whole project, every page of every suite, or an error: never a partial snapshot. */
  snapshot(): Promise<SourceSnapshot>;
  case(id: number): Promise<RawCase>;
}

/** Read-only endpoints a connector may request. Anything else is refused before any process starts. */
const READ_ONLY = /^get_(?:priorities|suites\/\d+|cases\/\d+&suite_id=\d+&limit=250&offset=\d+|case\/\d+)$/;
export function readOnlyEndpoint(endpoint: string): string {
  if (!READ_ONLY.test(endpoint)) throw new Error(`connector refuses endpoint ${JSON.stringify(endpoint)}: not one of the read-only reads it needs`);
  return endpoint;
}

function object(value: unknown, label: string): RawCase {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as RawCase;
}
function priorities(value: unknown): Priority[] {
  if (!Array.isArray(value)) throw new Error('get_priorities must return an array');
  return value.map((x) => {
    const p = object(x, 'priority');
    if (typeof p['id'] !== 'number' || typeof p['name'] !== 'string') throw new Error('priority needs a numeric id and a name');
    return { id: p['id'], name: p['name'] };
  });
}

/** The connector over any request function. Both concrete connectors are this plus a transport. */
export function requestConnector(name: string, origin: string, project: number, request: (endpoint: string) => Promise<unknown>, now?: () => Date): SourceConnector {
  const guarded = (endpoint: string) => request(readOnlyEndpoint(endpoint));
  return {
    name, origin,
    priorities: async () => priorities(await guarded('get_priorities')),
    snapshot: () => fetchSnapshot({ project, request: guarded, ...(now === undefined ? {} : { now }) }),
    async case(id) {
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('case id must be a positive integer');
      const raw = object(await guarded(`get_case/${id}`), 'case');
      if (raw['id'] !== id) throw new Error(`get_case/${id} returned case ${String(raw['id'])}`);
      return raw;
    },
  };
}

/** lib:testrail's helper declares its plugin version beside its skill; 1.4.2 is the reviewed read path. */
export function helperVersion(helper: string): string {
  const manifest = join(dirname(helper), '../../../.claude-plugin/plugin.json');
  if (!existsSync(manifest)) throw new Error(`no lib plugin manifest beside ${helper}; pass the helper from an installed lib:testrail`);
  const value = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown; version?: unknown };
  if (value.name !== 'lib' || typeof value.version !== 'string') throw new Error('the helper does not belong to the lib plugin');
  const [major, minor, patch] = value.version.split('.').map(Number) as [number, number, number];
  if (!(major > 1 || (major === 1 && (minor > 4 || (minor === 4 && patch >= 2))))) throw new Error(`lib ${value.version} predates the reviewed read-only helper (1.4.2)`);
  return value.version;
}

/**
 * TestRail through lib:testrail's own helper. Credentials stay in lib: this process passes only the
 * endpoint, the account name and the project, by argument vector, and reads JSON from stdout. The
 * helper's stderr (account and login, never secrets) is kept for the caller's diagnostics.
 */
export function testrailConnector(input: { helper: string; account: string; project: number; python?: string; timeoutMs?: number }): SourceConnector {
  if (!isAbsolute(input.helper) || !existsSync(input.helper)) throw new Error('--helper must be the absolute path of lib:testrail scripts/testrail.py');
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(input.account)) throw new Error('invalid account name');
  const version = helperVersion(input.helper);
  const request = (endpoint: string) => new Promise<unknown>((done, fail) => {
    execFile(input.python ?? 'python3', [input.helper, endpoint, '--account', input.account, '--project', String(input.project)],
      { timeout: input.timeoutMs ?? 120_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
      (error, stdout, stderr) => {
        if (error) { fail(new Error(`lib:testrail ${endpoint} failed: ${String(stderr).trim().split('\n').at(-1) ?? error.message}`)); return; }
        try { done(JSON.parse(stdout) as unknown); } catch { fail(new Error(`lib:testrail ${endpoint} returned invalid JSON`)); }
      });
  });
  return requestConnector('testrail', `lib:testrail ${version} (${input.helper}), account ${input.account}`, input.project, request);
}

/** Recorded responses, keyed by endpoint: for tests and offline replays. Unrecorded endpoints fail. */
export function fileConnector(file: string, project: number, now?: () => Date): SourceConnector {
  const path = resolve(file);
  const value = object(JSON.parse(readFileSync(path, 'utf8')) as unknown, 'responses');
  if (value['schema'] !== 1 || value['source'] !== 'testrail') throw new Error('responses file needs schema 1 and source testrail');
  const responses = object(value['responses'], 'responses');
  const request = async (endpoint: string) => {
    if (!Object.hasOwn(responses, endpoint)) throw new Error(`no recorded response for ${endpoint}`);
    return structuredClone(responses[endpoint]);
  };
  return requestConnector('file', `recorded responses ${path}`, project, request, now);
}

export function checkedSnapshot(value: unknown): SourceSnapshot { return validateSnapshot(value); }
