// Phase 1 command-line commands. Each parses its arguments strictly (unknown, duplicate or missing
// values are refused), does one thing, and prints one JSON line. Authoring commands exit 0 on success and
// 4 on refusal or usage error; they never print a verdict.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { accept, actorFor, addToRegression, adopt, approveCase, classifyPath, decideGraduation, ingest, initProject, proposeGraduation, roleLabel, waive, workCommand } from './authoring.ts';
import { burnin, redcheck, reverify, type CertifyContext } from './certify.ts';
import { checkSuite, renderCheck, type CorpusCase } from './check/check.ts';
import { fileConnector, testrailConnector, type SourceConnector } from './connectors/connector.ts';
import { commandAdapter } from './local-adapter.ts';
import type { Configuration, FixtureDef, RoleName, TestIdentity } from './model.ts';
import { inside, loadPersisted, parseProfile, readJson } from './persistence.ts';
import { mapPriority, priorityOf } from './priority.ts';
import { importSnapshot } from './source.ts';
import { recordTriage, FAILURE_CLASSES, type FailureClass } from './triage.ts';
import type { EnvironmentInputValue } from '../kit/environment-inputs.ts';

export const COMMANDS = new Set(['check', 'init', 'ingest', 'case', 'regression', 'work', 'adopt', 'redcheck', 'burnin', 'reverify', 'accept', 'waive', 'graduate', 'triage']);

type Parsed = { values: Map<string, string>; flags: Set<string> };
function parse(args: string[], valued: string[], flags: string[] = []): Parsed {
  const values = new Map<string, string>();
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (seen.has(key)) throw new Error(`duplicate argument ${key}`);
    seen.add(key);
    if (flags.includes(key)) continue;
    if (!valued.includes(key)) throw new Error(`${key} is not valid here`);
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${key}`);
    values.set(key, value);
  }
  return { values, flags: new Set([...seen].filter((k) => flags.includes(k))) };
}
const need = (p: Parsed, key: string): string => { const v = p.values.get(key); if (v === undefined || v === '') throw new Error(`${key} is required`); return v; };
const role = (p: Parsed): RoleName => { const v = need(p, '--as'); if (v !== 'qa' && v !== 'developer') throw new Error('--as is qa or developer: the role is always named, never inferred'); return v; };
const path = (p: Parsed, key: string) => realpathSync(resolve(need(p, key)));
const titlePath = (title: string) => title.split(' › ').map((s) => s.trim()).filter(Boolean);
const testOf = (p: Parsed): TestIdentity => ({ suite: need(p, '--suite'), file: need(p, '--file'), titlePath: titlePath(need(p, '--title')) });
/** The application worktree, when a command names it (needed when the addendum lives there). */
const app = (p: Parsed): { appRoot?: string } => (p.values.has('--app-root') ? { appRoot: path(p, '--app-root') } : {});
const RUN = ['--suite-root', '--app-root', '--env', '--adapter', '--inputs', '--timeout-ms'];

function inputs(p: Parsed): Record<string, EnvironmentInputValue> | undefined {
  if (!p.values.has('--inputs')) return undefined;
  const value = readJson(resolve(p.values.get('--inputs')!));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('inputs must be a set/unset value object');
  return value as Record<string, EnvironmentInputValue>;
}
function certifyContext(p: Parsed): CertifyContext {
  const appRoot = path(p, '--app-root');
  const timeout = p.values.has('--timeout-ms') ? Number(p.values.get('--timeout-ms')) : undefined;
  if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout < 1)) throw new Error('timeout must be a positive integer');
  const values = inputs(p);
  return { suiteRoot: path(p, '--suite-root'), appRoot, environment: need(p, '--env'), adapter: commandAdapter(resolve(need(p, '--adapter')), appRoot), ...(values === undefined ? {} : { environmentValues: values }), ...(timeout === undefined ? {} : { timeoutMs: timeout }) };
}
function connector(p: Parsed, project: number): SourceConnector {
  const kind = need(p, '--connector');
  if (kind === 'testrail') return testrailConnector({ helper: need(p, '--helper'), account: need(p, '--account'), project });
  if (kind === 'file') return fileConnector(need(p, '--responses'), project);
  throw new Error('--connector is testrail or file');
}
const project = (p: Parsed) => { const n = Number(need(p, '--project')); if (!Number.isSafeInteger(n) || n < 1) throw new Error('--project is a positive integer'); return n; };
const CONNECTOR = ['--connector', '--helper', '--account', '--responses', '--project'];

/** The corpus as the checker needs it: each case's tag and declared viewport widths. */
function corpusOf(suiteRoot: string, appRoot?: string): CorpusCase[] {
  const state = loadPersisted(suiteRoot, appRoot === undefined ? {} : { applicationRoot: appRoot });
  return [...state.cases.values()].map((c) => ({
    id: c.id,
    tag: /^p[1-4]$/.test(c.priority) ? (c.priority as CorpusCase['tag']) : null,
    defaulted: c.priorityDefaulted === true,
    widths: c.configurations.map((id) => state.profile.configurations.find((x) => x.id === id)?.viewport?.width).filter((w): w is number => typeof w === 'number'),
  }));
}

export async function runCommand(args: string[]): Promise<{ exitCode: number; output: unknown }> {
  const [command, sub] = args as [string, string | undefined];
  const rest = (n: number) => args.slice(n);
  switch (command) {
    case 'check': {
      const p = parse(rest(1), ['--suite', '--suite-root', '--app-root', '--standard'], ['--json']);
      const standard = p.values.has('--standard') ? readFileSync(resolve(p.values.get('--standard')!), 'utf8') : null;
      const report = checkSuite({ suiteRoot: path(p, '--suite'), standardText: standard, corpus: p.values.has('--suite-root') ? corpusOf(path(p, '--suite-root'), app(p).appRoot) : null });
      if (!p.flags.has('--json')) process.stderr.write(renderCheck(report));
      return { exitCode: 0, output: report };
    }
    case 'source': {
      if (sub === 'priorities') {
        const p = parse(rest(2), CONNECTOR);
        const priorities = await connector(p, project(p)).priorities();
        return { exitCode: 0, output: { priorities: priorities.map(mapPriority) } };
      }
      if (sub === 'case') {
        const p = parse(rest(2), [...CONNECTOR, '--id']);
        const c = connector(p, project(p));
        const id = Number(need(p, '--id'));
        const raw = await c.case(id);
        return { exitCode: 0, output: { connector: c.name, origin: c.origin, case: raw, priority: priorityOf(raw['priority_id'], await c.priorities()) } };
      }
      if (sub === 'snapshot') {
        const p = parse(rest(2), [...CONNECTOR, '--output']);
        const c = connector(p, project(p));
        const { sourceDestination } = await import('./cli.ts');
        const output = await sourceDestination(need(p, '--output'));
        // A failed or partial refresh throws here, before anything is written: the last complete snapshot stays.
        const snapshot = await c.snapshot();
        const drafts = importSnapshot(snapshot);
        mkdirSync(output, { recursive: false });
        writeFileSync(join(output, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
        writeFileSync(join(output, 'drafts.json'), `${JSON.stringify({ schema: 1, connector: c.name, origin: c.origin, drafts }, null, 2)}\n`, { flag: 'wx' });
        const tally = (f: (d: (typeof drafts)[number]) => string) => drafts.reduce<Record<string, number>>((a, d) => ({ ...a, [f(d)]: (a[f(d)] ?? 0) + 1 }), {});
        return { exitCode: 0, output: { connector: c.name, project: snapshot.project, complete: true, fetchedAt: snapshot.fetchedAt, cases: drafts.length, byPriority: tally((d) => d.priority.label), byMark: tally((d) => d.mark), output } };
      }
      throw new Error('source is snapshot, priorities or case');
    }
    case 'init': {
      const p = parse(rest(1), ['--suite-root', '--app-root', '--project', '--suite-id', '--config', '--env-id', '--base-url', '--base-url-env', '--qa', '--configurations', '--fixture-map', '--base-branch', '--remote', '--app-remote', '--app-branch', '--health-path', '--actor-path', '--addendum-in'], ['--qa-stand-in']);
      const suiteRoot = path(p, '--suite-root');
      const appRoot = path(p, '--app-root');
      if (suiteRoot === appRoot) throw new Error('the suite checkout and the application worktree are named separately; here they are the same folder');
      const written = await initProject({
        suiteRoot, project: need(p, '--project'), suiteId: need(p, '--suite-id'), config: need(p, '--config'),
        environment: { id: need(p, '--env-id'), baseUrl: need(p, '--base-url'), baseUrlEnv: need(p, '--base-url-env') },
        qa: { name: need(p, '--qa'), standIn: p.flags.has('--qa-stand-in') },
        configurations: readJson(resolve(need(p, '--configurations'))) as Configuration[], fixtures: readJson(resolve(need(p, '--fixture-map'))) as FixtureDef[],
        baseBranch: p.values.get('--base-branch') ?? 'main', remote: p.values.get('--remote') ?? 'origin',
        applicationBase: { remote: p.values.get('--app-remote') ?? 'origin', branch: p.values.get('--app-branch') ?? 'main' },
        healthPath: p.values.get('--health-path') ?? 'health', actorProbePath: p.values.get('--actor-path') ?? 'actor',
        addendumIn: (() => { const v = p.values.get('--addendum-in') ?? 'suite'; if (v !== 'suite' && v !== 'application') throw new Error('--addendum-in is suite or application'); return v === 'application' ? { root: 'application' as const, appRoot } : { root: 'suite' as const }; })(),
      });
      return { exitCode: 0, output: { written, suiteRoot, appRoot, qa: `${need(p, '--qa')} as ${p.flags.has('--qa-stand-in') ? 'QA (stand-in)' : 'QA'}`, next: 'commit the profile and publish it to the QA base branch the profile names; verdicts compare against that remote-tracking ref' } };
    }
    case 'ingest': {
      const p = parse(rest(1), ['--suite-root', '--snapshot', '--cases']);
      const suiteRoot = path(p, '--suite-root');
      const snapshot = path(p, '--snapshot');
      const { readSnapshot } = await import('./source.ts');
      const drafts = importSnapshot(await readSnapshot(snapshot));
      const cases = p.values.get('--cases')?.split(',').map((s) => s.trim()).filter(Boolean);
      return { exitCode: 0, output: await ingest({ suiteRoot, snapshot, drafts, ...(cases === undefined ? {} : { cases }) }) };
    }
    case 'case': {
      if (sub !== 'approve') throw new Error('case approve is the only case command');
      const p = parse(rest(2), ['--suite-root', '--app-root', '--id', '--as', '--reason'], ['--add']);
      const suiteRoot = path(p, '--suite-root');
      const profile = parseProfile(readJson(inside(suiteRoot, '.test-lab/profile.json')));
      const actor = await actorFor(suiteRoot, role(p), profile);
      return { exitCode: 0, output: await approveCase({ suiteRoot, ...app(p), id: need(p, '--id'), actor, reason: need(p, '--reason'), add: p.flags.has('--add') }) };
    }
    case 'regression': {
      if (sub !== 'add') throw new Error('regression add is the only regression command');
      const p = parse(rest(2), ['--suite-root', '--id', '--as', '--reason']);
      const suiteRoot = path(p, '--suite-root');
      const actor = await actorFor(suiteRoot, role(p), parseProfile(readJson(inside(suiteRoot, '.test-lab/profile.json'))));
      return { exitCode: 0, output: { written: await addToRegression(suiteRoot, need(p, '--id'), actor, need(p, '--reason')), by: `${actor.by} as ${roleLabel(actor)}` } };
    }
    case 'work': {
      if (!['start', 'add', 'drop', 'close', 'import'].includes(sub ?? '')) throw new Error('work is start, add, drop, close or import');
      const p = parse(rest(2), ['--suite-root', '--app-root', '--ticket', '--case', '--as', '--reason']);
      const suiteRoot = path(p, '--suite-root');
      const appRoot = path(p, '--app-root');
      const actor = await actorFor(appRoot, sub === 'import' ? 'developer' : role(p), parseProfile(readJson(inside(suiteRoot, '.test-lab/profile.json'))));
      const file = await workCommand({ suiteRoot, appRoot, action: sub as 'start', ticket: need(p, '--ticket'), ...(p.values.has('--case') ? { case: p.values.get('--case')! } : {}), actor, reason: sub === 'import' ? 'import' : need(p, '--reason') });
      return { exitCode: 0, output: { ticket: file.ticket, branch: file.branch, addendum: file.addendum, events: file.log.length } };
    }
    case 'adopt': {
      const p = parse(rest(1), ['--suite-root', '--app-root', '--suite', '--file', '--title', '--case', '--configuration', '--layer', '--obligations', '--legacy', '--exclude', '--as', '--reason']);
      const suiteRoot = path(p, '--suite-root');
      for (const [flag, to] of [['--legacy', 'legacy'], ['--exclude', 'excluded']] as const) if (p.values.has(flag)) {
        const actor = await actorFor(suiteRoot, role(p), parseProfile(readJson(inside(suiteRoot, '.test-lab/profile.json'))));
        return { exitCode: 0, output: { classification: await classifyPath({ suiteRoot, suite: need(p, '--suite'), glob: p.values.get(flag)!, to, actor, reason: need(p, '--reason') }) } };
      }
      const layer = p.values.get('--layer') ?? 'served';
      if (layer !== 'served' && layer !== 'synthetic') throw new Error('--layer is served or synthetic');
      const obligations = p.values.get('--obligations')?.split(',').map((x) => { const [step, obligation] = x.split('/'); if (!step || !obligation) throw new Error('--obligations lists STEP/OBLIGATION pairs'); return { step, obligation }; });
      return { exitCode: 0, output: await adopt({ suiteRoot, ...app(p), test: testOf(p), case: need(p, '--case'), configurations: need(p, '--configuration').split(','), layer, ...(obligations === undefined ? {} : { obligations }) }) };
    }
    case 'redcheck': {
      const p = parse(rest(1), [...RUN, '--suite', '--file', '--title', '--case', '--step', '--obligation', '--configuration', '--recipe']);
      const result = await redcheck(certifyContext(p), { test: testOf(p), obligation: { case: need(p, '--case'), step: need(p, '--step'), obligation: need(p, '--obligation') }, configuration: need(p, '--configuration'), recipe: readJson(resolve(need(p, '--recipe'))) as Record<string, unknown> });
      return { exitCode: result.ok ? 0 : 4, output: result };
    }
    case 'burnin': {
      const p = parse(rest(1), [...RUN, '--suite', '--file', '--title', '--configuration', '--repeats']);
      const result = await burnin(certifyContext(p), { test: testOf(p), configuration: need(p, '--configuration'), ...(p.values.has('--repeats') ? { repeats: Number(p.values.get('--repeats')) } : {}) });
      return { exitCode: result.ok ? 0 : 4, output: result };
    }
    case 'reverify': {
      const p = parse(rest(1), RUN);
      const items = await reverify(certifyContext(p));
      return { exitCode: items.every((i) => i.result?.ok === true) ? 0 : 4, output: { replayed: items } };
    }
    case 'accept': {
      const p = parse(rest(1), ['--suite-root', '--app-root', '--case', '--suite', '--file', '--title', '--as']);
      const suiteRoot = path(p, '--suite-root');
      const actor = await actorFor(suiteRoot, role(p), parseProfile(readJson(inside(suiteRoot, '.test-lab/profile.json'))));
      return { exitCode: 0, output: await accept({ suiteRoot, ...app(p), case: need(p, '--case'), test: testOf(p), actor }) };
    }
    case 'waive': {
      const p = parse(rest(1), ['--suite-root', '--app-root', '--case', '--step', '--obligation', '--as', '--reason']);
      const suiteRoot = path(p, '--suite-root');
      const actor = await actorFor(suiteRoot, role(p), parseProfile(readJson(inside(suiteRoot, '.test-lab/profile.json'))));
      return { exitCode: 0, output: { waiver: await waive({ suiteRoot, ...app(p), case: need(p, '--case'), step: need(p, '--step'), obligation: need(p, '--obligation'), actor, reason: need(p, '--reason') }), by: `${actor.by} as ${roleLabel(actor)}` } };
    }
    case 'graduate': {
      if (sub === 'propose') {
        const p = parse(rest(2), ['--suite-root', '--app-root', '--case', '--run', '--reason']);
        const suiteRoot = path(p, '--suite-root');
        const actor = await actorFor(suiteRoot, 'developer', parseProfile(readJson(inside(suiteRoot, '.test-lab/profile.json'))));
        return { exitCode: 0, output: { proposal: await proposeGraduation({ suiteRoot, ...app(p), case: need(p, '--case'), runDir: path(p, '--run'), actor, reason: need(p, '--reason') }) } };
      }
      if (sub === 'decide') {
        const p = parse(rest(2), ['--suite-root', '--app-root', '--case', '--decision', '--as', '--reason', '--work']);
        const suiteRoot = path(p, '--suite-root');
        const decision = need(p, '--decision');
        if (decision !== 'graduated' && decision !== 'kept-out') throw new Error('--decision is graduated or kept-out');
        const profile = parseProfile(readJson(inside(suiteRoot, '.test-lab/profile.json')));
        const actor = await actorFor(suiteRoot, role(p), profile);
        const written = await decideGraduation({ suiteRoot, ...app(p), case: need(p, '--case'), decision, actor, reason: need(p, '--reason') });
        // A graduated case leaves the work's addendum as its own logged scope event.
        if (decision === 'graduated' && p.values.has('--work')) await workCommand({ suiteRoot, appRoot: path(p, '--app-root'), action: 'drop', ticket: p.values.get('--work')!, case: need(p, '--case'), actor, reason: 'graduated to the regression suite' });
        return { exitCode: 0, output: { decision, by: `${actor.by} as ${roleLabel(actor)}`, written } };
      }
      throw new Error('graduate is propose or decide');
    }
    case 'triage': {
      const p = parse(rest(1), ['--run', '--failure', '--class', '--as', '--suite-root', '--note']);
      const suiteRoot = path(p, '--suite-root');
      const actor = await actorFor(suiteRoot, role(p), parseProfile(readJson(inside(suiteRoot, '.test-lab/profile.json'))));
      const cls = need(p, '--class');
      if (!(FAILURE_CLASSES as readonly string[]).includes(cls)) throw new Error(`--class is one of ${FAILURE_CLASSES.join(', ')}`);
      const runDir = path(p, '--run');
      if (!existsSync(join(runDir, 'verdict.json'))) throw new Error('no verdict.json in that run folder');
      return { exitCode: 0, output: recordTriage(runDir, { failure: Number(need(p, '--failure')), class: cls as FailureClass, actor, note: p.values.get('--note') ?? '' }) };
    }
  }
  throw new Error(`unknown command ${command}`);
}
