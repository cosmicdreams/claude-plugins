import { parseIdentity, type RequestIdentity } from './request-identity.ts';
// What the pane shows, read from a run's verdict.json (src/page.ts). Pure: the hooks module reads the
// file and hands the text here. A file that isn't a verdict the core wrote is shown as such, never
// guessed at. The handoff carries what the core's own page carries (context, build identity, scope
// counts, required cases, scope changes, what is outside the verdict), so a summary-only reader gets
// all of it without the report.

export type VerdictKind = 'not-evaluable' | 'inconclusive' | 'not-ready' | 'ready';

export type PaneContext = {
  appRoot: string;
  suiteRoot: string;
  environment: { id: string; kind: 'local-candidate' | 'deployed'; baseUrl: string };
  build: { commit: string | null; digest: string | null };
  suite: { commit: string | null; digest: string | null };
  corpusRevision: string;
  identityChecks: { name: string; status: string; detail: string }[];
  counts: { track: string; priority: string; cases: number; current: number; verified: number; waived: number; developerAttested: number }[];
};

export type PaneVerdict = {
  requestIdentity: RequestIdentity | null;
  runDir: string;
  project: string;
  environment: string;
  startedAt: string;
  finishedAt: string;
  machine: string;
  openReport: string[] | null;
  context: PaneContext | null;
  verdict: VerdictKind;
  rule: number;
  reasons: string[];
  failures: string[];
  exceptions: string[];
  required: string[];
  scopeChanges: string[];
  outside: string[];
};

export const LABEL: Record<VerdictKind, string> = {
  'not-evaluable': 'NOT EVALUABLE',
  inconclusive: 'INCONCLUSIVE',
  'not-ready': 'NOT READY',
  ready: 'READY',
};

export const COLOR: Record<VerdictKind, string> = { 'not-evaluable': 'yellow', inconclusive: 'yellow', 'not-ready': 'red', ready: 'green' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const nullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';
const commitDigest = (v: unknown): v is { commit: string | null; digest: string | null } => isObject(v) && nullableString(v['commit']) && nullableString(v['digest']);

/**
 * A base URL without what could carry a secret: no user information, query or fragment. The profile's
 * URL is configuration, but a person may have put credentials in it; the pane never repeats them.
 */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return 'an unreadable URL';
  }
}

function parseContext(v: unknown): PaneContext | null | { error: string } {
  if (v === undefined) return null;
  const bad = { error: 'verdict.json has an unreadable context' };
  if (!isObject(v) || typeof v['appRoot'] !== 'string' || typeof v['suiteRoot'] !== 'string' || typeof v['corpusRevision'] !== 'string') return bad;
  const env = v['environment'];
  if (!isObject(env) || typeof env['id'] !== 'string' || (env['kind'] !== 'local-candidate' && env['kind'] !== 'deployed') || typeof env['baseUrl'] !== 'string') return bad;
  if (!commitDigest(v['build']) || !commitDigest(v['suite'])) return bad;
  const checks = v['identityChecks'];
  const counts = v['counts'];
  if (!Array.isArray(checks) || !checks.every((c) => isObject(c) && typeof c['name'] === 'string' && typeof c['status'] === 'string' && typeof c['detail'] === 'string')) return bad;
  const numbers = ['cases', 'current', 'verified', 'waived', 'developerAttested'];
  if (!Array.isArray(counts) || !counts.every((c) => isObject(c) && typeof c['track'] === 'string' && typeof c['priority'] === 'string' && numbers.every((n) => typeof c[n] === 'number'))) return bad;
  return {
    appRoot: v['appRoot'],
    suiteRoot: v['suiteRoot'],
    environment: { id: env['id'], kind: env['kind'], baseUrl: env['baseUrl'] },
    build: v['build'],
    suite: v['suite'],
    corpusRevision: v['corpusRevision'],
    identityChecks: checks as PaneContext['identityChecks'],
    counts: counts as PaneContext['counts'],
  };
}

/** One failure as the core's page writes it (src/page.ts renderMarkdown). */
function failureLine(f: unknown): string {
  if (!isObject(f) || !isObject(f['test'])) return 'a failure the verdict file does not describe';
  const t = f['test'];
  const title = strings(t['titlePath']) ? t['titlePath'].join(' › ') : '';
  const project = typeof f['project'] === 'string' ? ` [${f['project']}]` : '';
  const obligation = typeof f['obligation'] === 'string' ? ` in ${f['obligation']}` : '';
  const prefill = typeof f['classPrefill'] === 'string' ? ` (pre-filled: ${f['classPrefill']})` : '';
  const acceptance = typeof f['acceptance'] === 'string' ? ` (risk acceptance ${f['acceptance']})` : '';
  return `[${String(f['lane'])}] ${String(t['file'])} › ${title}${project}: ${String(f['outcome'])}${obligation}${prefill}${acceptance}`;
}

function requiredLine(c: unknown): string {
  if (!isObject(c)) return 'a required case the verdict file does not describe';
  return `${String(c['track'])} ${String(c['case'])} on ${String(c['configuration'])}: ${String(c['outcome'])}${c['quarantined'] === true ? ' (quarantined)' : ''}`;
}

function scopeLine(e: unknown): string {
  if (!isObject(e)) return 'a scope change the verdict file does not describe';
  return `${String(e['at'])} ${String(e['kind'])}${typeof e['case'] === 'string' ? ` ${e['case']}` : ''} by ${String(e['by'])} (${String(e['role'])}${e['standIn'] === true ? ', stand-in' : ''}): ${String(e['reason'])}`;
}

/** The pane's reading of a verdict file, or why it can't be read. */
export function parseVerdict(text: string | undefined): PaneVerdict | { error: string } {
  if (text === undefined) return { error: 'no verdict.json in that run folder' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'verdict.json is not JSON' };
  }
  if (!isObject(raw) || raw['schema'] !== 1 || !isObject(raw['verdict'])) return { error: 'verdict.json is not a test-lab verdict' };
  const v = raw['verdict'];
  const kind = v['verdict'];
  if (kind !== 'not-evaluable' && kind !== 'inconclusive' && kind !== 'not-ready' && kind !== 'ready') return { error: 'verdict.json names no verdict' };
  if (typeof v['rule'] !== 'number' || !strings(v['reasons']) || !strings(v['exceptions']) || !Array.isArray(v['failures'])) return { error: 'verdict.json is incomplete' };
  // Required cases, scope changes and what is outside are part of every verdict the core writes.
  if (!Array.isArray(v['required']) || !Array.isArray(v['scopeChanges']) || !strings(v['outside'])) return { error: 'verdict.json is incomplete' };
  for (const key of ['runDir', 'project', 'environment', 'startedAt', 'finishedAt', 'machine'] as const) if (typeof raw[key] !== 'string') return { error: `verdict.json has no ${key}` };
  const requestIdentity = parseIdentity(raw['requestIdentity']);
  if (raw['requestIdentity'] !== undefined && raw['requestIdentity'] !== null && requestIdentity === null) return { error: 'verdict.json has an invalid request identity' };
  const context = parseContext(raw['context']);
  if (context !== null && 'error' in context) return context;
  return {
    runDir: raw['runDir'] as string,
    project: raw['project'] as string,
    environment: raw['environment'] as string,
    startedAt: raw['startedAt'] as string,
    finishedAt: raw['finishedAt'] as string,
    machine: raw['machine'] as string,
    openReport: strings(raw['openReport']) ? raw['openReport'] : null,
    context,
    requestIdentity,
    verdict: kind,
    rule: v['rule'],
    reasons: v['reasons'],
    failures: v['failures'].map(failureLine),
    exceptions: v['exceptions'],
    required: v['required'].map(requiredLine),
    scopeChanges: v['scopeChanges'].map(scopeLine),
    outside: v['outside'],
  };
}

/** What kind of answer this is: a local candidate's verdict is not deployed confirmation. */
export function standing(p: PaneVerdict): string {
  if (p.context === null) return 'The core recorded no context for this run, so its application, build and environment are not shown.';
  return p.context.environment.kind === 'local-candidate'
    ? 'Local candidate: ready means ready to deploy for QA. Human QA owns sign-off.'
    : 'Deployed confirmation: ready means ready for human QA.';
}

/** The context lines: what was judged, at which build, against what. */
export function contextLines(p: PaneVerdict): string[] {
  const c = p.context;
  if (c === null) return [];
  return [
    `Application: ${c.appRoot}; commit ${c.build.commit ?? 'unknown'}; manifest ${c.build.digest ?? 'not checked'}`,
    `Suite/corpus: ${c.suiteRoot}; commit ${c.suite.commit ?? 'unknown'}; manifest ${c.suite.digest ?? 'not checked'}`,
    `Environment: ${c.environment.id} (${c.environment.kind}), ${displayUrl(c.environment.baseUrl)}`,
    `Corpus revision: ${c.corpusRevision}`,
  ];
}

export const countLine = (c: PaneContext['counts'][number]): string => `${c.track}, ${c.priority}: ${c.cases} cases; ${c.current} current; ${c.verified} verified; ${c.waived} waived; ${c.developerAttested} developer-attested`;
export const checkLine = (c: PaneContext['identityChecks'][number]): string => `${c.name}: ${c.status} (${c.detail})`;

const section = (title: string, items: string[], empty = 'none'): string[] => [`${title}:`, ...(items.length === 0 ? [`- ${empty}`] : items.map((i) => `- ${i}`))];

/** The summary the tool returns and Copy summary hands to QA: everything the core's page says. */
export function summaryText(p: PaneVerdict): string {
  return [
    `test-lab · ${p.project} · ${p.environment}: ${LABEL[p.verdict]} (rule ${p.rule}), ${p.finishedAt}`,
    standing(p),
    ...contextLines(p),
    ...p.reasons.map((r) => `- ${r}`),
    ...(p.context === null ? [] : [...section('Scope counts', p.context.counts.map(countLine)), ...section('Build checks', p.context.identityChecks.map(checkLine))]),
    ...section('Required cases', p.required),
    p.failures.length === 0 ? 'No failures seen.' : `Failures seen (${p.failures.length}):`,
    ...p.failures.map((f) => `- ${f}`),
    ...section('Exceptions', p.exceptions),
    ...section('Scope changes in this work', p.scopeChanges),
    ...section('Outside this verdict', p.outside),
    `Run folder: ${p.runDir}`,
  ].join('\n');
}
