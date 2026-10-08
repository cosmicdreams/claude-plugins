/** Stateful front door. All pipeline operations run in this Node process. */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, openSync, writeSync, fsyncSync, closeSync, statSync } from 'node:fs';
import { resolve, dirname, basename, relative } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { pluginRoot, dependencyFolder, sharedRequire } from './runtime.ts';
import { validate, writeJson } from './contracts.ts';
import type { ArtifactKind } from './contracts.ts';
import { loadProject, invalidate, now } from './discovery-workflow.ts';
import * as config from './lab-config.ts';
import * as runner from './figma-runner.ts';
import * as rebuild from './rebuild.ts';
import { componentCoverage, registerOutputs } from './figma-receipts.ts';
import { siteName, STANDARD_VERSION } from './build-content.ts';
import { COVER_GROUND } from './library-counts.ts';
import * as fonts from './fonts.ts';
import { playwrightReady } from './lab-setup.ts';

import { SERVER_FRESH_MS, RUNNER_ABSENT_MS, isStepKind } from './protocol.ts';
import type { Summary, PhaseName, PhaseStatus, CheckStatus, ChecklistDocument, Handshake } from './protocol.ts';
import type { CommandArgs } from '../scripts/workflow.ts';
import type { ArtifactMap } from './generated/artifacts.ts';
import type { Project } from './generated/project.ts';
import type { PhaseLogEntry } from './generated/phase-log-entry.ts';
import type { CaptureRecord } from './capture/types.ts';
import type { SelectorResult } from './capture/selectors.ts';
type ProjectPhase = Project['phases'][string];
type PhaseDetail = NonNullable<ProjectPhase['detail']>;
type RunIdentity = NonNullable<Project['run']>;
type BuildState = Partial<Extract<ArtifactMap['figma-state'],{steps:unknown}>>;

export const read = <T = unknown>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
export function optional<T = unknown>(path: string): T | null;
export function optional<T>(path: string, fallback: T): T;
export function optional<T>(path: string, fallback: T | null = null): T | null { try { return read<T>(path); } catch { return fallback; } }
export const pluginVersion = (): string => read<{version:string}>(resolve(pluginRoot, '.claude-plugin/plugin.json')).version;
export function gitValue(repo: string, ...args: string[]): string | null { const p = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); return p.status === 0 ? p.stdout.trim() : null; }
export function pluginSource(): Required<NonNullable<RunIdentity['plugin']>> { const tracked = gitValue(pluginRoot, 'ls-files', '--error-unmatch', '.claude-plugin/plugin.json'), commit = tracked ? gitValue(pluginRoot, 'rev-parse', 'HEAD') : null; return { version: pluginVersion(), commit, dirty: commit ? !!gitValue(pluginRoot, 'status', '--porcelain', '--', '.') : null }; }
export function appendJsonl(path: string, entry: PhaseLogEntry): void { mkdirSync(dirname(path), { recursive: true }); const fd = openSync(path, 'a'); try { writeSync(fd, JSON.stringify(entry) + '\n'); fsyncSync(fd); } finally { closeSync(fd); } }
export function setPhase(path: string, project: Project, phase: PhaseName, status: PhaseStatus, detail?: PhaseDetail, at = now()): void { project.phases ??= {}; project.phases[phase] = { status, updatedAt: at, ...(detail && Object.keys(detail).length ? { detail } : {}) }; writeJson(path, project); appendJsonl(resolve(dirname(path), 'phase-log.jsonl'), { at, phase, status }); }
export function runIdentity(args: Pick<CommandArgs<'identity'>,'site-label'|'site-url'|'operator'|'model'>, repo: string) {
  const cwd = process.cwd(), configDir = process.env['CLAUDE_CONFIG_DIR'] || resolve(homedir(), '.claude');
  return { startedAt: now(), siteLabel: args['site-label'] ?? null, siteUrl: args['site-url'] ?? null, operator: args.operator || config.readConfig().operator || config.claudeAccountName() || gitValue(repo, 'config', 'user.name') || process.env['USER'] || null, plugin: pluginSource(), claude: { configDir, model: args.model || process.env['ANTHROPIC_MODEL'] || process.env['CLAUDE_MODEL'] || null, insideClaudeCode: !!process.env['CLAUDECODE'], workingDirectory: cwd, transcripts: resolve(configDir, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-')) } };
}
export function writeActiveRun(workspace: string, serverPid: number | null = null): void { mkdirSync(runner.designLabHome(), { recursive: true, mode: 0o700 }); writeJson(resolve(runner.designLabHome(), 'active-run.json'), { workspace: resolve(workspace), serverPid, at: now() }); }
export function init(args: CommandArgs<'init'>) {
  const repo = resolve(args.repo); if (!existsSync(repo) || !statSync(repo).isDirectory()) throw new Error(`repository does not exist: ${repo}`);
  const workspace = args.workspace ? resolve(args.workspace) : config.nextRun(repo, now().slice(0, 10)), inside = config.insideRepository(workspace);
  if (inside && !args['allow-in-repository']) throw new Error(`${workspace} is inside the working copy ${inside}; runs are personal and never committed, so they live outside every repository`);
  const path = resolve(workspace, 'project.json'); if (existsSync(path) && !args.force) throw new Error(`${path} exists; use --force only to intentionally replace it`);
  const standard = readFileSync(resolve(pluginRoot, 'references/library-standard.md'), 'utf8').split('**Standard version: ')[1]!.split('**')[0];
  const project: Project & {run:ReturnType<typeof runIdentity>;createdAt:string} = { schemaVersion: 1, standardVersion: standard ?? '', pluginVersion: pluginVersion(), createdAt: now(), repository: { root: repo, commit: gitValue(repo, 'rev-parse', 'HEAD'), dirty: !!gitValue(repo, 'status', '--porcelain') }, target: { figmaFileKey: null, figmaUrl: null }, decisions: { componentSource: null, tokenSource: null, usageSource: null, pageStrategy: 'usage-tier' }, phases: Object.fromEntries(['discovery', 'inventory', 'usage', 'capture', 'tokens', 'plan', 'foundation', 'components', 'index', 'verify'].map(name => [name, { status: 'pending' }])), artifacts: {}, run: runIdentity(args, repo) };
  writeJson(path, project); appendJsonl(resolve(workspace, 'phase-log.jsonl'), { at: project.createdAt, phase: 'init', status: 'complete' }); writeActiveRun(workspace); console.error(`design-lab run folder: ${workspace}`); return { project: path, repository: project.repository, run: project.run };
}
export const figmaKey = (url: string | undefined): string | null => /\/design\/([A-Za-z0-9]+)/.exec(url ?? '')?.[1] ?? null;
export function figmaBuild(args: CommandArgs<'figma-build'>) {
  const repo = resolve(args.repo), key = figmaKey(args['figma-url']); if (!existsSync(repo) || !statSync(repo).isDirectory()) throw new Error(`repository does not exist: ${repo}`); if (!key) throw new Error('give the target Figma file address, https://www.figma.com/design/<file-key>/...');
  const workspace = args.workspace ? resolve(args.workspace) : config.nextRun(repo, now().slice(0, 10));
  if (config.insideRepository(workspace)) throw new Error(`${workspace} is inside the working copy; runs are personal and never committed`);
  if (existsSync(workspace) && (!statSync(workspace).isDirectory() || readdirSync(workspace).length)) throw new Error(`${workspace}: rebuild workspace must be new or empty`);
  try {
    const result = rebuild.prepare(resolve(args.from), workspace, key, args['figma-url'], { identity: runIdentity(args, repo) });
    appendJsonl(resolve(workspace, 'phase-log.jsonl'), { at: now(), phase: 'init', status: 'complete', rebuiltFrom: result.rebuiltFrom }); writeActiveRun(workspace);
    const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
    result.next = [ ['workflow.ts', 'connect', '--project', workspace], ['figma_build.ts', 'init', '--project', workspace, '--file-key', key, '--site-url', result.siteUrl, '--canonical-base-url', result.canonicalBaseUrl, '--offline-images'], ['workflow.ts', 'await-build', '--project', workspace], ['workflow.ts', 'finish', '--project', workspace, '--session', 'current'] ].map(([script, ...flags]) => [process.execPath, resolve(pluginRoot, 'scripts', script!), ...flags].map(quote).join(' '));
    console.error(`design-lab run folder: ${workspace}`); return result;
  } catch (error) { if (args.workspace) { mkdirSync(workspace, { recursive: true }); for (const child of readdirSync(workspace)) rmSync(resolve(workspace, child), { recursive: true, force: true }); } else rmSync(workspace, { recursive: true, force: true }); throw error; }
}
export function identity(value: string, args: CommandArgs<'identity'>) {
  const [path, project] = loadProject(value), p = project;
  const run: RunIdentity = p.run && typeof p.run === 'object' ? p.run : { ...runIdentity({}, p.repository.root), startedAt: p.createdAt || now(), recordedLate: true };
  for (const [key, flag] of [['siteLabel', 'site-label'], ['siteUrl', 'site-url'], ['operator', 'operator']] as const) if (args[flag]) run[key] = args[flag]; if (args.model) { run.claude ??= {}; run.claude.model = args.model; }
  if (args['no-schema-change'] && args['schema-change']?.length) throw new Error('use --no-schema-change or --schema-change, not both');
  if (args['no-schema-change']) run.schemaChurn = { changed: false, changes: [], recordedAt: now() };
  if (args['schema-change']?.length) run.schemaChurn = { changed: true, changes: [...(run.schemaChurn?.changed ? run.schemaChurn.changes ?? [] : []), ...args['schema-change'].map((text: string) => ({ at: now(), text }))], recordedAt: now() };
  p.run = run; writeJson(path, p); return run;
}
export function approve(value: string, args: CommandArgs<'approve'>) {
  const [path, project] = loadProject(value), p = project;
  if (p.phases['plan']?.status !== 'awaiting-approval') throw new Error('plan is not awaiting approval'); let by = args.by;
  if (args['from-preflight']) { const detail = p.phases['preflight']?.detail ?? {}; if (detail.planApproval !== 'proposed') throw new Error('preflight chose to review the plan before building: approve with --by <name>'); by = `${detail.operator} (preflight: build the plan as proposed)`; }
  if (!by) throw new Error('approve needs --by <name> or --from-preflight'); Object.assign(p.phases['plan'], { status: 'approved', approvedAt: now(), approvedBy: by }); writeJson(path, p); appendJsonl(resolve(dirname(path), 'phase-log.jsonl'), { at: p.phases['plan'].approvedAt!, phase: 'plan', status: 'approved' }); return p.phases['plan'];
}
export function target(value: string, url: string) {
  const [path, project] = loadProject(value), key = figmaKey(url); if (!key) throw new Error('Figma URL does not contain a /design/<file-key> target');
  if (project.target?.figmaFileKey && project.target?.figmaFileKey !== key) invalidate(project, ['foundation', 'components', 'index', 'verify'], ['foundation', 'build-record', 'index', 'verify-report']);
  project.target = { figmaFileKey: key, figmaUrl: url, recordedAt: now() }; writeJson(path, project); return project.target;
}
export function register(value: string, args: CommandArgs<'register'>) {
  const [path, project] = loadProject(value), workspace = dirname(path), file = resolve(args.path);
  if (args.phase === 'capture') { invalidate(project, ['plan', 'components', 'index', 'verify'], ['plan', 'build-record', 'index', 'verify-report']); writeJson(path, project); }
  const kind = args.kind ?? basename(file).replace(/\.json$/, '');
  const errors = validate(kind as ArtifactKind, read(file));
  const artifact = { path: relative(workspace, file), kind, sha256: 'sha256:' + createHash('sha256').update(readFileSync(file)).digest('hex'), valid: !errors.length, errors, updatedAt: now(), producedBy: { pluginDir: resolve(pluginRoot), toolVersion: `design-lab ${pluginVersion()}`, ...pluginSource() } };
  project.artifacts[args.name] = artifact; writeJson(path, project); if (errors.length) throw new Error(`invalid ${args.name} artifact: ${errors.join('; ')}`);
  let coverage; if (args.phase === 'components') { coverage = componentCoverage(workspace, project); setPhase(path, project, 'components', coverage.planAvailable && !coverage.missing.length && !coverage.unexpected.length && !coverage.invalid.length ? 'complete' : 'running', coverage); } else if (args.phase) setPhase(path, project, args.phase, 'complete', { artifact: args.name });
  return { name: args.name, path: file, sha256: artifact.sha256, ...(coverage ? { componentCoverage: coverage } : {}) };
}
export function entries(workspace: string): PhaseLogEntry[] { try { return readFileSync(resolve(workspace, 'phase-log.jsonl'), 'utf8').split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); } catch { return []; } }
export function record(value: string, args: CommandArgs<'record'>) {
  const [path, project] = loadProject(value); if (args.phase === 'benchmark' && args.status === 'running' && entries(dirname(path)).some(e => e.phase === 'benchmark' && e.status === 'complete')) return { ignored: true, reason: 'the benchmark already has a recorded start and end; re-score with score_run.ts alone, which keeps them' };
  let detail: PhaseDetail | undefined; if(args.detail) { const value:unknown=JSON.parse(args.detail); if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('--detail must be a phase detail object'); detail=value as PhaseDetail; }
  if (args.status === 'waived') { if (!args.by) throw new Error('waived status requires --by <human-decider>'); if (!detail || typeof detail !== 'object' || !String(detail.reason || '').trim()) throw new Error('waived status requires --detail with a non-empty `reason`'); detail = { ...detail, by: args.by, waivedAt: now() }; }
  setPhase(path, project, args.phase, args.status, detail); return project.phases[args.phase]!;
}
export function status(value: string) { const [path, p] = loadProject(value); return { project: path, pluginVersion: p.pluginVersion, standardVersion: p.standardVersion, repository: p.repository, decisions: p.decisions, nextPhase: Object.entries(p.phases).find(([, phase]) => !['complete', 'approved', 'waived'].includes(phase.status ?? 'pending'))?.[0] ?? null, phases: p.phases, artifacts: Object.fromEntries(Object.entries(p.artifacts).map(([name, a]) => [name, { path: a.path, valid: a.valid }])) }; }
export const secondsSince = (stamp: unknown): number | null => typeof stamp === 'string' && Number.isFinite(Date.parse(stamp)) ? (Date.now() - Date.parse(stamp)) / 1000 : null;
export function watchSummary(workspace: string): Summary {
  workspace = resolve(workspace); const p = optional<Project>(resolve(workspace, 'project.json')); if (!p) return { found: false, workspace };
  const progress = optional<ArtifactMap['progress']>(resolve(workspace, 'figma/progress.json')), log = entries(workspace), last = log.at(-1), card = optional<Partial<ArtifactMap['scorecard']>>(resolve(workspace, 'benchmark/scorecard.json'), {}), checks = optional<ChecklistDocument>(resolve(workspace, 'preflight-checks.json'));
  const serverAge = secondsSince(progress?.at), seenAge = secondsSince(progress?.lastSeen), serverAlive = serverAge !== null && serverAge * 1000 <= SERVER_FRESH_MS, connected = serverAlive && (seenAge !== null && seenAge * 1000 <= RUNNER_ABSENT_MS || !!progress?.inflight);
  const phases = Object.entries(p.phases ?? {}).map(([name, phase]) => ({ name, status: phase?.status ?? 'pending' })), stamp = card.run?.buildCreatedAt, recap = resolve(workspace, 'benchmark/completion.md');
  const startedAt = (p.phases?.['preflight']?.from ? null : p.phases?.['preflight']?.updatedAt) || p.createdAt;
  const oldChecks = p.phases?.['preflight']?.status === 'complete' && !p.phases?.['preflight']?.from && secondsSince(checks?.at) !== null && secondsSince(p.phases['preflight'].updatedAt) !== null && secondsSince(checks?.at)! > secondsSince(p.phases['preflight'].updatedAt)!;
  return { found: true, workspace, ...(p.run?.siteLabel!=null?{siteLabel:p.run.siteLabel}:{}), phases, nextPhase: phases.find(phase => !['complete', 'approved', 'waived'].includes(phase.status))?.name ?? null, preflightChecks: oldChecks ? null : checks?.checks ?? null, runner: progress ? { serverAlive, connected, lastSeenSeconds: seenAge, state: progress.state, stepsDone: progress.stepsDone, stepsTotal: progress.stepsTotal, stepKind: progress.stepKind && isStepKind(progress.stepKind) ? progress.stepKind : null, message: progress.message } : null, blocker: !connected && last?.status === 'stopped' ? last.message ?? null : null, waiting: !connected && last?.status === 'waiting' ? last.message ?? null : null, recap: existsSync(recap) && (typeof stamp === 'string' ? stamp === p.createdAt : p.phases?.['benchmark']?.status === 'complete') ? recap : null, startedAt: startedAt ?? null, elapsedSeconds: secondsSince(startedAt) };
}
export function watchWorkspace(given?: string, cwd = process.cwd()): string {
  if (given) return resolve(given); const [run, folder] = config.currentRun(cwd); if (folder && !run) throw new Error(`no design-lab run yet in ${folder}`);
  const workspace = run || optional<{workspace?:string}>(resolve(runner.designLabHome(), 'active-run.json'), {}).workspace; if (!workspace) throw new Error('no design-lab run found for this folder; give the run folder with --project'); return workspace;
}
export function renderWatch(summary: Summary): string {
  if (!summary.found) return `No design-lab run in ${summary.workspace}: it has no project.json.`;
  const marks: Partial<Record<string,string>> = { complete: '✓', approved: '✓', waived: '✓', running: '▸', stopped: '!' }, checks: Partial<Record<string,string>> = { done: '✓', checking: '▸', 'needs-you': '!', failed: '✗', waiting: '·' };
  const lines = [`design-lab · ${summary.siteLabel || basename(summary.workspace)}`, `Run folder: ${summary.workspace}`];
  if (summary.elapsedSeconds !== null && !summary.recap) { const minutes = Math.max(0, Math.floor(summary.elapsedSeconds / 60)); lines.push(minutes >= 60 ? `Elapsed: ${Math.floor(minutes / 60)}h ${minutes % 60}m` : `Elapsed: ${minutes}m`); } lines.push('');
  if (summary.preflightChecks?.length) { lines.push('  Preflight'); for (const c of summary.preflightChecks) lines.push(`    ${checks[c.status] || '·'} ${c.label || c.id}${c.message && ['checking', 'needs-you', 'failed'].includes(c.status) ? ': ' + c.message : ''}`); lines.push(''); }
  const running = summary.phases.some((p) => p.status === 'running'); for (const p of summary.phases) lines.push(`  ${!running && p.name === summary.nextPhase && !marks[p.status] ? '▸' : marks[p.status] || '·'} ${p.name}`);
  const r = summary.runner; if (r) { lines.push(''); if (['building', 'done'].includes(r.state) && r.stepsTotal) lines.push(`  steps ${r.stepsDone || 0}/${r.stepsTotal}${r.state === 'building' && r.stepKind ? ', ' + r.stepKind : ''}`); else if (r.message) lines.push(`  ${r.message}`); if (!summary.recap) lines.push(!r.serverAlive ? '  runner server not responding' : r.connected ? '  runner connected' : summary.waiting ? '  waiting for the runner to start' : r.state === 'waiting' ? '  runner idle until the build' : `  runner not seen for ${Math.max(1, Math.round((r.lastSeenSeconds || 0) / 60))}m`); }
  if (summary.blocker || summary.waiting) lines.push('', `  Needs you: ${summary.blocker || summary.waiting}`); if (summary.recap) lines.push('', `  Recap: ${summary.recap}`); return lines.join('\n');
}
export const REPORT_TOPICS = ['capture', 'selectors', 'plan', 'verify', 'build', 'fonts'];
function counts(values: string[]): [string, number][] { const result = new Map<string, number>(); for (const value of values) result.set(value, (result.get(value) ?? 0) + 1); return [...result].sort((a, b) => b[1] - a[1]); }
export function reportLines(workspace: string, topic: string): string[] {
  const files = (folder: string) => existsSync(resolve(workspace, folder)) ? readdirSync(resolve(workspace, folder)).filter(n => n.endsWith('.json')).sort() : [];
  if (topic === 'capture') { const configs = files('capture/configs'), records = files('capture/records').map(n => ({ id: n.replace(/\.json$/, ''), ...optional<Partial<CaptureRecord>>(resolve(workspace, 'capture/records', n), {}) })); if (!configs.length && !records.length) return ['capture has not started: no capture configs or records yet']; return [`${records.length} of ${configs.length} component(s) captured: ${counts(records.map(r => r.status || 'unknown')).map(([s, n]) => `${n} ${s}`).join(', ') || 'none yet'}`, ...records.filter(r => r.status !== 'complete').map(r => `  ${r.componentId || r.id}: ${r.status}${r.problems?.length ? ' - ' + r.problems.slice(0, 2).join('; ').slice(0, 160) : ''}`)].slice(0, 40); }
  if (topic === 'selectors') { const c = optional<SelectorResult[]>(resolve(workspace, 'capture/selector-check.json'), []), bad = c.filter((r) => !r.chosen); return [`${c.length} component(s) checked, ${bad.length} without a visible match on any page`, ...bad.slice(0, 40).map((r) => `  ${r.componentId}: ${(r.pages ?? []).slice(0, 3).map((p) => `${p.path} (matches ${p.matches}, visible ${p.visible})`).join(', ') || 'no pages tried'}`)]; }
  if (topic === 'plan') { const p = optional<Partial<ArtifactMap['plan']>>(resolve(workspace, 'plan.json'), {}).plans ?? []; return [`${p.length} planned: ${counts(p.map((r) => r.verdict)).map(([v, n]) => `${n} ${v}`).join(', ')}`, ...counts(p.filter((r) => r.verdict !== 'build').map((r) => String(r.refuseReason || '').slice(0, 90))).slice(0, 12).map(([r, n]) => `  ${n} x ${r}`)]; }
  if (topic === 'verify') { const findings = optional<Partial<ArtifactMap['verify-report']>>(resolve(workspace, 'verify-report.json'), {}).open ?? []; return [`${findings.length} open finding(s): ${counts(findings.map((f) => f.severity ?? 'unknown')).map(([s, n]) => `${n} ${s}`).join(', ')}`, ...findings.slice(0, 30).map((f) => `  [${f.severity}] ${f.check} ${f.scope || ''}: ${String(f.detail || '').slice(0, 140)}`)]; }
  if (topic === 'fonts') { const doc = optional<ArtifactMap['fonts']>(resolve(workspace, 'fonts.json')); return doc ? fonts.summaryLines(doc) : ['no font plan yet: workflow.ts connect writes it']; }
  if (topic === 'build') { const state = optional<BuildState>(resolve(workspace, 'figma/state.json'), {}), path = resolve(workspace, 'figma/runner.log'), lines = existsSync(path) ? readFileSync(path, 'utf8').trimEnd().split(/\r?\n/) : [], failures = lines.filter(l => l.includes('FAILED')); return [`build steps: ${state.done?.length || 0} of ${state.steps?.length || 0} recorded`, `failures in the runner log: ${failures.length}`, ...failures.slice(-5).map(l => '  ' + l.slice(0, 200)), ...lines.slice(-2).map(l => 'last: ' + l)]; }
  throw new Error(`unknown report ${topic}: one of ${REPORT_TOPICS.join(', ')}`);
}
export async function fontPlan(workspace: string, project: Project, available: fonts.AvailableFonts | null): Promise<string[]> {
  const listing = resolve(workspace, 'figma/available-fonts.json'); if (available) writeJson(listing, available); else available = optional<fonts.AvailableFonts>(listing);
  const doc = fonts.finalise(await fonts.plan({ run: workspace, repo: project.repository.root, ...(project.decisions?.sitestudioConfig!==undefined?{sitestudio:project.decisions.sitestudioConfig}:{}), figma: available })); doc.generatedAt = now(); writeJson(resolve(workspace, 'fonts.json'), doc); return fonts.summaryLines(doc);
}
export async function siteResponse(url: string): Promise<{ reachable: boolean; detail: string; html?: string }> {
  return await new Promise(done => { let request: import('node:http').ClientRequest; try { request = (url.startsWith('https:') ? httpsRequest : httpRequest)(url, { rejectUnauthorized: false, timeout: 10_000 }, response => { const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => done({ reachable: (response.statusCode ?? 500) < 500, detail: `HTTP ${response.statusCode}`, html: Buffer.concat(chunks).toString('utf8') })); response.on('error', error => done({ reachable: false, detail: error.message })); }); request.on('error', error => done({ reachable: false, detail: error.message })); request.on('timeout', () => request.destroy(new Error('site request timed out'))); request.end(); } catch (error) { done({ reachable: false, detail: String(error) }); } });
}
export class Checklist {
  path: string; document: ChecklistDocument;
  constructor(workspace: string) { this.path = resolve(workspace, 'preflight-checks.json'); this.document = { pass: now(), at: now(), ready: null, checks: [] }; }
  record(id: string, label: string, status: CheckStatus, message: string | null = null, dependsOn: string[] = []): void { const check = { id, label, status, message, dependsOn, at: now() }, index = this.document.checks.findIndex((c) => c.id === id); if (index < 0) this.document.checks.push(check); else this.document.checks[index] = check; this.write(); }
  write(): void { this.document.at = now(); writeJson(this.path, this.document); }
  finish(ready: boolean, goAheadAt: string | null = null): void { Object.assign(this.document, { ready, goAheadAt }); this.write(); }
}
export interface PreflightDeps { siteResponse?: typeof siteResponse; serverStatus?: typeof runner.serverStatus; browserReady?: () => [boolean, string]; svgReady?: () => Promise<void> }
export async function preflight(value: string, args: CommandArgs<'preflight'>, deps: PreflightDeps = {}) {
  const [path, project] = loadProject(value), p = project, workspace = dirname(path), run = p.run ?? {}, checklist = new Checklist(workspace), missing: string[] = [], checks: NonNullable<PhaseDetail['checks']> = {};
  const answer = (id: string, label: string, value: unknown, needed: string) => { if (!value) missing.push(needed); checklist.record(id, label, value ? 'done' : 'needs-you', value ? null : `Still needed: ${needed}.`); };
  const siteUrl = args['site-url'] || run.siteUrl, siteLabel = args['site-label'] || run.siteLabel, operator = args.operator || run.operator, key = figmaKey(args['figma-url']), usage = p.decisions?.usageSource;
  for (const [id, label] of [['site-url', 'Local site address'], ['site', 'Local site'], ['site-label', 'Site label for reports'], ['operator', "Operator's name"], ['figma-url', 'Target Figma file address'], ['runner-port', 'Runner port'], ['browser', 'Playwright browser'], ['sharp', 'SVG renderer'], ['plugin-version', 'Plugin version']]) checklist.record(id!, label!, id === 'site' ? 'waiting' : 'checking');
  answer('site-url', 'Local site address', siteUrl, 'the local site address (--site-url)');
  if (siteUrl) { const result = await (deps.siteResponse ?? siteResponse)(siteUrl); checks.site = { url: siteUrl, reachable:result.reachable, detail:result.detail }; answer('site', 'Local site', result.reachable, `a running local site at ${siteUrl} (${result.detail})`); if (result.html !== undefined) { const { enabled } = await import('./capture/twig.ts'); checks.twigDebug = { enabled: enabled(result.html) }; checklist.record('twig-debug', 'Twig debug markup', 'done', checks.twigDebug?.enabled ? null : 'Twig debug is off; the run turns it on at capture.'); } }
  answer('site-label', 'Site label for reports', siteLabel, 'a neutral site label for reports (--site-label)'); answer('operator', "Operator's name", operator, "the operator's name (--operator)"); answer('figma-url', 'Target Figma file address', key, 'the target Figma file address, https://www.figma.com/design/<file-key>/... (--figma-url)');
  if (usage && usage !== 'none') { const root = resolve(args['ddev-root'] || p.repository.root), ddevProject = existsSync(resolve(root, '.ddev')); checks.usage = { source: usage, ddevRoot: root, ddevProject }; answer('usage', `DDEV project for the ${usage} usage source`, ddevProject || args['usage-fallback'] === 'untiered', `a DDEV project at ${root}, or --usage-fallback untiered`); }
  if (key) { const previous = p.target?.figmaFileKey; if (previous && previous !== key) invalidate(project, ['foundation', 'components', 'index', 'verify'], ['foundation', 'build-record', 'index', 'verify-report']); const connection = previous === key ? p.target?.connection || p.target?.preflight : null; p.target = { figmaFileKey: key, ...(args['figma-url']!==undefined?{figmaUrl:args['figma-url']} : {}), recordedAt: now(), ...(connection ? { connection } : {}) }; writeJson(path, p); } writeActiveRun(workspace);
  const state = await (deps.serverStatus ?? runner.serverStatus)(workspace); checks.runner = state; const usable = !state.portInUse || state.alive || !!state.otherRun && runner.runFinished(state.otherRun);
  answer('runner-port', 'Runner port', usable, state.otherRun ? `Stop the other run with node ${resolve(pluginRoot, 'scripts/figma_runner.ts')} stop --project ${state.otherRun}` : `Stop the program using 127.0.0.1:${runner.PORT}`);
  const [browserOk, browserDetail] = (deps.browserReady ?? playwrightReady)(); let nodeCwd: string | null = dependencyFolder(), ready = browserOk;
  if (args['node-cwd']) { nodeCwd = resolve(args['node-cwd']); const probe = spawnSync(process.execPath, ['-e', "const fs=require('node:fs');process.exit(fs.existsSync(require('playwright').chromium.executablePath())?0:1)"], { cwd: nodeCwd, encoding: 'utf8', timeout: 30_000 }); ready = probe.status === 0; }
  checks.browser = { nodeCwd, executable: process.env['DESIGN_LAB_BROWSER_EXECUTABLE'] ?? null }; answer('browser', 'Playwright browser', ready, `${browserDetail}; run node ${resolve(pluginRoot, 'scripts/lab_setup.ts')} install playwright`);
  try { const sharp = sharedRequire()('sharp') as typeof import('sharp').default; if (deps.svgReady) await deps.svgReady(); else await sharp(Buffer.from('<svg width="1" height="1"></svg>')).png().toBuffer(); checks.sharp = { available: true }; checklist.record('sharp', 'SVG renderer', 'done'); } catch { checks.sharp = { available: false }; answer('sharp', 'SVG renderer', false, 'run design-lab:init to install the pinned Sharp dependency'); }
  const recorded = run.plugin?.version; checks.pluginVersion = { recorded: recorded ?? null, current: pluginVersion() }; answer('plugin-version', 'Plugin version', !recorded || recorded === pluginVersion(), `Finish or restart the run on one plugin version (${recorded} to ${pluginVersion()})`);
  if (/sitestudio/.test(`${p.decisions?.componentSource} ${p.decisions?.tokenSource}`)) answer('sitestudio-config', 'Site Studio configuration folder', p.decisions.sitestudioConfig && existsSync(p.decisions.sitestudioConfig), 'Name the Site Studio export folder with workflow.ts select --sitestudio-config <folder>');
  if (missing.length) { checklist.finish(false); return { ready: false, missing, checks, message: 'Still needed before the run can go ahead unattended: ' + missing.join('; ') + '.' }; }
  if(!siteUrl||!siteLabel||!operator) throw new Error('preflight answers missing');
  Object.assign(run, { siteUrl, siteLabel, operator }); if (args.model) { run.claude ??= {}; run.claude.model = args.model; } p.run = run;
  const at = now(), detail = { siteUrl, publicUrl: args['public-url'] ?? null, ...(args['figma-url']!==undefined?{figmaUrl:args['figma-url']} : {}), siteLabel, operator, model: args.model ?? null, planApproval: args['plan-approval'] ?? 'proposed', usageFallback: args['usage-fallback'] ?? 'stop', ddevRoot: args['ddev-root'] ?? null, schemaChurn: 'recorded by the run at the benchmark, without asking', checks, goAheadAt: at };
  setPhase(path, p, 'preflight', 'complete', detail, at); checklist.finish(true, at); return { ready: true, goAheadAt: at, checks, message: "I have everything I need; it's safe to let this run to completion." };
}
export const buildPhase = (project: Project): PhaseName => (['foundation', 'components', 'index'] as const).find(name => !['complete', 'approved', 'waived'].includes(project.phases?.[name]?.status??'')) ?? 'components';
export async function awaitRunner(workspace: string, project: Project, minutes = 2, pollMs = 5000) {
  if (!(minutes > 0)) throw new Error('--minutes must be positive'); await runner.ensureServer(workspace); const deadline = performance.now() + minutes * 60_000; let last: string | null = null;
  do { try { last = readFileSync(resolve(workspace, 'figma', runner.SEEN_FILE), 'utf8').trim(); } catch {} if (secondsSince(last) !== null && secondsSince(last)! <= minutes * 60) return { connected: true, lastSeen: last }; if ((await runner.serverStatus(workspace)).inflight) return { connected: true, inflight: true, lastSeen: last }; if (performance.now() >= deadline) break; await new Promise(done => setTimeout(done, Math.min(pollMs, deadline - performance.now()))); } while (true);
  const whole = Math.max(1, Math.round((secondsSince(last) ?? minutes * 60) / 60)), address = project.target?.figmaUrl || 'the target Figma file', message = `Open Figma desktop, open ${address}, and start the design-lab runner. The build writes the component library into that file through the runner, and it has not connected for ${whole} minute${whole === 1 ? '' : 's'}.`, phase = buildPhase(project);
  appendJsonl(resolve(workspace, 'phase-log.jsonl'), { at: now(), phase, status: 'stopped', reason: 'runner not connected', message }); return { connected: false, phase, message };
}
export async function connect(value: string, timeout: number, dependencies: { handshake?: () => Promise<Handshake> } = {}) {
  if (!(timeout > 0)) throw new Error('--runner-timeout must be positive'); const [path, project] = loadProject(value), p = project, workspace = dirname(path), earlier = p.target?.connection || p.target?.preflight || {}, key = p.target?.figmaFileKey || earlier.fileKey, url = p.target?.figmaUrl || earlier.fileUrl;
  if (!key || !url) throw new Error('the target Figma file is not recorded; run workflow.ts preflight first');
  let handshake: Handshake;
  try {
    if (dependencies.handshake) handshake = await dependencies.handshake(); else {
    const install = runner.installRunner(), server = await runner.ensureServer(workspace), instructions = [...(install.firstInstall ? [`Import the runner once in Figma desktop from ${install.manifest}.`] : install.updated ? [`The runner was updated to ${install.version}; close it and start it again.`] : []), `Open the target file (${url}) in Figma desktop and start the design-lab runner. If it asks for a token, copy yours in your own terminal with: pbcopy < ${resolve(runner.designLabHome(), runner.TOKEN_FILE)}.`];
    console.error(instructions.join('\n')); appendJsonl(resolve(workspace, 'phase-log.jsonl'), { at: now(), phase: 'connect', status: 'waiting', reason: 'runner connection', message: instructions.join(' ') });
    const state = optional<BuildState>(resolve(workspace, 'figma/state.json'), {}), begun = state.fileKey === key && !!state.steps?.length;
    runner.requestHandshake(workspace, { ground: COVER_GROUND, headline: siteName(p.repository?.root || workspace), subtitle: 'Component Library', provenance: { stage: 'connect' }, version: STANDARD_VERSION }, earlier.coverPageId ?? null, begun);
    handshake = { ...await runner.waitForHandshake(workspace, timeout), server: { pid: server.pid, started: server.started }, install, instructions };
    }
  } catch (error) { handshake = { ok: false, failure: String(error) }; }
  writeActiveRun(workspace, handshake.server?.pid ?? null);
  if (!handshake.ok) { const failure = handshake.failure || 'the target Figma file could not be connected'; appendJsonl(resolve(workspace, 'phase-log.jsonl'), { at: now(), phase: 'connect', status: 'stopped', reason: 'runner not connected', message: failure }); return { ok: false, failure, handshake }; }
  const [latest, fresh] = loadProject(path), q = fresh;
  const connection: NonNullable<NonNullable<Project['target']>['connection']> = handshake.connectionOnly
    ? {...earlier,fileKey:key,fileUrl:url,...(handshake.at!==undefined?{reconnectedAt:handshake.at}:{})}
    : {fileKey:key,fileUrl:url,coverPageId:handshake.coverPageId??null,coverId:handshake.coverId??null,font:handshake.font??null,fontLoaded:handshake.fontLoaded??null,at:handshake.at??null};
  q.target ??= {}; q.target.connection = connection;
  setPhase(latest,q,'connect','complete',{fileKey:key,fileUrl:url,runnerConnected:handshake.runnerConnected??null,fileKeyMatches:handshake.fileKeyMatches??null,empty:handshake.empty??null,onlyPreflightCover:handshake.onlyPreflightCover??null,writable:handshake.writable??null,pluginData:handshake.pluginData??null,connectionOnly:handshake.connectionOnly??null,coverPageId:handshake.coverPageId??null,coverId:handshake.coverId??null,font:handshake.font??null,fontLoaded:handshake.fontLoaded??null},handshake.at||now());
  try { console.error((await fontPlan(workspace, q, handshake.fonts ?? null)).join('\n')); } catch (error) { console.error(`The font plan was not written (${error}); the build draws missing fonts in Inter.`); } delete handshake.fonts;
  return { ok: true, connection, handshake, fontPlan: resolve(workspace, 'fonts.json') };
}
export async function awaitBuild(value: string, timeout: number, deps: { ensureServer?: typeof runner.ensureServer; stopServer?: typeof runner.stopServer; waitForBuild?: typeof rebuild.waitForBuild } = {}): Promise<void> {
  if (!(timeout > 0)) throw new Error('--timeout must be positive'); const [path] = loadProject(value), workspace = dirname(path); await (deps.ensureServer ?? runner.ensureServer)(workspace);
  try { await (deps.waitForBuild ?? rebuild.waitForBuild)(workspace, timeout); } catch (error) { await (deps.stopServer ?? runner.stopServer)(workspace); const [, project] = loadProject(path), p = project, state = optional<BuildState>(resolve(workspace, 'figma/state.json'), {}), next = state.steps?.find((s) => !state.done?.includes(s.id))?.id; let phase = buildPhase(p);
    if (state.steps?.length) phase = !next || ['examples', 'cover', 'getting-started'].includes(next) ? 'index' : ['wipe', 'pages', 'variables'].includes(next) || next.startsWith('foundation:') ? 'foundation' : 'components';
    const message = `Fix what ${resolve(workspace, 'figma/runner.log')} reports, then run the build again; the skill will rerun await-build. The runner in Figma keeps retrying; if it closed, open ${p.target?.figmaUrl || 'the target Figma file'} in Figma desktop and restart it. This run's server was stopped so the next wait clears the failure latch and resumes the failed step. The build did not finish: ${error}`;
    appendJsonl(resolve(workspace, 'phase-log.jsonl'), { at: now(), phase, status: 'stopped', reason: String(error), message }); throw new Error(message);
  }
}
