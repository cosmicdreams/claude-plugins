// Read-only TestRail boundary. Authentication stays in lib:testrail; this module accepts its raw JSON
// pages and imports complete, dated snapshots as unapproved drafts. It never edits the required set.
import { readFile } from 'node:fs/promises';
import { hashOf } from './canonical.ts';
import type { CaseRecord } from './model.ts';
import { priorityOf, type PriorityMapping } from './priority.ts';

type ObjectValue = Record<string, unknown>;
export type Priority = { id: number; name: string };
export type SourceSuite = { id: number; cases: ObjectValue[] };
export type SourceSnapshot = {
  schema: 1;
  source: 'testrail';
  project: number;
  fetchedAt: string;
  complete: true;
  priorities: Priority[];
  suites: SourceSuite[];
};
export type SourceDraft = {
  record: CaseRecord;
  source: { project: number; suite: number; case: number; fetchedAt: string; rawHash: string };
  tier: PriorityMapping['tier'];
  /** From the instance's priority metadata: label number, never the stored id. */
  priority: PriorityMapping;
  mark: 'needs-review' | 'needs-work';
  problems: string[];
};

function object(value: unknown, label: string): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as ObjectValue;
}
function positiveId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error('snapshot fetchedAt must be an ISO timestamp with a timezone');
  return value;
}

/** No stale, undated or partial snapshot can silently become a fresh full corpus. */
export function validateSnapshot(value: unknown): SourceSnapshot {
  const v = object(value, 'snapshot');
  if (v['schema'] !== 1 || v['source'] !== 'testrail') throw new Error('unsupported TestRail snapshot schema');
  if (v['complete'] !== true) throw new Error('partial TestRail refresh: retain the previous complete snapshot');
  const project = positiveId(v['project'], 'project id');
  const priorities = list(v['priorities'], 'priorities').map((x) => {
    const p = object(x, 'priority');
    const name = text(p['name']);
    if (!name) throw new Error('priority name is missing');
    return { id: positiveId(p['id'], 'priority id'), name };
  });
  if (new Set(priorities.map((p) => p.id)).size !== priorities.length) throw new Error('duplicate priority id');
  const caseIds = new Set<number>();
  const suiteIds = new Set<number>();
  const suites = list(v['suites'], 'suites').map((x) => {
    const s = object(x, 'suite');
    const id = positiveId(s['id'], 'suite id');
    if (s['project_id'] !== undefined && s['project_id'] !== project) throw new Error(`suite ${id} belongs to another project`);
    if (suiteIds.has(id)) throw new Error('duplicate suite id');
    suiteIds.add(id);
    const cases = list(s['cases'], 'cases').map((c) => {
      const raw = object(c, 'case');
      const caseId = positiveId(raw['id'], 'case id');
      if (caseIds.has(caseId)) throw new Error(`duplicate case id ${caseId}`);
      caseIds.add(caseId);
      if (raw['suite_id'] !== undefined && raw['suite_id'] !== id) throw new Error(`case ${caseId} belongs to another suite`);
      if (raw['project_id'] !== undefined && raw['project_id'] !== project) throw new Error(`case ${caseId} belongs to another project`);
      return raw;
    });
    return { id, cases };
  });
  return { schema: 1, source: 'testrail', project, fetchedAt: timestamp(v['fetchedAt']), complete: true, priorities, suites };
}

export function snapshotProblem(snapshot: SourceSnapshot, now: Date, maxAgeHours: number): string | null {
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(maxAgeHours) || maxAgeHours < 0) return 'invalid snapshot freshness policy';
  const age = (now.getTime() - Date.parse(snapshot.fetchedAt)) / 3_600_000;
  if (!Number.isFinite(age) || age < 0) return 'snapshot fetch time is invalid or in the future';
  return age > maxAgeHours ? `TestRail snapshot is stale (${age.toFixed(1)} hours old; maximum ${maxAgeHours})` : null;
}

/** Preserve source prose; an owner approves its interpretation later, not during import. */
export function importSnapshot(snapshotValue: unknown): SourceDraft[] {
  const snapshot = validateSnapshot(snapshotValue);
  return snapshot.suites.flatMap((suite) => suite.cases.map((raw): SourceDraft => {
    const caseId = positiveId(raw['id'], 'case id');
    const problems: string[] = [];
    const title = text(raw['title']);
    if (!title) problems.push('missing title');
    const separated = raw['custom_steps_separated'];
    let sourceSteps: { content: string; expected: string }[];
    if (separated !== undefined && separated !== null && !Array.isArray(separated)) {
      problems.push('malformed separated steps need an explicit interpretation');
      sourceSteps = [];
    } else if (Array.isArray(separated) && separated.length > 0) {
      sourceSteps = separated.map((value) => {
        const step = object(value, `case ${caseId} step`);
        if (step['shared_step_id'] !== undefined || step['shared_steps'] !== undefined) problems.push('shared steps need an explicit interpretation');
        return { content: text(step['content']), expected: text(step['expected']) };
      });
    } else sourceSteps = [{ content: text(raw['custom_steps']), expected: text(raw['custom_expected']) }];
    if (raw['custom_shared_steps'] || raw['custom_parameters'] || raw['parameters']) problems.push('shared steps or parameter tables are not supported');
    for (const [index, step] of sourceSteps.entries()) {
      if (!step.content) problems.push(`step ${index + 1}: missing action`);
      if (!step.expected) problems.push(`step ${index + 1}: missing expected result`);
    }
    const refs = text(raw['refs']).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const priority = priorityOf(raw['priority_id'], snapshot.priorities);
    const tier = priority.tier;
    // Missing or vague expected results make a case "needs work". An Undefined priority does not: the case
    // can still be converted, but it is listed for QA and can never be required until QA assigns one.
    const mark: SourceDraft['mark'] = problems.length ? 'needs-work' : 'needs-review';
    if (priority.defaulted) problems.push(`priority is ${priority.label}: tagged @p3 by the standard's default, never required until QA assigns one`);
    return {
      record: {
        id: `C${caseId}`, aliases: [], track: 'regression', title, preconditions: text(raw['custom_preconds']),
        steps: sourceSteps.map((s, i) => ({ id: `S${i + 1}`, text: s.content, obligations: s.expected ? [{ id: `O${i + 1}`, text: s.expected, layer: 'served' }] : [] })),
        priority: priority.tag, ...(priority.defaulted ? { priorityDefaulted: true } : {}),
        configurations: [], refs, fixture: null, configurationDependent: false,
        provenance: { draftedFrom: 'testrail', independentRefs: [`testrail:project:${snapshot.project}:suite:${suite.id}:case:${caseId}`, ...refs], selfDerivedAcceptedBy: null },
        approval: null,
      },
      source: { project: snapshot.project, suite: suite.id, case: caseId, fetchedAt: snapshot.fetchedAt, rawHash: hashOf(raw) },
      tier, priority, mark, problems,
    };
  }));
}

export async function readSnapshot(path: string): Promise<SourceSnapshot> {
  return validateSnapshot(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

/**
 * Read a whole project through the existing lib helper's request boundary. No snapshot is returned on
 * any failed page; callers retain the last complete snapshot and must not retire cases on a refresh.
 * The helper owns account selection and credentials; never replace it with an independent auth path.
 */
export async function fetchSnapshot(input: { project: number; request: (endpoint: string) => Promise<unknown>; now?: () => Date }): Promise<SourceSnapshot> {
  const project = positiveId(input.project, 'project id');
  const priorities = list(await input.request('get_priorities'), 'priorities').map((x) => {
    const p = object(x, 'priority');
    return { id: positiveId(p['id'], 'priority id'), name: text(p['name']) };
  });
  const suiteMetadata = list(await input.request(`get_suites/${project}`), 'suites');
  const suites: SourceSuite[] = [];
  for (const rawSuite of suiteMetadata) {
    const suite = object(rawSuite, 'suite');
    const id = positiveId(suite['id'], 'suite id');
    if (suite['project_id'] !== undefined && suite['project_id'] !== project) throw new Error(`suite ${id} belongs to another project`);
    const cases = await collectPages(`get_cases/${project}&suite_id=${id}`, 'cases', input.request);
    suites.push({ id, cases });
  }
  return validateSnapshot({ schema: 1, source: 'testrail', project, fetchedAt: (input.now?.() ?? new Date()).toISOString(), complete: true, priorities, suites });
}

/**
 * Collect raw paginated lib:testrail JSON. The callback is the existing read-only credential helper.
 * Offsets and next links must stay within the requested endpoint; incomplete or inconsistent pages fail.
 */
export async function collectPages(endpoint: string, key: 'cases' | 'sections', request: (endpoint: string) => Promise<unknown>): Promise<ObjectValue[]> {
  if (!new RegExp(`^get_${key}/\\d+&suite_id=\\d+$`).test(endpoint)) throw new Error('invalid project/suite endpoint');
  const result: ObjectValue[] = [];
  const seen = new Set<number>();
  let offset = 0;
  let total: number | undefined;
  for (let page = 0; page < 10_000; page++) {
    const raw = await request(`${endpoint}&limit=250&offset=${offset}`);
    if (Array.isArray(raw)) {
      if (offset !== 0) throw new Error('pagination changed response shape');
      for (const item of raw) {
        const record = object(item, key); const id = positiveId(record['id'], `${key} id`);
        if (seen.has(id)) throw new Error('duplicate source id'); seen.add(id); result.push(record);
      }
      return result;
    }
    const response = object(raw, 'page');
    const items = list(response[key], key);
    if (response['offset'] !== offset || response['size'] !== items.length) throw new Error('inconsistent pagination offset or size');
    const count = response['total'];
    if (count !== undefined) {
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || (total !== undefined && total !== count)) throw new Error('inconsistent pagination total');
      total = count;
    }
    for (const item of items) {
      const record = object(item, key); const id = positiveId(record['id'], `${key} id`);
      if (seen.has(id)) throw new Error('duplicate source id'); seen.add(id); result.push(record);
    }
    const links = object(response['_links'], 'pagination links');
    const next = links['next'];
    if (next === null || next === '') {
      if (total !== undefined && total !== result.length) throw new Error('partial pagination: collected count differs from total');
      return result;
    }
    if (items.length === 0 || typeof next !== 'string') throw new Error('invalid pagination next link');
    const expectedOffset = offset + items.length;
    const path = next.replace(/^\/?(?:index\.php\?\/api\/v2\/|api\/v2\/)/, '');
    if (path !== `${endpoint}&limit=250&offset=${expectedOffset}`) throw new Error('pagination next link changed endpoint, project, suite, limit or offset');
    offset = expectedOffset;
  }
  throw new Error('pagination exceeded its bound');
}
