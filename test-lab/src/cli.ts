#!/usr/bin/env node
import { resolve, join, dirname, relative } from 'node:path';
import { writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { coordinate, type CoordinatorRequest } from './coordinator.ts';
import { commandAdapter } from './local-adapter.ts';
import { inside, parseProfile, readJson } from './persistence.ts';
import { importSnapshot, readSnapshot } from './source.ts';
import { stageKit } from './staging.ts';
import { repoTop } from './git.ts';
import { currentBranch } from './work.ts';
import type { EnvironmentInputValue } from '../kit/environment-inputs.ts';

export const USAGE=`test-lab (Node 24+, installed suite Playwright; no package fetch)
Verdict:
  node src/cli.ts preflight|run --app-root PATH --suite-root PATH --env ID
      [--tier fast] [--work TICKET | --no-work] [--adapter ABSOLUTE_NODE_SCRIPT]
      [--inputs JSON_FILE] [--timeout-ms N]
  node src/cli.ts verify --app-root PATH --suite-root PATH --env ID [--work TICKET | --no-work]
  node src/cli.ts triage --run RUN_DIR --failure N --class CLASS --as qa|developer --suite-root PATH [--note TEXT]
Standard:
  node src/cli.ts check --suite SUITE_FOLDER [--suite-root CHECKOUT [--app-root PATH]] [--standard CLAUDE_MD] [--json]
Source (read-only; through a replaceable connector):
  node src/cli.ts source snapshot --project N --output NEW_DIR (CONNECTOR)
  node src/cli.ts source priorities --project N (CONNECTOR)
  node src/cli.ts source case --project N --id N (CONNECTOR)
      CONNECTOR: --connector testrail --helper ABSOLUTE_TESTRAIL_PY --account NAME
               | --connector file --responses FILE
  node src/cli.ts source --snapshot NORMALIZED_SNAPSHOT --output NEW_DIRECTORY
Corpus and roles:
  node src/cli.ts init --suite-root PATH --app-root PATH --project NAME --suite-id ID --config REL
      --env-id ID --base-url URL --base-url-env NAME --qa NAME [--qa-stand-in]
      --configurations JSON_FILE --fixture-map JSON_FILE [--base-branch B] [--remote R]
      [--app-remote R] [--app-branch B] [--health-path P] [--actor-path P] [--addendum-in suite|application]
  node src/cli.ts ingest --suite-root PATH --snapshot FILE [--cases C1,C2]
  node src/cli.ts case approve --suite-root PATH [--app-root PATH] --id ID --as qa|developer --reason TEXT [--add]
  node src/cli.ts regression add --suite-root PATH --id ID --as qa --reason TEXT
  node src/cli.ts work start|add|drop|close|import --suite-root PATH --app-root PATH --ticket T
      [--case ID] --as developer|qa --reason TEXT
Tests and evidence (add --app-root PATH wherever the corpus keeps its addendum in the application worktree):
  node src/cli.ts adopt --suite-root PATH --suite ID --file REL --title "A › B" --case ID
      --configuration C1[,C2] [--layer served|synthetic] [--obligations S1/O1,S1/O2]
  node src/cli.ts adopt --suite-root PATH --suite ID --legacy|--exclude GLOB --as qa --reason TEXT
  node src/cli.ts redcheck (RUN) --suite ID --file REL --title "A › B" --case ID --step S --obligation O
      --configuration C --recipe JSON_FILE
  node src/cli.ts burnin (RUN) --suite ID --file REL --title "A › B" --configuration C
  node src/cli.ts reverify (RUN)
      RUN: --suite-root PATH --app-root PATH --env ID --adapter ABSOLUTE_NODE_SCRIPT [--inputs FILE]
  node src/cli.ts accept --suite-root PATH --case ID --suite ID --file REL --title "A › B" --as qa|developer
  node src/cli.ts waive --suite-root PATH --case ID --step S --obligation O --as qa|developer --reason TEXT
  node src/cli.ts graduate propose --suite-root PATH --case ID --run RUN_DIR --reason TEXT
  node src/cli.ts graduate decide --suite-root PATH --app-root PATH --case ID
      --decision graduated|kept-out --as qa --reason TEXT [--work TICKET]
  node src/cli.ts stage-kit --suite-root PATH --suite ID

Preflight runs config-only probing/discovery, never login or tests. Run executes fast locally with
--retries=0. Verify checks persisted policy/QA history headlessly; success is not a readiness verdict.
Ready exit 0; not ready 2; inconclusive 3; not evaluable/usage 4. Authoring commands exit 0 or 4.
An explicit adapter receives identity|fixture|configuration|mutate|restore and one JSON argument.
Records are written only on a dedicated branch. Specs/configs are never edited. Check is advisory.
Source never writes to TestRail; credentials stay in lib:testrail.
`;
type Options = {command:string;values:Map<string,string>;noWork:boolean};
function options(args:string[]):Options {
  const command=args[0]??'';const values=new Map<string,string>();let noWork=false;
  const lists:Record<string,string[]>={run:['--app-root','--suite-root','--env','--tier','--work','--no-work','--adapter','--inputs','--timeout-ms'],preflight:['--app-root','--suite-root','--env','--tier','--work','--no-work','--adapter','--inputs','--timeout-ms'],verify:['--app-root','--suite-root','--env','--work','--no-work'],source:['--snapshot','--output'],'stage-kit':['--suite-root','--suite']};
  const allowed=new Set(lists[command]??[]);
  for(let i=1;i<args.length;i++) {
    const key=args[i]!;
    if(!allowed.has(key))throw new Error(`${key} is not valid for ${command}`);
    if(key==='--no-work'){if(noWork)throw new Error('duplicate --no-work');noWork=true;continue;}
    if(!allowed.has(key)||values.has(key))throw new Error(`unknown or duplicate argument ${key}`);
    const value=args[++i];if(value===undefined||value.startsWith('--'))throw new Error(`missing value for ${key}`);values.set(key,value);
  }
  return {command,values,noWork};
}
function required(o:Options,key:string):string {const value=o.values.get(key);if(!value)throw new Error(`${key} is required`);return value;}
export function parseArguments(args:string[]):CoordinatorRequest {
  const o=options(args);
  if(!['run','preflight','verify'].includes(o.command))throw new Error('expected run, preflight or verify');
  const appRoot=resolve(required(o,'--app-root'));const suiteRoot=resolve(required(o,'--suite-root'));const environment=required(o,'--env');
  if(o.values.has('--tier')&&o.values.get('--tier')!=='fast')throw new Error('only fast tier is implemented');
  if(o.noWork&&o.values.has('--work'))throw new Error('--work and --no-work were both supplied');
  for(const key of o.values.keys())if(['--suite','--snapshot','--output'].includes(key))throw new Error(`${key} is not valid for ${o.command}`);
  let environmentValues:Record<string,EnvironmentInputValue>|undefined;
  if(o.values.has('--inputs')) {
    const value=readJson(resolve(o.values.get('--inputs')!));
    if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('inputs must be a set/unset value object');
    environmentValues={};
    for(const [name,raw] of Object.entries(value)) {
      if(raw===null||typeof raw!=='object'||Array.isArray(raw))throw new Error(`invalid input ${name}`);
      const state:unknown=Reflect.get(raw,'state');const val:unknown=Reflect.get(raw,'value');
      if(state==='unset'&&Object.keys(raw).length===1)environmentValues[name]={state:'unset'};
      else if(state==='set'&&typeof val==='string'&&Object.keys(raw).length===2)environmentValues[name]={state:'set',value:val};
      else throw new Error(`invalid explicit set/unset input ${name}`);
    }
  }
  const timeout=o.values.has('--timeout-ms')?Number(o.values.get('--timeout-ms')):undefined;
  if(timeout!==undefined&&(!Number.isSafeInteger(timeout)||timeout<1))throw new Error('timeout must be a positive integer');
  return {operation:o.command as CoordinatorRequest['operation'],appRoot,suiteRoot,environment,
    ...(o.noWork?{noWork:true}:{}),...(o.values.has('--work')?{work:o.values.get('--work')!}:{}),
    ...(o.values.has('--adapter')?{adapter:commandAdapter(resolve(o.values.get('--adapter')!),appRoot)}:{}),
    ...(environmentValues===undefined?{}:{environmentValues}),...(timeout===undefined?{}:{timeoutMs:timeout})};
}
/** Canonicalize existing parents before checking the enclosing checkout; never create first. */
export async function sourceDestination(path:string):Promise<string> {
  const target=resolve(path);let ancestor=target;
  while(!existsSync(ancestor)&&dirname(ancestor)!==ancestor)ancestor=dirname(ancestor);
  const canonical=resolve(realpathSync(ancestor),relative(ancestor,target));
  const root=await repoTop(existsSync(canonical)?dirname(canonical):realpathSync(ancestor));
  if(root!==null){const branch=await currentBranch(root);if(branch===null||branch==='main'||branch==='master')throw new Error('source output requires a dedicated branch/worktree');}
  return canonical;
}
export async function main(args=process.argv.slice(2)):Promise<number> {
  if(args.length===0||args[0]==='--help'){process.stdout.write(USAGE);return args.length===0?4:0;}
  try {
    // Phase 1 commands load their modules on use, so the verdict path never depends on them.
    const authoring=await import('./commands.ts');
    if(authoring.COMMANDS.has(args[0]!)||(args[0]==='source'&&args[1]!==undefined&&!args[1].startsWith('--'))){const out=await authoring.runCommand(args);process.stdout.write(JSON.stringify(out.output)+'\n');return out.exitCode;}
    if(args[0]==='stage-kit') {
      const o=options(args);const root=resolve(required(o,'--suite-root'));const profile=parseProfile(readJson(inside(root,'.test-lab/profile.json')));
      const suite=profile.suites.find(s=>s.id===required(o,'--suite'));if(suite===undefined)throw new Error('unknown suite');
      const files=await stageKit(root,suite.config);process.stdout.write(JSON.stringify({staged:files})+'\n');return 0;
    }
    if(args[0]==='source') {
      const o=options(args);const output=await sourceDestination(required(o,'--output'));
      const snapshot=await readSnapshot(resolve(required(o,'--snapshot')));const drafts=importSnapshot(snapshot);
      mkdirSync(output,{recursive:false});
      writeFileSync(join(output,'snapshot.json'),JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});
      writeFileSync(join(output,'drafts.json'),JSON.stringify({schema:1,drafts},null,2)+'\n',{flag:'wx'});
      process.stdout.write(JSON.stringify({source:snapshot.source,complete:true,fetchedAt:snapshot.fetchedAt,drafts:drafts.length,output})+'\n');return 0;
    }
    const controller=new AbortController();const stop=()=>controller.abort();
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
    try {const result=await coordinate({...parseArguments(args),signal:controller.signal});process.stdout.write(JSON.stringify({summary:result.summary,verdict:result.verdict.verdict,rule:result.verdict.rule,runDir:result.runDir,exitCode:result.exitCode})+'\n');return result.exitCode;}
    finally {process.off('SIGINT',stop);process.off('SIGTERM',stop);}
  }catch(error){process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);return 4;}
}
if(import.meta.main)process.exitCode=await main();
