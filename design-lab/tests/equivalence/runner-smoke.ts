import { oracleScript, oracleScripts, oracleExecutable } from './oracle.ts';
/** Real local HTTP, recorded Figma results, isolated scratch runs. Never executes Figma code. */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { BuildDriver } from '../../src/figma-build.ts';
import { Build, makeServer, installRunner, pluginVersion } from '../../src/figma-runner.ts';
import { generate } from '../../src/figma-receipts.ts';
import { load, writeOnChange } from '../../src/build-artifacts.ts';
import type { BuildState, BuildResult } from '../../src/build-artifacts.ts';
import type { RunnerStep } from '../../src/generated/runner-step.ts';
import { pluginRoot } from '../../src/runtime.ts';
import { Renderer } from '../../src/render-payload.ts';
import {assertPixels,oracleImages,EDGE,JPEG} from './image-pixels.ts';
import { legacyRuntime } from './template-parity.ts';

const replay = resolve(process.argv[2] ?? ''), oracle = resolve(replay, 'definitive/python');
assert.ok(replay.startsWith('/tmp/') && existsSync(resolve(oracle, 'oracle.json')), 'supply successful driver replay root');
const source = resolve(homedir(), 'Sites/DEFINITIVEHC/design/2026-10-05');
const scratch = process.argv[3] ?? mkdtempSync('/tmp/design-lab-round3-http-');
assert.ok(scratch.startsWith('/tmp/'));mkdirSync(scratch,{recursive:true});
const expected = load<{transcript:{step:RunnerStep; input:BuildResult}[]}>(oracle, 'oracle.json');
const fitted = new Map<string,string>();
for(const row of expected.transcript) if(row.step.kind==='upload') for(const file of row.step.files??[]) {
  if(!fitted.has(file.file)) fitted.set(file.file,resolve(scratch,'oracle-served',String(fitted.size)+'.bin'));
}
oracleImages([...fitted].map(([source,target])=>({source,target,action:'fit'})),scratch);
const rows = new Map(expected.transcript.map(row => [row.step.step!, row]));
function relocate(folder: string, old: string, target: string): void {
  for (const entry of readdirSync(folder, {withFileTypes:true})) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) relocate(path, old, target);
    else if (entry.isFile() && entry.name.endsWith('.json')) {
      const text = readFileSync(path, 'utf8'); if (text.includes(old)) writeFileSync(path, text.replaceAll(old, target));
    }
  }
}
function normalize(value: unknown, project: string): unknown {
  if (typeof value === 'string') return value.replaceAll('/private' + project, '<RUN>').replaceAll(project, '<RUN>');
  if (Array.isArray(value)) return value.map(v => normalize(v, project));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,normalize(v,project)]));
  return value;
}
const current = new Renderer().runtimeHash(), legacy = new Renderer(resolve(oracleScripts, 'render'), 'javascript').runtimeHash();
function comparison(project: string, other: string, runtime = current, oracleRuntime = legacy): void {
  const comparable = (value:unknown) => legacyRuntime(value,runtime,oracleRuntime);
  assert.deepEqual(normalize(comparable(load(project,'figma/state.json')),project), normalize(load(other,'figma/state.json'),other), 'final state');
  for (const folder of ['figma/results','figma/dump','figma/verify','builds']) {
    const names = readdirSync(resolve(other,folder)).filter(n=>n.endsWith('.json')).sort();
    assert.deepEqual(readdirSync(resolve(project,folder)).filter(n=>n.endsWith('.json')).sort(),names,folder+' files');
    for (const name of names) assert.deepEqual(normalize(comparable(load(project,folder+'/'+name)),project),normalize(load(other,folder+'/'+name),other),folder+'/'+name);
  }
  const receiptPaths = load<string[]>(other,'smoke-receipts.json');
  for (const name of receiptPaths) assert.deepEqual(normalize(comparable(load(project,name)),project), normalize(load(other,name),other), 'receipt '+name);
}
async function drive(port: number, version: string, project: string): Promise<Record<string,unknown>> {
  const key = load<BuildState>(project,'figma/state.json').fileKey;
  let work:Record<string,string>={};
  const endpoint = (path:string, extra:Record<string,string>={}) => `http://127.0.0.1:${port}${path}?`+new URLSearchParams({token:'smoke-token',fileKey:key,version,client:'smoke-client',...work,...extra});
  const request = async (path:string, extra:Record<string,string>={}, body?:unknown) => {
    const reply = await fetch(endpoint(path,extra),{headers:{Origin:'null'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
    if (reply.status!==200) assert.fail(path+' '+reply.status+' '+await reply.text()); return reply;
  };
  const started=performance.now(); let served=0, uploads=0, files=0, dumps=0, screenshots=0, maxCharacters=0,exactBytes=0,maxPixelMean=0,maxPixelDelta=0;
  const order:string[]=[];
  for (let i=0;i<500;i++) {
    work={};
    const step=await (await request('/next')).json() as RunnerStep;
    if(step.generation && step.stepToken) work={generation:String(step.generation),stepToken:String(step.stepToken)};
    if (step.kind==='done') return {ms:performance.now()-started,served,uploads,files,dumps,screenshots,maxCharacters,exactBytes,maxPixelMean,maxPixelDelta,order};
    assert.notEqual(step.kind,'wait','build must progress'); assert.ok(step.step); order.push(step.step); served++;
    let data:unknown;
    if (step.kind==='dump') {
      const path = step.step.startsWith('dump:') ? 'figma/dump/'+step.step.slice(5).replaceAll('/','-')+'.json'
        : step.step==='verify:root' ? 'figma/verify/root.json'
        : step.step==='verify:getting-started' ? 'figma/verify/getting-started.json'
        : 'figma/verify/page-'+step.step.slice('verify:page:'.length).replaceAll('/','-')+'.json';
      data=load(source,path); dumps++;
    } else {
      const row=rows.get(step.step); assert.ok(row,'recorded result for '+step.step);
      data=JSON.parse(JSON.stringify(row.input).replaceAll(oracle,project));
      if (step.kind==='upload') {
        uploads++;
        for (const [i] of (step.nodeIds??[]).entries()) {
          const response=await request('/file',{step:step.step,i:String(i)});
          const actual=Buffer.from(await response.arrayBuffer()),sourceFile=row.step.kind==='upload'?row.step.files![i]!.file:'';
          const expectedBytes=readFileSync(fitted.get(sourceFile)!);
          if(actual.equals(expectedBytes)) exactBytes++;
          else { const stats=await assertPixels(actual,expectedBytes,step.step+': served '+i,/\.jpe?g$/i.test(sourceFile)?JPEG:EDGE);maxPixelMean=Math.max(maxPixelMean,stats.mean);maxPixelDelta=Math.max(maxPixelDelta,stats.max); }
          files++;
        }
      }
      if (step.kind==='screenshot') { data={png:readFileSync(row.input.file!).toString('base64')}; screenshots++; }
      if (step.kind==='use_figma') maxCharacters=Math.max(maxCharacters,[...(step.code??'')].length);
    }
    const recorded=await (await request('/record',{step:step.step},data)).json() as {recorded:string};
    assert.equal(recorded.recorded,step.step);
  }
  throw new Error('HTTP smoke exceeded 500 requests');
}
function prepare(lane:string):string {
  const project=resolve(scratch,lane); cpSync(oracle,project,{recursive:true}); relocate(project,oracle,project);
  // Keep a record of the original replay options while the new init clears outputs.
  return project;
}
async function pythonLane(lane:string,scripts:string):Promise<{project:string;summary:Record<string,unknown>}> {
  const project=prepare(lane),home=resolve(scratch,lane+'-home');mkdirSync(home,{recursive:true});
  const child=spawn(oracleExecutable,[oracleScript('runner-control.py'),scripts,project],{env:{...process.env,DESIGN_LAB_HOME:home,PYTHONDONTWRITEBYTECODE:'1',SMOKE_GENERATED_AT:'2026-10-07T00:00:00Z'},stdio:['pipe','pipe','pipe']});
  let errors='';child.stderr.on('data',chunk=>{errors+=String(chunk)});
  const lines=createInterface({input:child.stdout}); const iterator=lines[Symbol.asyncIterator]();
  const nextJson=async (field:string):Promise<Record<string,unknown>> => {
    for (;;) { const line=await iterator.next();assert.equal(line.done,false,errors);try { const json=JSON.parse(line.value);if(field in json)return json;}catch {/* runner status lines */} }
  };
  try {
    const ready=await nextJson('port'); const summary=await drive(Number(ready['port']),String(ready['version']),project);
    const exited=once(child,'exit'); child.stdin.write('finish\n'); const finish=await nextJson('finished');
    const [status]=await exited; assert.equal(status,0,errors); summary['receipts']=finish['receipts'];
    return {project,summary};
  } finally { if(child.exitCode===null) child.kill();writeFileSync(resolve(scratch,lane+'.stderr.log'),errors); }
}
const project=prepare('ts'),home=resolve(scratch,'ts-home');
const ctx={home,port:0};const install=installRunner(ctx);
const old=load<BuildState>(project,'figma/state.json');
new BuildDriver(project,{runner:true}).init({fileKey:old.fileKey,siteUrl:old.siteUrl,canonicalBaseUrl:old.canonicalBaseUrl,offlineImages:true,iterate:false,...load<{rebuild:boolean}>(project,'replay-options.json')});
const build=new Build(project,{echo:false});
// Negative acceptance probe: the old nonempty-byte check incorrectly accepted this.
if(process.env['DESIGN_LAB_SMOKE_CORRUPT_FILE']==='1') {
  const original=build.file.bind(build);let corrupt=true;
  build.file=async(step,i)=>{const file=await original(step,i);if(corrupt){corrupt=false;return {...file,data:Buffer.from('nonempty corrupted served bytes')};}return file;};
}
const server=makeServer(new Map([[old.fileKey,build]]),'smoke-token',{ctx});
let tsSummary:Record<string,unknown>;
try { tsSummary=await drive(await server.listen(0),pluginVersion(),project); } finally { await server.close(); }
const python=await pythonLane('python',oracleScripts);
const time=new Date(load<{generatedAt:string}>(python.project,'index.json').generatedAt);
const receipts=generate(project,time);writeOnChange(resolve(project,'smoke-receipts.json'),receipts.map(r=>relative(project,r.path)));
tsSummary['receipts']=receipts.length;comparison(project,python.project);
assert.deepEqual(tsSummary['order'],python.summary['order']);
// Additional controls are opt-in scratch copies; never import another live worktree.
const armScripts=process.env['DESIGN_LAB_SMOKE_ARM_B_SCRIPTS'];
const arms:Record<string,unknown>={ts:tsSummary,python:python.summary};
if (armScripts) {
  assert.ok(armScripts.startsWith('/tmp/') && existsSync(armScripts),'optional arm B scripts must be copied to /tmp');
  const arm=await pythonLane('arm-b',armScripts);
  const armState=load<BuildState>(arm.project,'figma/state.json');
  // Arm B has a cache-specific renderer hash. All other values must match.
  comparison(arm.project,python.project,armState.runtime,legacy);
  assert.deepEqual(arm.summary['order'],python.summary['order']);arms['armB']=arm.summary;
}
for(const summary of Object.values(arms) as Record<string,unknown>[]) delete summary['order'];
const summary={scratch,install,matched:true,arms};writeOnChange(resolve(scratch,'summary.json'),summary);console.log(JSON.stringify(summary,null,2));
