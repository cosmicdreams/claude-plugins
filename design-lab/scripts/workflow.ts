#!/usr/bin/env node
import {REGISTRABLE_PHASES,RECORDABLE_PHASES} from '../src/protocol.ts';
import type {PhaseName,RegistrablePhase,RecordablePhase} from '../src/protocol.ts';
import { failureCode } from '../src/exit-code.ts';
import { isEntrypoint } from '../src/entrypoint.ts';
import { parseArgs } from 'node:util';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import * as workflow from '../src/workflow.ts';
import * as discovery from '../src/discovery-workflow.ts';
import * as runner from '../src/figma-runner.ts';
import * as rebuild from '../src/rebuild.ts';
import * as config from '../src/lab-config.ts';

const common = ['project'] as const, identity = ['site-label', 'site-url', 'operator', 'model'] as const;
type CommandName = 'init'|'figma-build'|'await-build'|'finish'|'identity'|'detect'|'select'|'extract'|'usage'|'plan'|'variables'|'preflight'|'fonts'|'report'|'connect'|'runner'|'approve'|'target'|'register'|'record'|'validate'|'status'|'watch'|'runs';
type CommandSpec = {flags:readonly string[];required?:readonly string[];help:string};
export const COMMANDS = {
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
} as const satisfies Record<CommandName,CommandSpec>;

export const BOOLEAN_FLAGS = ['force', 'allow-in-repository', 'no-schema-change', 'without-twig-debug', 'ensure', 'await-runner', 'from-preflight', 'finished', 'json'] as const;
const booleans: ReadonlySet<string> = new Set(BOOLEAN_FLAGS);
export const CHOICES = { kind: ['components', 'tokens', 'all'], 'plan-approval': ['proposed', 'review'], 'usage-fallback': ['stop', 'untiered'], status: ['pending', 'running', 'complete', 'failed', 'waived'] } as const;
type Flag<C extends CommandName> = typeof COMMANDS[C]['flags'][number];
type RequiredFlag<C extends CommandName> = typeof COMMANDS[C] extends {readonly required:readonly (infer F)[]} ? F : never;
type FlagValue<C extends CommandName, F extends Flag<C>> = F extends typeof BOOLEAN_FLAGS[number] ? boolean : F extends 'phase' ? C extends 'register' ? RegistrablePhase : C extends 'record' ? RecordablePhase : PhaseName : F extends 'schema-change' ? string[] : F extends keyof typeof CHOICES ? C extends 'register' ? string : typeof CHOICES[F][number] : string;
export type CommandArgs<C extends CommandName> = { [F in Flag<C> as F extends RequiredFlag<C> ? F : never]: FlagValue<C,F> } & { [F in Flag<C> as F extends RequiredFlag<C> ? never : F]?: FlagValue<C,F> };
type ParsedCommand = {[C in CommandName]:{command:C;args:CommandArgs<C>;positionals:string[]}}[CommandName];
function isCommand(value:string):value is CommandName { return Object.hasOwn(COMMANDS,value); }
/** parseArgs and the required/choice checks validate the dynamic CLI boundary. */
export function parseCommand<C extends CommandName>(command:C, args:string[]):Extract<ParsedCommand,{command:C}> {
  const spec:CommandSpec = COMMANDS[command];
  const options:Record<string,{type:'string'|'boolean';multiple?:boolean}> = Object.fromEntries(spec.flags.map(name => [name, {type:booleans.has(name)?'boolean':'string',...(name==='schema-change'?{multiple:true}:{})}]));
  const {values,positionals}=parseArgs({args,options,allowPositionals:command==='report'});
  for(const flag of spec.required??[]) if(!values[flag]) throw new Error(`--${flag} is required`);
  for(const [flag,allowed] of Object.entries(CHOICES)) { const value=values[flag]; if(value && !(flag==='kind'&&command==='register') && (typeof value!=='string'||!(allowed as readonly string[]).includes(value))) throw new Error(`--${flag} must be one of ${allowed.join(', ')}`); }
  const phases:readonly string[]=command==='register'?REGISTRABLE_PHASES:RECORDABLE_PHASES;
  if(values['phase'] && (typeof values['phase']!=='string'||!phases.includes(values['phase']))) throw new Error('invalid --phase');
  return {command,args:values,positionals} as Extract<ParsedCommand,{command:C}>;
}
export const NUMBER_DEFAULTS = {timeout:1800,high:50,medium:10,'runner-timeout':300,minutes:2} as const;
function number(name:string, value:string|undefined, fallback:number, integer=false):number { const n=value===undefined?fallback:Number(value); if(!Number.isFinite(n)||integer&&!Number.isInteger(n)) throw new Error(`--${name} must be ${integer?'an integer':'a number'}`); return n; }
export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [given, ...args] = argv;
  if (!given || given === '--help' || given === '-h') { console.log('usage: workflow.ts <command> [flags]\n' + Object.entries(COMMANDS).map(([name, spec]) => `  ${name.padEnd(14)} ${spec.help}`).join('\n')); return 0; }
  if (!isCommand(given)) throw new Error(`unknown command: ${given}`);
  const spec:CommandSpec=COMMANDS[given]; const command=given;
  if (args.includes('--help') || args.includes('-h')) { console.log(`usage: workflow.ts ${command}${command === 'report' ? ' TOPIC' : ''} [flags]\n${spec.help}\n` + spec.flags.map(f => `  --${f}${booleans.has(f) ? '' : ' VALUE'}${spec.required?.includes(f) ? ' (required)' : ''}`).join('\n')); return 0; }
  const parsed=parseCommand(command,args);
  const project = 'project' in parsed.args ? parsed.args.project ?? '.design-lab' : '.design-lab', workspace = () => dirname(discovery.loadProject(project)[0]);
  const {command: name,args:a,positionals}=parsed;
  let result: unknown, code = 0, plain = false;
  switch (name) {
    case 'init': result = workflow.init(a); break;
    case 'figma-build': result = workflow.figmaBuild(a); break;
    case 'await-build': try { await workflow.awaitBuild(project, number('timeout', a['timeout'], NUMBER_DEFAULTS['timeout'])); } catch (error) { console.error(String(error)); return 1; } return 0;
    case 'finish': { const r = await rebuild.evaluate(workspace(), a.session); result = { completion: resolve(workspace(), 'benchmark/completion.md'), report: resolve(workspace(), 'benchmark/report.html'), ...r }; break; }
    case 'identity': result = workflow.identity(project, a); break;
    case 'detect': result = discovery.detectProject(project); break;
    case 'select': result = discovery.selectProject(project, {...(a.component!==undefined?{component:a.component}:{}),...(a.token!==undefined?{token:a.token}:{}),...(a.usage!==undefined?{usage:a.usage}:{}),...(a['sitestudio-config']!==undefined?{sitestudioConfig:a['sitestudio-config']}:{}),...(a['degraded-reason']!==undefined?{degradedReason:a['degraded-reason']}:{}),...(a.by!==undefined?{by:a.by}:{})}); break;
    case 'extract': result = await discovery.extractProject(project, a.kind ?? 'all'); break;
    case 'usage': result = await discovery.usageProject(project, {...(a['ddev-root']!==undefined?{ddevRoot:a['ddev-root']}:{}),...(a['ddev-project']!==undefined?{ddevProject:a['ddev-project']}:{}),...(a['base-url']!==undefined?{baseUrl:a['base-url']}:{}),...(a['without-twig-debug']!==undefined?{withoutTwigDebug:a['without-twig-debug']}:{}),high: number('high', a['high'], NUMBER_DEFAULTS['high'], true), medium: number('medium', a['medium'], NUMBER_DEFAULTS['medium'], true) }); break;
    case 'plan': result = discovery.planProject(project); break;
    case 'variables': result = discovery.variablesProject(project); break;
    case 'preflight': { const r=await workflow.preflight(project,a); result=r; code=r.ready?0:1; break; }
    case 'connect': { const r=await workflow.connect(project,number('runner-timeout', a['runner-timeout'], NUMBER_DEFAULTS['runner-timeout'])); result=r; code=r.ok?0:1; break; }
    case 'runner': if (a['await-runner']) { const r = await workflow.awaitRunner(workspace(), discovery.loadProject(project)[1], number('minutes', a['minutes'], NUMBER_DEFAULTS['minutes'])); result=r; code=r.connected?0:1; } else result = a.ensure ? await runner.ensureServer(workspace()) : await runner.serverStatus(workspace()); break;
    case 'fonts': result = (await workflow.fontPlan(workspace(), discovery.loadProject(project)[1], null)).join('\n'); plain = true; break;
    case 'report': if (positionals.length !== 1 || !workflow.REPORT_TOPICS.includes(positionals[0]!)) throw new Error('report requires a topic: ' + workflow.REPORT_TOPICS.join(', ')); result = workflow.reportLines(workspace(), positionals[0]!).join('\n'); plain = true; break;
    case 'approve': result = workflow.approve(project, a); break;
    case 'target': result = workflow.target(project, a['figma-url']); break;
    case 'register': result = workflow.register(project, a); break;
    case 'record': result = workflow.record(project, a); break;
    case 'validate': { const r=rebuild.validateProject(workspace()); result=r; code=r.valid?0:1; break; }
    case 'status': result = workflow.status(project); break;
    case 'watch': result = workflow.renderWatch(workflow.watchSummary(workflow.watchWorkspace(a.project))); plain = true; break;
    case 'runs': { const folder = config.runsFolder(process.cwd()), rows = config.runsIn(folder).reverse().map(workspace => { const p = workflow.optional<import('../src/generated/project.ts').Project>(resolve(workspace, 'project.json')); return { folder: workspace, siteLabel: p?.run?.siteLabel ?? null, createdAt: p?.createdAt ?? null, finished: !!workflow.watchSummary(workspace).recap }; }).filter(r => !a.finished || r.finished); if (!rows.length) { console.error(`No ${a.finished ? 'finished ' : ''}design-lab runs in ${folder}.`); return 1; } result = a.json ? rows : rows.map(r => `${r.folder}\t${r.siteLabel || config.projectName(r.folder)}\t${r.createdAt || 'unknown'}\t${r.finished ? 'finished' : 'unfinished'}`).join('\n'); plain = !a.json; break; }
  }
  console.log(plain ? result : JSON.stringify(result, null, 2)); return code;
}
if (isEntrypoint(import.meta.url)) try { process.exitCode = await main(); } catch (error) { console.error(`error: ${(error as Error).message}`); process.exitCode = failureCode(error); }
