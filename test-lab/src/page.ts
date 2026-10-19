import type { RequestIdentity } from '../hooks/mod/request-identity.ts';
// The verdict page (plan §2 "The handoff"): `verdict.json` for the mod and CI, `verdict.md` for people,
// both in the run directory. The run is stamped with this machine's test-lab identity, so a surface can
// tell whether the run's artifacts are on its own machine (src/artifacts.ts) rather than trusting a
// host name a record claims.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TriageFile } from './triage.ts';
import type { Verdict } from './verdict.ts';
import { dataDir } from './work.ts';

export const VERDICT_JSON = 'verdict.json';
export const VERDICT_MD = 'verdict.md';
export const MACHINE_FILE = 'machine-id';

/** This machine's test-lab identity: a random ID kept in the data folder, created once. */
export function machineId(dir = dataDir()): string {
  const file = join(dir, MACHINE_FILE);
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  writeFileSync(file, `${id}\n`, { flag: 'wx' });
  return id;
}

export type VerdictContext = {
  appRoot: string;
  suiteRoot: string;
  environment: {id:string;kind:'local-candidate'|'deployed';baseUrl:string};
  build: {commit:string|null;digest:string|null};
  suite: {commit:string|null;digest:string|null};
  corpusRevision: string;
  identityChecks: {name:string;status:string;detail:string}[];
  counts: {track:string;priority:string;cases:number;current:number;verified:number;waived:number;developerAttested:number}[];
  /** Handoff sections (plan §2): approvals and acceptances with their role labels, waivers, graduation decisions, browsers not run locally. */
  handoff?: {title:string;items:string[]}[];
};
export type RunMeta = { runDir: string; project: string; environment: string; startedAt: string; finishedAt: string; context?:VerdictContext; requestIdentity?:RequestIdentity };

export type VerdictFile = RunMeta & { schema: 1; machine: string; openReport: string[] | null; verdict: Verdict };

/** The platform's own opener for the run's HTML report, by argument vector. */
export function reportOpener(runDir: string, platform: string = process.platform): string[] | null {
  const index = join(runDir, 'html', 'index.html');
  if (platform === 'darwin') return ['open', index];
  if (platform === 'linux') return ['xdg-open', index];
  return null;
}

const LABEL: Record<Verdict['verdict'], string> = { 'not-evaluable': 'NOT EVALUABLE', inconclusive: 'INCONCLUSIVE', 'not-ready': 'NOT READY', ready: 'READY' };

const CLASS_HINT = 'product-bug | automation-bug | system-issue | no-defect | to-investigate';

export function renderMarkdown(file: VerdictFile, triage: TriageFile | null = null): string {
  const v = file.verdict;
  const classes = new Map((triage?.entries ?? []).map((e) => [e.failure, e]));
  const classOf = (i: number) => {
    const e = classes.get(i + 1);
    return e === undefined ? ` — class: not chosen (${CLASS_HINT}; \`test-lab triage\`)` : ` — class: ${e.class}, chosen by ${e.by} (${e.role === 'qa' ? (e.standIn ? 'QA (stand-in)' : 'QA') : 'developer'})${e.note ? `: ${e.note}` : ''}`;
  };
  const lines = [
    `# ${LABEL[v.verdict]} (rule ${v.rule})`,
    '',
    `${file.project} · ${file.environment} · ${file.finishedAt}`,
    ...(file.context===undefined?[]:[
      '',
      file.context.environment.kind==='local-candidate'?'Local candidate — ready means ready to deploy for QA. Human QA owns sign-off.':'Deployed confirmation — ready for human QA.',
      `Application: ${file.context.appRoot}; commit ${file.context.build.commit??'unknown'}; manifest ${file.context.build.digest??'not checked'}`,
      `Suite/corpus: ${file.context.suiteRoot}; commit ${file.context.suite.commit??'unknown'}; manifest ${file.context.suite.digest??'not checked'}`,
      `Environment: ${file.context.environment.id} (${file.context.environment.kind}), ${file.context.environment.baseUrl}`,
      `Corpus revision: ${file.context.corpusRevision}`,
      '',
      '## Scope counts',
      ...file.context.counts.map(c=>`- ${c.track}, ${c.priority}: ${c.cases} cases; ${c.current} current; ${c.verified} verified; ${c.waived} waived; ${c.developerAttested} developer-attested`),
      '',
      '## Build checks',
      ...file.context.identityChecks.map(c=>`- ${c.name}: ${c.status} (${c.detail})`),
      ...(file.context.handoff??[]).flatMap(h=>['',`## ${h.title}`,...(h.items.length===0?['- none']:h.items.map(i=>`- ${i}`))]),
    ]),
    '',
    '## Why',
    ...v.reasons.map((r) => `- ${r}`),
    '',
    '## Required cases',
    ...(v.required.length === 0 ? ['- none'] : v.required.map((c) => `- ${c.track} ${c.case} on ${c.configuration}: ${c.outcome}`)),
    '',
    '## Failures seen',
    ...(v.failures.length === 0 ? ['- none'] : v.failures.map((f, i) => `- ${i + 1}. [${f.lane}] ${f.test.file} › ${f.test.titlePath.join(' › ')} [${f.project}]: ${f.outcome}${f.obligation === null ? '' : ` in ${f.obligation}`}${f.classPrefill === null ? '' : ` (pre-filled: ${f.classPrefill})`}${f.acceptance === null ? '' : ` (risk acceptance ${f.acceptance})`}${classOf(i)}`)),
    ...(v.failures.length === 0 ? [] : ['', 'Triage records what happened; it never clears a failure. Only a QA risk acceptance clears a governed failure (rule 6), and nothing clears a required one (rule 5).']),
    '',
    '## Exceptions',
    ...(v.exceptions.length === 0 ? ['- none'] : v.exceptions.map((e) => `- ${e}`)),
    '',
    '## Scope changes in this work',
    ...(v.scopeChanges.length === 0 ? ['- none'] : v.scopeChanges.map((e) => `- ${e.at} ${e.kind}${e.case === undefined ? '' : ` ${e.case}`} by ${e.by} (${e.role}${e.standIn ? ', stand-in' : ''}): ${e.reason}`)),
    '',
    '## Outside this verdict',
    ...(v.outside.length === 0 ? ['- none'] : v.outside.map((o) => `- ${o}`)),
    '',
  ];
  return lines.join('\n');
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The HTML rendering of the same page: the Markdown, escaped, so the two can never say different things. */
export function renderHtml(file: VerdictFile, triage: TriageFile | null = null): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>test-lab verdict</title><style>body{max-width:80rem;margin:2rem auto;padding:1rem;font:16px system-ui}pre{white-space:pre-wrap}</style><h1>test-lab local candidate</h1><pre>${escapeHtml(renderMarkdown(file, triage))}</pre></html>`;
}

export function writeVerdict(meta: RunMeta, verdict: Verdict, machine = machineId()): VerdictFile {
  const file: VerdictFile = { schema: 1, ...meta, machine, openReport: reportOpener(meta.runDir), verdict };
  mkdirSync(meta.runDir, { recursive: true });
  writeFileSync(join(meta.runDir, VERDICT_JSON), `${JSON.stringify(file, null, 2)}\n`);
  writeFileSync(join(meta.runDir, VERDICT_MD), renderMarkdown(file));
  return file;
}
