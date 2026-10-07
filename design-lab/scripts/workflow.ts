#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as workflow from '../src/workflow.ts';
import * as discovery from '../src/discovery-workflow.ts';
import * as runner from '../src/figma-runner.ts';
import * as rebuild from '../src/rebuild.ts';
import * as config from '../src/lab-config.ts';

const common = ['project'], identity = ['site-label', 'site-url', 'operator', 'model'];
export const COMMANDS: Record<string, { flags: string[]; required?: string[]; help: string }> = {
  init: { flags: ['repo', 'workspace', 'force', 'allow-in-repository', ...identity], required: ['repo'], help: 'Create a personal run folder' },
  'figma-build': { flags: ['from', 'figma-url', 'repo', 'site-label', 'model', 'workspace'], required: ['from', 'figma-url', 'repo'], help: 'Rebuild saved capture and an approved plan' },
  'await-build': { flags: [...common, 'timeout'], required: common, help: 'Wait for build and verification dumps' },
  finish: { flags: [...common, 'session'], required: common, help: 'Write receipts, verify and benchmark' },
  identity: { flags: [...common, ...identity, 'no-schema-change', 'schema-change'], help: 'Correct run identity' },
  detect: { flags: common, help: 'Detect source strategies' }, select: { flags: [...common, 'component', 'token', 'usage', 'degraded-reason', 'by', 'sitestudio-config'], help: 'Select detected sources' },
  extract: { flags: [...common, 'kind'], help: 'Extract inventory and tokens' }, usage: { flags: [...common, 'ddev-root', 'ddev-project', 'base-url', 'without-twig-debug', 'high', 'medium'], help: 'Extract site usage' },
  plan: { flags: common, help: 'Plan components' }, variables: { flags: common, help: 'Plan variables' },
  preflight: { flags: [...common, ...identity, 'public-url', 'figma-url', 'node-cwd', 'ddev-root', 'plan-approval', 'usage-fallback'], help: 'Check answers before an unattended run' },
  fonts: { flags: common, required: common, help: 'Report Figma font availability and stand-ins' }, report: { flags: common, required: common, help: 'Summarize capture|selectors|plan|verify|build|fonts' },
  connect: { flags: [...common, 'runner-timeout'], required: common, help: 'Connect the runner to the target file' }, runner: { flags: [...common, 'ensure', 'await-runner', 'minutes'], help: 'Check or restart the runner' },
  approve: { flags: [...common, 'by', 'from-preflight'], help: 'Approve the proposed plan' }, target: { flags: [...common, 'figma-url'], required: ['figma-url'], help: 'Record target Figma file' },
  register: { flags: [...common, 'name', 'path', 'kind', 'phase'], required: ['name', 'path'], help: 'Register validated artifact' }, record: { flags: [...common, 'phase', 'status', 'detail', 'by'], required: ['phase', 'status'], help: 'Record phase status' },
  validate: { flags: common, help: 'Validate manifests, receipts and completion' }, status: { flags: common, help: 'Show run state' }, watch: { flags: common, help: 'Show phases, runner, blocker and recap' }, runs: { flags: ['finished', 'json'], help: 'List project runs newest first' },
};
const booleans = new Set(['force', 'allow-in-repository', 'no-schema-change', 'without-twig-debug', 'ensure', 'await-runner', 'from-preflight', 'finished', 'json']);
const choices: Record<string, string[]> = { kind: ['components', 'tokens', 'all'], 'plan-approval': ['proposed', 'review'], 'usage-fallback': ['stop', 'untiered'], status: ['pending', 'running', 'complete', 'failed', 'waived'] };
export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv, spec = COMMANDS[command ?? ''];
  if (!command || command === '--help' || command === '-h') { console.log('usage: workflow.ts <command> [flags]\n' + Object.entries(COMMANDS).map(([name, spec]) => `  ${name.padEnd(14)} ${spec.help}`).join('\n')); return 0; }
  if (!spec) throw new Error(`unknown command: ${command}`);
  if (args.includes('--help') || args.includes('-h')) { console.log(`usage: workflow.ts ${command}${command === 'report' ? ' TOPIC' : ''} [flags]\n${spec.help}\n` + spec.flags.map(f => `  --${f}${booleans.has(f) ? '' : ' VALUE'}${spec.required?.includes(f) ? ' (required)' : ''}`).join('\n')); return 0; }
  const options = Object.fromEntries(spec.flags.map(name => [name, { type: booleans.has(name) ? 'boolean' : 'string', ...(name === 'schema-change' ? { multiple: true } : {}) }])) as Record<string, { type: 'string' | 'boolean'; multiple?: boolean }>;
  const { values, positionals } = parseArgs({ args, options, allowPositionals: command === 'report' }); const a = values as workflow.Dict;
  for (const flag of spec.required ?? []) if (!a[flag]) throw new Error(`--${flag} is required`);
  const project = a.project ?? '.design-lab', workspace = () => dirname(discovery.loadProject(project)[0]);
  for (const [flag, allowed] of Object.entries(choices)) if (a[flag] && !(flag === 'kind' && command === 'register') && !allowed.includes(a[flag])) throw new Error(`--${flag} must be one of ${allowed.join(', ')}`);
  const number = (name: string, fallback: number, integer = false) => { const n = a[name] === undefined ? fallback : Number(a[name]); if (!Number.isFinite(n) || integer && !Number.isInteger(n)) throw new Error(`--${name} must be ${integer ? 'an integer' : 'a number'}`); return n; };
  let result: unknown, code = 0, plain = false;
  switch (command) {
    case 'init': result = workflow.init(a); break;
    case 'figma-build': result = workflow.figmaBuild(a); break;
    case 'await-build': try { await workflow.awaitBuild(project, number('timeout', 1800)); } catch (error) { console.error(String(error)); return 1; } return 0;
    case 'finish': { const r = await rebuild.evaluate(workspace(), a.session); result = { completion: resolve(workspace(), 'benchmark/completion.md'), report: resolve(workspace(), 'benchmark/report.html'), ...r }; break; }
    case 'identity': result = workflow.identity(project, a); break;
    case 'detect': result = discovery.detectProject(project); break;
    case 'select': result = discovery.selectProject(project, { component: a.component, token: a.token, usage: a.usage, sitestudioConfig: a['sitestudio-config'], degradedReason: a['degraded-reason'], by: a.by }); break;
    case 'extract': result = await discovery.extractProject(project, a.kind ?? 'all'); break;
    case 'usage': result = await discovery.usageProject(project, { ddevRoot: a['ddev-root'], ddevProject: a['ddev-project'], baseUrl: a['base-url'], withoutTwigDebug: a['without-twig-debug'], high: number('high', 50, true), medium: number('medium', 10, true) }); break;
    case 'plan': result = discovery.planProject(project); break;
    case 'variables': result = discovery.variablesProject(project); break;
    case 'preflight': result = await workflow.preflight(project, a); code = (result as workflow.Dict).ready ? 0 : 1; break;
    case 'connect': result = await workflow.connect(project, number('runner-timeout', 300)); code = (result as workflow.Dict).ok ? 0 : 1; break;
    case 'runner': if (a['await-runner']) { result = await workflow.awaitRunner(workspace(), discovery.loadProject(project)[1], number('minutes', 2)); code = (result as workflow.Dict).connected ? 0 : 1; } else result = a.ensure ? await runner.ensureServer(workspace()) : await runner.serverStatus(workspace()); break;
    case 'fonts': result = (await workflow.fontPlan(workspace(), discovery.loadProject(project)[1], null)).join('\n'); plain = true; break;
    case 'report': if (positionals.length !== 1 || !workflow.REPORT_TOPICS.includes(positionals[0]!)) throw new Error('report requires a topic: ' + workflow.REPORT_TOPICS.join(', ')); result = workflow.reportLines(workspace(), positionals[0]!).join('\n'); plain = true; break;
    case 'approve': result = workflow.approve(project, a); break;
    case 'target': result = workflow.target(project, a['figma-url']); break;
    case 'register': if (a.phase && !['usage', 'capture', 'foundation', 'components', 'index', 'verify'].includes(a.phase)) throw new Error('invalid --phase'); result = workflow.register(project, a); break;
    case 'record': if (!['usage', 'capture', 'foundation', 'components', 'index', 'verify', 'benchmark'].includes(a.phase)) throw new Error('invalid --phase'); result = workflow.record(project, a); break;
    case 'validate': result = rebuild.validateProject(workspace()); code = (result as workflow.Dict).valid ? 0 : 1; break;
    case 'status': result = workflow.status(project); break;
    case 'watch': result = workflow.renderWatch(workflow.watchSummary(workflow.watchWorkspace(a.project))); plain = true; break;
    case 'runs': { const folder = config.runsFolder(process.cwd()), rows = config.runsIn(folder).reverse().map(workspace => { const p = workflow.optional(resolve(workspace, 'project.json'), {}); return { folder: workspace, siteLabel: p.run?.siteLabel ?? null, createdAt: p.createdAt ?? null, finished: !!workflow.watchSummary(workspace).recap }; }).filter(r => !a.finished || r.finished); if (!rows.length) { console.error(`No ${a.finished ? 'finished ' : ''}design-lab runs in ${folder}.`); return 1; } result = a.json ? rows : rows.map(r => `${r.folder}\t${r.siteLabel || config.projectName(r.folder)}\t${r.createdAt || 'unknown'}\t${r.finished ? 'finished' : 'unfinished'}`).join('\n'); plain = !a.json; break; }
  }
  console.log(plain ? result : JSON.stringify(result, null, 2)); return code;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) try { process.exitCode = await main(); } catch (error) { console.error(`error: ${(error as Error).message}`); process.exitCode = 2; }
