import { oracleScript, oracleScripts, oracleExecutable, oracleRoot } from './oracle.ts';
/** Six copied runs, fresh Python/TS verification and scoring, independently rendered reports. */
import {existsSync,readFileSync,writeFileSync,mkdirSync,cpSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {pluginRoot} from '../../src/runtime.ts';
import {validate,writeJson} from '../../src/contracts.ts';
import {verify} from '../../src/verify.ts';
import {merge} from '../../src/verify-state.ts';
import {buildMeasurements} from '../../src/verify-inputs.ts';
import {score,completionMessage} from '../../src/score-run.ts';
import {render} from '../../src/score-report.ts';
import {compareReports,compareCompletion} from './report.ts';
export const ignoredFields=['/generatedAt','/sections/cost/clock/scorerSeconds'];
export const cutoverText=(s:string):string=>s.replaceAll('workflow.py', 'workflow.ts').replaceAll('score_run.py', 'score_run.ts').replaceAll('figma_build.py', 'figma_build.ts');
const currentGenerator='design-lab '+JSON.parse(readFileSync(resolve(pluginRoot,'.claude-plugin/plugin.json'),'utf8')).version,baselineGenerator='design-lab '+JSON.parse(readFileSync(resolve(oracleRoot,'design-lab/.claude-plugin/plugin.json'),'utf8')).version;
export function normalize(value:any,path=''):any {if(typeof value==='string')return path==='/generator'?value.replace(baselineGenerator,currentGenerator):cutoverText(value);if(Array.isArray(value))return value.map((v,i)=>normalize(v,path+'/'+i));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!ignoredFields.includes(path+'/'+k)).map(([k,v])=>[k,normalize(v,path+'/'+k)]));return value;}
export function differences(a:any,b:any,path='',out:string[]=[]):string[] {if(out.length>=60||Object.is(a,b))return out;if(!a||!b||typeof a!=='object'||typeof b!=='object'){out.push(path+': '+JSON.stringify(a)+' != '+JSON.stringify(b));return out;}for(const key of new Set([...Object.keys(a),...Object.keys(b)]))differences(a[key],b[key],path+'/'+key,out);return out;}
const read=(path:string):any=>JSON.parse(readFileSync(path,'utf8'));
export async function evaluationParity(root:string) {
 if(!root.startsWith('/tmp/'))throw new Error('equivalence root must be under /tmp');mkdirSync(root,{recursive:true});
 const home=homedir(),sources=[['definitive-03',resolve(home,'Sites/DEFINITIVEHC/design/2026-10-03')],['definitive-05',resolve(home,'Sites/DEFINITIVEHC/design/2026-10-05')],['pncb',resolve(home,'.design/pncb/2026-10-06')],...['massport','kingtec','americas-credit-unions'].map(n=>[n,resolve(home,'Tools/design-lab-corpus',n)])];
 const results:any[]=[];
 const python=(request:any)=>{const path=resolve(root,request.site+'-request.json');writeJson(path,request);const p=spawnSync(oracleExecutable,[oracleScript('evaluation-oracle.py'),path],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});if(p.status!==0)throw new Error('Python oracle: '+p.stderr);};
 for(const [site,source]of sources) {
  const run=resolve(root,site!,'run'),py=resolve(root,site!,'python'),ts=resolve(root,site!,'typescript');if(!existsSync(run))cpSync(source!,run,{recursive:true,preserveTimestamps:true,filter:p=>!p.split('/').includes('replays')});mkdirSync(py,{recursive:true});mkdirSync(ts,{recursive:true});
  const row:any={site,source,run,artifacts:{},timings:{python:{},typescript:{}}};results.push(row);
  const stateDir=resolve(run,'figma/verify'),stateFile=resolve(stateDir,'state.json'),rootFile=resolve(stateDir,'root.json');
  if(existsSync(rootFile)||existsSync(stateFile)) {
   try {
    python({action:'verify',site,run,out:py});Object.assign(row.timings.python,read(resolve(py,'timings.json')));
    const state=existsSync(rootFile)?merge(stateDir):read(stateFile),measurements=buildMeasurements(run),project=read(resolve(run,'project.json')),opts:any={state,measurements,out:resolve(run,'verify-report.json')};
    for(const [key,name]of [['components','components.json'],['tokens','tokens.json'],['plan','plan.json'],['index','index.json'],['waivers','waivers.json'],['renderEvidence','render-evidence.json'],['captureEvidence','capture-evidence.json']])if(existsSync(resolve(run,name!)))opts[key!]=read(resolve(run,name!));
    for(const [key,name]of [['shotsDir','capture/shots'],['builds','builds']])if(existsSync(resolve(run,name!)))opts[key!]=resolve(run,name!);
    if(project.repository?.root&&existsSync(project.repository.root))opts.themeRoot=project.repository.root;if(state.brand)opts.brand=state.brand;
    const start=performance.now(),report=verify(opts);row.timings.typescript.verify=(performance.now()-start)/1000;writeJson(resolve(ts,'verify-report.json'),report);
    const delta=differences(normalize(read(resolve(py,'verify-report.json'))),normalize(report));row.artifacts.verify={status:delta.length?'mismatch':'match',differences:delta};
    row.artifacts.verifyState={status: differences(read(resolve(py,'state.json')),state).length?'mismatch':'match'};row.artifacts.verifyInputs={status:differences(read(resolve(py,'measurements.json')),measurements).length?'mismatch':'match'};
   }catch(error){row.artifacts.verify={status:'mismatch',error:String(error)};}
  }else row.artifacts.verify={status:'skipped',reason:'no saved root/page or merged whole-file verification state; no Figma actions authorized'};
  try {
   const reportPath=resolve(run,'benchmark/report.html'),generatedAt='2026-10-07T00:00:00+00:00';python({action:'score',site,run,out:py,reportPath,generatedAt});Object.assign(row.timings.python,read(resolve(py,'timings.json')));
   // Only the required command-prefix and generator-version cutover text differs.
   for(const name of ['report.html','completion.md']){const file=resolve(py,name);writeFileSync(file,cutoverText(readFileSync(file,'utf8')).replaceAll(baselineGenerator,currentGenerator));}
   const start=performance.now(),card=await score(run);row.timings.typescript.score=(performance.now()-start)/1000;writeJson(resolve(ts,'scorecard.json'),card);
   const delta=differences(normalize(read(resolve(py,'scorecard.json'))),normalize(card));row.artifacts.scorecard={status:delta.length?'mismatch':'match',differences:delta,ajv:validate('scorecard',card)};
   card.generatedAt=generatedAt;card.sections.cost.clock!.scorerSeconds=0;
   const began=performance.now();writeFileSync(resolve(ts,'report.html'),cutoverText(await render(card,run)));row.timings.typescript.report=(performance.now()-began)/1000;
   const completion=completionMessage(card,reportPath);writeFileSync(resolve(ts,'completion.md'),completion);row.artifacts.completion={status:completion===readFileSync(resolve(py,'completion.md'),'utf8')?'match':'mismatch'};
   const completionView=await compareCompletion(resolve(py,'completion.md'),resolve(ts,'completion.md'),resolve(root,site!,'completion-comparison'));row.artifacts.completion={status:completionView.textMatch&&completionView.domMatch&&completionView.screenshot.match?'match':'mismatch',...completionView};
   const report=await compareReports(resolve(py,'report.html'),resolve(ts,'report.html'),resolve(root,site!,'report-comparison'));row.artifacts.report={status:report.domMatch&&report.images.every(i=>i.match)&&report.screenshot.match?'match':'mismatch',...report};
  }catch(error){row.artifacts.scorecard??={status:'mismatch',error:String(error)};row.error=String(error);}
  writeJson(resolve(root,'summary.json'),{ignoredFields,results});console.log(site,JSON.stringify({artifacts:Object.fromEntries(Object.entries(row.artifacts).map(([k,v]:any)=>[k,v.status])),error:row.error}));
 }
 return {ignoredFields,results};
}
if(process.argv[1]===new URL(import.meta.url).pathname) {const result=await evaluationParity(process.argv[2]??'/tmp/design-lab-p4-equivalence');console.log('summary '+resolve(process.argv[2]??'/tmp/design-lab-p4-equivalence','summary.json'));process.exitCode=result.results.some(r=>Object.values(r.artifacts).some((a:any)=>a.status==='mismatch'))?1:0;}
