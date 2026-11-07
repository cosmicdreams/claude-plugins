// Generic temp application + independent QA checkout. Commits only in disposable test repositories.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Profile } from '../../src/model.ts';
import { caseRecord, ROLES } from '../ts/support.ts';
import { canonicalCaseHash } from '../../src/cases.ts';
import { sha256 } from '../../src/canonical.ts';
import { stageKit } from '../../src/staging.ts';
import type { Version } from '../playwright/harness.ts';
const run=promisify(execFile);
export function fixtureProfile(baseUrl='http://127.0.0.1:4180'):Profile {
  return {schema:1,project:'Generic fixture',regression:['REG-1'],baseBranch:'main',remote:'origin',maxBaseRefAgeHours:24,roles:ROLES,roleDefinitions:[],
    configurations:[{id:'desktop@1440',project:'desktop',viewport:{width:1440,height:900},role:'anonymous'}],
    suites:[{id:'e2e',config:'playwright.config.ts',declaredEnvironmentInputs:[{name:'BASE_URL',classification:'nonsecret',readers:['playwright.config.ts']}]}],
    classification:[{id:'onboarding',target:{suite:'e2e'},from:null,to:'governed',by:'Dana Dev',role:'developer',standIn:false,at:'2026-10-09',reason:'onboard generic fixture'}],
    environments:[{id:'local',kind:'local-candidate',baseUrl,baseUrlEnv:'BASE_URL'}],fixtures:[{id:'home',environments:['local'],path:'/',title:'Generic fixture',structure:'visible heading'}],
    declaredInputs:[],declaredBaselines:[],generatedAssets:[],knownConfigOverrides:[],quarantineCap:8,materialFields:['browserName','browserVersion','channel','headless','retries'],secretOptions:[],maxSnapshotAgeHours:24,allowedHosts:[]};
}
export function writeJson(file:string,value:unknown):void {mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(value,null,2)+'\n');}
export async function setupCoordinator(version:Version,options:{authenticated?:boolean;prepare?:(suite:string,profile:Profile,record:ReturnType<typeof caseRecord>)=>Promise<void>}={}) {
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'test-lab-compose-')));const app=join(dir,'app');const suite=join(dir,'qa-suite');mkdirSync(app);mkdirSync(suite);
  const state={mutant:false,actor:'anonymous',missing:false,structure:'visible heading',editDuringRun:false,slow:false,teardown:false,bodyRequests:0,loginRequests:0,actorBeforeLogin:false,httpRequests:0};
  writeFileSync(join(app,'template.txt'),'Generic fixture');
  const server=createServer((req,res)=>{
    state.httpRequests++;
    const path=(req.url??'/').split('?')[0];
    if(path==='/identity'){res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:1,appRoot:app}));return;}
    if(path==='/fixture'){res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:1,exists:!state.missing,published:true,structureObservation:state.structure}));return;}
    if(path==='/configuration'){res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:1,status:'[]',lastImportAt:null}));return;}
    if(path==='/login'){state.loginRequests++;res.setHeader('set-cookie','fixtureRole=editor; Path=/');res.end('fixture login');return;}
    if(path==='/actor'){if(options.authenticated&&state.loginRequests===0)state.actorBeforeLogin=true;res.setHeader('content-type','application/json');res.end(JSON.stringify({role:state.actor==='anonymous'&&req.headers.cookie?.includes('fixtureRole=editor')?'editor':state.actor}));return;}
    if(path==='/health'){res.end('healthy');return;}
    if(path==='/teardown'){res.end(state.teardown?'fail':'pass');return;}
    state.bodyRequests++;
    if(state.editDuringRun){state.editDuringRun=false;writeFileSync(join(app,'template.txt'),'Edited during run');}
    if(state.missing){res.writeHead(404);res.end('missing');return;}
    const body=`<html><title>Generic fixture</title><h1>${state.mutant?'Broken heading':readFileSync(join(app,'template.txt'),'utf8')}</h1></html>`;
    if(state.slow)setTimeout(()=>res.end(body),20000).unref();else res.end(body);
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const g=async(root:string,args:string[])=>run('git',args,{cwd:root,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
  try {
  for(const root of [app,suite]){await g(root,['init','-b','main']);await g(root,['config','user.name','Generic fixture']);await g(root,['config','user.email','fixture@example.invalid']);}
  writeFileSync(join(app,'.gitignore'),'node_modules/\n');await g(app,['add','.']);await g(app,['commit','-m','test: generic application fixture']);
  const install=resolve(import.meta.dirname,`../playwright/pw-${version}`);
  symlinkSync(join(install,'node_modules'),join(suite,'node_modules'),'dir');
  cpSync(join(install,'package.json'),join(suite,'package.json'));cpSync(join(install,'package-lock.json'),join(suite,'package-lock.json'));
  writeFileSync(join(suite,'.gitignore'),'node_modules/\n.test-lab/runs/\n.test-lab/operation.lock\ntest-results/\nplaywright-report/\n.auth/\n');
  const profile=fixtureProfile(url);
  if(options.authenticated){profile.configurations[0]!.role='editor';profile.roleDefinitions=[{name:'editor',setupProject:'setup',storageState:'.auth/editor.json'}];}
  writeJson(join(suite,'.test-lab/profile.json'),profile);
  writeJson(join(suite,'.test-lab/local.json'),{schema:1,applicationBase:{remote:'origin',branch:'main',maxAgeHours:24},healthPath:'health',actorProbe:{path:'actor',roleField:'role'},database:{source:'generic fixture',pulledAt:null}});
  const record=caseRecord('REG-1','regression',{obligations:['O1']});record.fixture='home';record.approval!.hash=canonicalCaseHash(record);
  writeJson(join(suite,'.test-lab/cases/regression/REG-1.json'),record);
  for(const folder of ['cases/addendum','cases/drafts','work','recipes','evidence'])mkdirSync(join(suite,'.test-lab',folder),{recursive:true});
  const test={suite:'e2e',file:'tests/home.spec.ts',titlePath:['heading']};const obligation={case:'REG-1',step:'S1',obligation:'O1'};
  writeJson(join(suite,'.test-lab/ledger.json'),{schema:1,mappings:[{obligation,test,configuration:'desktop@1440',layer:'served'}]});
  writeJson(join(suite,'.test-lab/dispositions.json'),{schema:1,records:[]});
  const recipe=JSON.stringify({format:1,test,obligation,hypothesis:'the served heading changes',technique:'seeded-site-mutant',mutation:'heading'});const recipeHash=`sha256:${sha256(recipe)}`;
  writeFileSync(join(suite,'.test-lab/recipes',`${sha256(recipe)}.json`),recipe);
  writeFileSync(join(suite,'playwright.config.ts'),`import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',workers:1,timeout:30000,globalTeardown:'./teardown.ts',use:{baseURL:process.env.BASE_URL},projects:[${options.authenticated?"{name:'setup',testDir:'./setup',testMatch:'**/*.setup.ts'},":''}{name:'desktop',${options.authenticated?"dependencies:['setup'],":''}use:{${options.authenticated?"storageState:'./.auth/editor.json',":''}browserName:'chromium',viewport:{width:1440,height:900}}}]});`);
  if(options.authenticated){mkdirSync(join(suite,'setup'));writeFileSync(join(suite,'setup/login.setup.ts'),`import {test} from '@playwright/test';test('fixture login',async({page})=>{await page.goto('/login');await page.context().storageState({path:'.auth/editor.json'});});`);}
  mkdirSync(join(suite,'tests'));
  writeFileSync(join(suite,'tests/home.spec.ts'),`import {test,expect} from '@playwright/test';import {bindCase,caseStep} from '../support/test-lab/case-step';import {registerActorProbe} from '../support/test-lab/actor-probe';registerActorProbe({path:'actor',roleField:'role'});test('heading',bindCase('REG-1'),async({page})=>{await page.goto('/');await caseStep(page,{case:'REG-1',step:'S1',obligation:'O1'},'heading',async()=>{await expect(page.getByRole('heading')).toHaveText('Generic fixture');});});`);
  writeFileSync(join(suite,'teardown.ts'),`import {request} from '@playwright/test';export default async function(config){const client=await request.newContext();try{const r=await client.get(new URL('teardown',config.projects[0].use.baseURL).href);if(await r.text()==='fail')throw new Error('fixture teardown failure');}finally{await client.dispose();}}`);
  writeFileSync(join(suite,'adapter.ts'),`const action=process.argv[2];const url=${JSON.stringify(url)};const r=await fetch(url+(action==='identity'?'/identity':action==='configuration'?'/configuration':'/fixture'));console.log(await r.text());`);
  // Controlled staging on a dedicated fixture branch, then ordinary fixture commits on that branch.
  await g(suite,['checkout','-b','fixture-candidate']);await stageKit(suite,'playwright.config.ts');
  await options.prepare?.(suite,profile,record);
  await g(suite,['add','.']);await g(suite,['commit','-m','test: generic QA suite fixture']);await g(suite,['branch','-f','main','HEAD']);
  for(const root of [app,suite]){
    const remote=join(dir,root===app?'app-remote.git':'qa-remote.git');await run('git',['clone','--bare',root,remote],{cwd:dir});await g(root,['remote','add','origin',remote]);await g(root,['fetch','origin','main']);
  }
  await g(app,['checkout','-b','fixture-candidate']);
  return {dir,app,suite,url,profile,record,test,obligation,recipeHash,state,g,
    async cleanup(){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}};
  }catch(error){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});throw error;}
}
