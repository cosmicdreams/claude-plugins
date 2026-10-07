/** Filesystem-only rebuild preparation and in-process receipt/verify/scoring evaluation. */
import {appendFileSync,cpSync,existsSync,mkdirSync,readFileSync,readdirSync,realpathSync,statSync} from 'node:fs';
import {basename,dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {pluginRoot} from './runtime.ts';
import {validate,writeJson} from './contracts.ts';
import type {ArtifactKind} from './contracts.ts';
import {componentCoverage,receipts,registerOutputs} from './figma-receipts.ts';
import {BuildDriver} from './figma-build.ts';
import {Build,PID_FILE} from './figma-runner.ts';

type Dict=Record<string,any>;
const read=(path:string):Dict=>JSON.parse(readFileSync(path,'utf8'));
const optional=(path:string):Dict=>{try{return read(path);}catch{return {};}};
const now=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'+00:00');
const hash=(path:string)=>'sha256:'+createHash('sha256').update(readFileSync(path)).digest('hex');
const version=()=>read(resolve(pluginRoot,'.claude-plugin/plugin.json')).version;
export function relocate(value:any,roots:string[],target:string):any {
 if(typeof value==='string') {
  if(isAbsolute(value))for(const root of roots){const base=resolve(root),path=resolve(value);if(path===base||path.startsWith(base+sep))return resolve(target,relative(base,path));}
  for(const root of roots){const base=root.replace(/\/+$/,'');if(value===root||value.startsWith(base+'/'))return target+value.slice(base.length);}
  return value;
 }
 if(Array.isArray(value))return value.map(v=>relocate(v,roots,target));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,relocate(v,roots,target)]));return value;
}
export function siteUrls(source:string):[string,string] {
 const state=optional(resolve(source,'figma/state.json')),capture=read(resolve(source,'capture-evidence.json'));
 const site=state.siteUrl||capture.canonicalBaseUrl,canonical=state.canonicalBaseUrl||capture.canonicalBaseUrl;
 if(!site||!canonical)throw new Error(`${source}: missing saved siteUrl or canonicalBaseUrl`);return [site,canonical];
}
export function planApproved(source:string,project:Dict):boolean {
 if(['approved','complete'].includes(project.phases?.plan?.status)||project.phases?.benchmark?.status==='complete')return true;
 const log=resolve(source,'phase-log.jsonl');if(!existsSync(log))return false;
 return readFileSync(log,'utf8').split(/\r?\n/).some(line=>{try{const e=JSON.parse(line);return e.phase==='plan'&&['approved','complete'].includes(e.status);}catch{return false;}});
}
export interface PrepareOptions {identity?:Dict|null;evaluationTier?:number;at?:()=>string}
export function prepare(source:string,workspace:string,key:string,figmaUrl:string,options:PrepareOptions={}):Dict {
 source=realpathSync(source);workspace=resolve(workspace);const manifest=optional(resolve(source,'corpus.json')),original=read(resolve(source,'project.json')),identity=options.identity??null;
 if(key===original.target?.figmaFileKey)throw new Error("scratch file key must differ from the frozen run's original Figma file");
 if(identity!==null){const missing=['components.json','plan.json','tokens.json','capture-evidence.json'].filter(n=>!existsSync(resolve(source,n)));if(!existsSync(resolve(source,'capture/measurements')))missing.push('capture/measurements/');if(missing.length)throw new Error(`${source}: figma-build needs ${missing.join(', ')}`);if(!planApproved(source,original))throw new Error(`${source}: approve the plan before figma-build; the plan phase is not approved or complete`);}
 const [siteUrl,canonicalBaseUrl]=siteUrls(source),replay=identity===null&&dirname(workspace)===resolve(source,'replays');
 if(workspace===source||workspace.startsWith(source+sep)&&!replay)throw new Error('copy destination must be outside the source run');
 if(existsSync(workspace)&&(!statSync(workspace).isDirectory()||readdirSync(workspace).length))throw new Error(`${workspace}: rebuild workspace must be new or empty`);
 const topSkip=new Set(['project.json','benchmark','builds','phase-log.jsonl','verify-report.json','preflight-checks.json']);
 cpSync(source,workspace,{recursive:true,preserveTimestamps:true,filter:from=>{const rel=relative(source,from),parts=rel.split(sep);if(parts.some(p=>p==='replays'||p==='corpus.json'))return false;if(parts.length===1&&topSkip.has(rel))return false;if(parts[0]==='figma'&&parts.length>1&&parts[1]!=='images')return false;return true;}});
 const roots=[source,...manifest.sourceRun?[manifest.sourceRun]:[]];
 const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(resolve(dir,e.name)):e.name.endsWith('.json')?[resolve(dir,e.name)]:[]);
 for(const path of files(workspace))writeJson(path,relocate(read(path),roots,workspace));
 const project=relocate(original,roots,workspace),at=options.at??now,pluginVersion=version();let commit:string|null=null;try{commit=execFileSync('git',['-C',pluginRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim()||null;}catch{}
 project.pluginVersion=pluginVersion;project.createdAt=at();project.target={figmaFileKey:key,figmaUrl};
 const rebuiltFrom={run:source,createdAt:original.createdAt??null,pluginVersion:original.pluginVersion??null,corpusLabel:manifest.label??null};
 const label=identity===null?manifest.label:identity.siteLabel||original.run?.siteLabel||manifest.label;
 project.run={...(identity??{startedAt:at(),plugin:{version:pluginVersion,commit}}),siteLabel:label??null,evaluationTier:options.evaluationTier??2,rebuiltFrom};
 const phases=project.phases??{};project.phases={};
 if(identity!==null){for(const name of ['discovery','inventory','usage','capture','tokens','plan','preflight'])if(phases[name]){const phase={...phases[name],from:source};if('updatedAt'in phase){phase.sourceUpdatedAt=phase.updatedAt;delete phase.updatedAt;}project.phases[name]=phase;}project.phases.plan={...project.phases.plan,status:'approved',from:source};for(const name of ['foundation','components','index','verify'])project.phases[name]={status:'pending'};}
 project.artifacts=Object.fromEntries(Object.entries(project.artifacts??{}).filter(([,a]:any)=>!['build-record','foundation','index','verify-report'].includes(a.kind)));
 for(const artifact of Object.values(project.artifacts) as Dict[]){const file=resolve(workspace,artifact.path??'');if(existsSync(file)&&statSync(file).isFile()){const errors=validate(artifact.kind as ArtifactKind,read(file));Object.assign(artifact,{sha256:hash(file),valid:!errors.length,errors});}}
 writeJson(resolve(workspace,'figma/state.json'),{fileKey:key});writeJson(resolve(workspace,'project.json'),project);
 return {workspace,fileKey:key,figmaUrl,siteUrl,canonicalBaseUrl,rebuiltFrom};
}
export interface WaitOptions {status?:(workspace:string)=>any;dumpStep?:(workspace:string)=>any;now?:()=>number;sleep?:(ms:number)=>Promise<void>;pollMs?:number}
export async function waitForBuild(workspace:string,timeout:number,poll=2,options:WaitOptions={}):Promise<void> {
 const clock=options.now??(()=>performance.now()),sleep=options.sleep??(ms=>new Promise<void>(done=>setTimeout(done,ms))),deadline=clock()+timeout*1000,build=new Build(workspace),driver=new BuildDriver(workspace),log=resolve(workspace,'figma/runner.log');
 let position=existsSync(log)?statSync(log).size:0;
 while(clock()<deadline) {
  const status=await(options.status?.(workspace)??driver.status());if(status.next===null&&await(options.dumpStep?.(workspace)??build.dumpStep())===null)return;
  let failure:string|null=null;
  if(existsSync(log)){const size=statSync(log).size;if(size<position)position=0;const bytes=readFileSync(log),tail=bytes.subarray(position).toString();position=bytes.length;for(const line of tail.split('\n')){const event=line.slice(line.indexOf(' ')+1).trim();if(event.startsWith('FAILED ')||event.startsWith('error:'))failure=line.trim();else if(event.startsWith('recorded ')||event.startsWith('skipped '))failure=null;}}
  const heartbeat=optional(resolve(workspace,'figma/progress.json')),pidPath=resolve(workspace,'figma',PID_FILE),pid=existsSync(pidPath)?readFileSync(pidPath,'utf8').trim():null;
  if((pid===null||String(heartbeat.serverPid)===pid)&&(heartbeat.state==='failed'||heartbeat.state==='waiting'&&String(heartbeat.message??'').startsWith('Stopped at ')))failure=heartbeat.message||'the runner reported a failed step';
  if(failure)throw new Error(`runner stopped: ${failure}; workspace: ${workspace}`);
  await sleep(Math.min(options.pollMs??poll*1000,Math.max(0,deadline-clock())));
 }
 throw new Error(`replay timed out after ${timeout}s; see ${log}`);
}
function setPhase(workspace:string,project:Dict,phase:string,status:string,detail?:Dict) {
 const at=now();project.phases??={};project.phases[phase]={status,updatedAt:at,...detail&&Object.keys(detail).length?{detail}:{}};writeJson(resolve(workspace,'project.json'),project);appendFileSync(resolve(workspace,'phase-log.jsonl'),JSON.stringify({at,phase,status})+'\n');
}
export function validateProject(workspace:string):{valid:boolean;results:Record<string,string[]>} {
 const project=read(resolve(workspace,'project.json')),results:Record<string,string[]>={project:validate('project',project)};
 for(const [name,a] of Object.entries(project.artifacts??{}) as [string,Dict][]){try{const file=resolve(workspace,a.path),errors=validate(a.kind as ArtifactKind,read(file));if(a.sha256!==hash(file))errors.push('content hash differs from project manifest');results[name]=errors;}catch(error){results[name]=[String(error)];}}
 if(project.phases?.components?.status==='complete'){const c=componentCoverage(workspace,project as any),errors=[];if(!c.planAvailable)errors.push('component phase is complete but no valid plan is registered');if(c.missing.length)errors.push('missing build records: '+c.missing.slice(0,12).join(', '));if(c.unexpected.length)errors.push('stale build records: '+c.unexpected.slice(0,12).join(', '));if(c.invalid.length)errors.push('invalid build records: '+c.invalid.slice(0,12).join(', '));results.componentCoverage=errors;}
 if(project.phases?.verify?.status==='complete'){const errors=[],incomplete=['discovery','inventory','usage','capture','tokens','plan','foundation','components','index'].filter(p=>!(p==='usage'?['complete','approved','waived']:['complete','approved']).includes(project.phases[p]?.status));if(incomplete.length)errors.push('required phases are not resolved: '+incomplete.join(', '));if(!project.target?.figmaFileKey)errors.push('verified project has no Figma target');const receipt=(Object.values(project.artifacts??{}) as Dict[]).find(a=>a.kind==='verify-report'&&a.valid);if(!receipt)errors.push('verified project has no valid verification receipt');else{const report=read(resolve(workspace,receipt.path)),blocking=(report.open??[]).filter((f:Dict)=>['blocker','major'].includes(f.severity));if(blocking.length)errors.push(`verification has ${blocking.length} open blocker/major finding(s)`);}results.completionGate=errors;}
 return {valid:!Object.values(results).some(v=>v.length),results};
}
export async function evaluate(workspace:string,session?:string|string[]):Promise<Dict> {
 workspace=resolve(workspace);
 const {merge}=await import('./verify-state.ts'),{buildMeasurements}=await import('./verify-inputs.ts'),{verify}=await import('./verify.ts'),{scoreAccuracy}=await import('./run-metrics.ts'),{writeScore}=await import('./score-run.ts');
 const receipt=receipts(workspace),receiptsExit=Object.keys(receipt.invalid).length?1:0;
 let project=read(resolve(workspace,'project.json'));const coverage=componentCoverage(workspace,project as any);if(coverage.planAvailable&&!coverage.missing.length&&!coverage.unexpected.length&&!coverage.invalid.length&&project.phases?.components?.status!=='complete')setPhase(workspace,project,'components','complete',coverage);
 const state=merge(resolve(workspace,'figma/verify'));writeJson(resolve(workspace,'figma/verify/state.json'),state);const measurements=buildMeasurements(workspace);writeJson(resolve(workspace,'figma/verify/measurements.json'),measurements);
 const options:any={state,measurements,out:resolve(workspace,'verify-report.json')};
 for(const [key,name] of [['components','components.json'],['tokens','tokens.json'],['plan','plan.json'],['index','index.json'],['waivers','waivers.json'],['renderEvidence','render-evidence.json'],['captureEvidence','capture-evidence.json']]){const path=resolve(workspace,name!);if(existsSync(path))options[key!]=read(path);}
 for(const [key,name] of [['shotsDir','capture/shots'],['builds','builds']])if(existsSync(resolve(workspace,name!)))options[key!]=resolve(workspace,name!);
 project=read(resolve(workspace,'project.json'));const theme=project.repository?.root;if(theme&&existsSync(theme)&&statSync(theme).isDirectory())options.themeRoot=theme;if(state.brand)options.brand=state.brand;
 writeJson(resolve(workspace,'figma/compare/corrected.json'),await scoreAccuracy(workspace));
 const report=await verify(options);writeJson(options.out,report);const verifyExit=report.open.length?1:0;
 registerOutputs(workspace,[{name:'verifyReport',path:options.out,kind:'verify-report',phase:'verify'}]);project=read(resolve(workspace,'project.json'));project.phases.verify={status:'complete',updatedAt:now()};writeJson(resolve(workspace,'project.json'),project);
 const gate=validateProject(workspace),gateExit=gate.valid?0:1,accepted=verifyExit===0&&receiptsExit===0&&gateExit===0;
 setPhase(workspace,project,'verify',accepted?'complete':'failed',{execution:'finished',quality:accepted?'passed':'failed',verifyExit,receiptsExit,gateExit,gate:JSON.stringify(gate,null,2)});
 if(session!==undefined||project.run?.claude!=null)setPhase(workspace,project,'benchmark','running');
 await writeScore(workspace,{session,out:resolve(workspace,'benchmark')});
 return {workspace,scorecard:resolve(workspace,'benchmark/scorecard.json'),verifyReport:options.out,verifyExit,quality:accepted?'passed':'failed',gateExit};
}
