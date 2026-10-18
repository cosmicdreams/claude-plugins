import { canonical, inputHash, parseIdentity, type RequestIdentity } from '../hooks/mod/request-identity.ts';
// Executable composition, shared by CLI and future mod tools. The existing core owns every
// readiness rule; this module obtains observations, preserves missing dependencies, and calls it.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { canonicalJson, hashOf } from './canonical.ts';
import { requiredSetProblems, approvalProblem } from './cases.ts';
import { behaviorKey, computeDigests, effectiveConfig, type DigestReport } from './digest.ts';
import { effectiveClassification, laneClassOf, ownerRoleHolds, quarantines, riskAcceptances } from './dispositions.ts';
import { evaluateCase, type CaseEvidence } from './evidence.ts';
import { judgeFixture, type FixtureCheck } from './fixtures.ts';
import { git, repoTop } from './git.ts';
import { literalHosts, unsafeHosts } from './host-safety.ts';
import { contentManifest, compareManifests, evaluateIdentity, parseConfigStatus, type ContentManifest, type IdentityResult } from './identity.ts';
import { adapterOperation, type LocalAdapter } from './local-adapter.ts';
import { operationInputs } from './operation-inputs.ts';
import { trustedSourceAssociations, requiredSourceAssociations } from './source-policy.ts';
import { testKey, type EnvironmentDef, type Profile } from './model.ts';
import { normalize } from './normalize.ts';
import { machineId, renderMarkdown, writeVerdict, type VerdictFile } from './page.ts';
import { inside, loadPersisted, parseCase, parseProfile, parseSourceIndex, parseTransition, readJson, sourceBindingHash, type Persisted } from './persistence.ts';
import { approvedSetOf, branchTransitions, readBase, readBaseRef, readTransitionBases } from './regression-git.ts';
import { baseFreshness, checkRegression, type RegressionCheck } from './regression.ts';
import { execute, excludedListed, planSuite, probeInvocation, pulledIn, suiteExcluded, type Invocation, type SuitePlanInput } from './run-plan.ts';
import { browsersOf, readInvocation, runStatus, type InvocationObservation, type RunObservation, type RunStatus } from './run-observation.ts';
import { importSnapshot, readSnapshot, snapshotProblem } from './source.ts';
import { stagedKitProblems } from './staging.ts';
import { decide, type Verdict } from './verdict.ts';
import { boundTicket, currentBranch, describeProblem, journalPath, readJournal, readWorkFile, repoKeyOf, resolveWork, verifyWork, type WorkCheck, type WorkResolution } from './work.ts';
import { outageBreaker, probeHealth } from './breaker.ts';
import { presentArtifacts, type ArtifactPresentation, type Surface } from './artifacts.ts';
import type { EnvironmentInputValue } from '../kit/environment-inputs.ts';
import { optionClosureProblems } from '../kit/option-safety.ts';
import type { BeginRecord } from '../kit/records.ts';

/** Where an operation has got to, for a caller showing progress (the mod's runner). Never a result. */
export type CoordinatorProgress = {kind:'run-dir';runDir:string}|{kind:'invocation';suite:string;purpose:string;id:string};
export type CoordinatorRequest = {operation:'preflight'|'run'|'verify';appRoot:string;suiteRoot:string;environment:string;work?:string;noWork?:boolean;adapter?:LocalAdapter;environmentValues?:Record<string,EnvironmentInputValue>;timeoutMs?:number;signal?:AbortSignal;onProgress?:(event:CoordinatorProgress)=>void;requestIdentity?:RequestIdentity};
export const EXIT_CODES = {ready:0,'not-ready':2,inconclusive:3,'not-evaluable':4} as const;
export type CoordinatorResult = {runDir:string;verdict:Verdict;exitCode:number;summary:string;file:VerdictFile};
/** Future mod adapter: retain the reviewed same-machine / summary-only artifact policy. */
export function coordinatorArtifacts(result:CoordinatorResult,surface:Surface,engineMachine:string|null):ArtifactPresentation {
  return presentArtifacts({runDir:result.runDir,runMachine:result.file.machine,engineMachine,reportExists:existsSync(join(result.runDir,'html/index.html')),openReport:result.file.openReport,surface});
}
type SuiteObservation = {suite:string;config:string;before:ContentManifest;discovery:InvocationObservation;beforeDigests:DigestReport;run:InvocationObservation|null;afterDigests:DigestReport|null};
const decoders={profile:parseProfile,case:parseCase,transition:parseTransition};
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const blankIdentity=():IdentityResult=>({checks:[],unknown:['local build observations unavailable'],changed:[],configDrift:[],notEvaluable:[]});
const blankRegression=():RegressionCheck=>({ok:false,set:[],base:{ref:'not read',commit:null,fetchedAt:null},problems:['regression history unavailable']});
const json=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value,(_k,v:unknown)=>v instanceof Map?[...v]:v instanceof Set?[...v]:v,2)+'\n');

async function checkRemote(repo:string,remote:string,branch:string,commit:string|null):Promise<string|null> {
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)||(await git(repo,['check-ref-format',`refs/heads/${branch}`],{allowFail:true})).ok===false)return 'invalid configured base remote/branch';
  const r=await git(repo,['ls-remote','--exit-code',remote,`refs/heads/${branch}`],{allowFail:true,timeoutMs:15000,env:{GIT_SSH_COMMAND:'ssh -o BatchMode=yes'}});
  if(!r.ok)return `base remote ${remote} is unreachable (no fetch performed)`;
  const actual=r.stdout.trim().split(/\s+/)[0];
  return actual===commit?null:`remote ${remote}/${branch} differs from the local remote-tracking ref; fetch before a verdict`;
}

async function scope(root:string,state:Persisted,request:CoordinatorRequest,now:Date) {
  const problems:string[]=[];const profile=state.profile;
  const base=await readBase(root,profile.remote,profile.baseBranch,decoders);
  const remote=await checkRemote(root,profile.remote,profile.baseBranch,base.commit);if(remote)problems.push(remote);
  if(base.profile===null)throw new Error('suite remote-tracking base has no validated profile');
  const trusted=base.profile;const baseline=approvedSetOf(trusted,base.cases);problems.push(...baseline.problems);
  // Every baseline record and every branch owner decision uses upstream roles.
  for(const record of base.cases.values()){const why=approvalProblem(record,trusted.roles,trusted.configurations);if(why)problems.push(`base ${record.id}: ${why}`);}
  const declared=approvedSetOf({...profile,roles:trusted.roles},state.cases);problems.push(...declared.problems);
  const transitions=await branchTransitions(root,base.ref,decoders);const history=await readTransitionBases(root,base.ref,transitions.transitions,decoders);
  problems.push(...transitions.problems,...history.problems);
  const regression=checkRegression({...base,now,maxAgeHours:profile.maxBaseRefAgeHours,base:baseline.set,baseRoles:trusted.roles,transitions:transitions.transitions,declared:declared.set,historicalBases:history.historicalBases});
  regression.problems.push(...problems);regression.ok=regression.problems.length===0;
  const classification=effectiveClassification(profile.classification,trusted.roles,trusted.classification);
  const policyProblems=classification.refused.map(r=>`classification ${r.record.id} refused: ${r.reason}`);
  for(const old of trusted.classification)if(!profile.classification.some(c=>c.id===old.id))policyProblems.push(`classification history ${old.id} was removed`);
  const workFiles=readdirSync(inside(root,'.test-lab/work')).filter(f=>f.endsWith('.json')).map(name=>{
    const file=readWorkFile(inside(root,`.test-lab/work/${name}`));
    if(file===null||name!==`${file.ticket}.json`)throw new Error(`work path/identity mismatch ${name}`);
    return file;
  });
  // The QA checkout owns corpus storage; the application checkout owns the work binding/journal.
  const branch=await currentBranch(request.appRoot);
  const resolution=resolveWork({...(request.work===undefined?{}:{work:request.work}),...(request.noWork===undefined?{}:{noWork:request.noWork}),branch,bound:branch===null?null:await boundTicket(request.appRoot,branch),declarations:workFiles.map(f=>({ticket:f.ticket,branch:f.branch,closed:verifyWork(null,f).closed}))});
  let check:WorkCheck|null=null;
  if(resolution.status==='bound') {
    const file=workFiles.find(f=>f.ticket===resolution.ticket)!;const key=await repoKeyOf(request.appRoot);const journal=readJournal(journalPath(key,resolution.ticket));
    if(journal!==null&&(journal.repoKey!==key||journal.ticket!==resolution.ticket))throw new Error('work journal identity mismatch');
    check=verifyWork(journal,file);policyProblems.push(...check.problems.map(describeProblem));
  }
  const required={regression:regression.set,addendum:check?.addendum??[]};
  policyProblems.push(...requiredSetProblems(required,state.cases,trusted.roles,profile.configurations));
  for(const m of state.ledger) {
    const record=state.cases.get(m.obligation.case);
    if(!record?.steps.some(s=>s.id===m.obligation.step&&s.obligations.some(o=>o.id===m.obligation.obligation)))policyProblems.push(`mapping has unknown obligation ${JSON.stringify(m.obligation)}`);
    if(!profile.configurations.some(c=>c.id===m.configuration)||!profile.suites.some(s=>s.id===m.test.suite))policyProblems.push('mapping has unknown suite/configuration');
    const suite=profile.suites.find(s=>s.id===m.test.suite);if(suite)inside(dirname(inside(root,suite.config)),m.test.file);
    if(m.test.titlePath.length===0)policyProblems.push('mapping has empty title path');
  }
  for(const id of [...required.regression,...required.addendum]) {
    const record=state.cases.get(id);if(record?.fixture!==null&&record?.fixture!==undefined&&!profile.fixtures.some(f=>f.id===record.fixture))policyProblems.push(`required case ${id} names an unknown fixture`);
    if(new Set(state.ledger.filter(m=>m.obligation.case===id).map(m=>m.test.suite)).size>1)policyProblems.push(`case ${id} spans suites; cross-suite evidence composition is not supported yet`);
  }
  const sourceAssociations=base.commit===null?new Map():await trustedSourceAssociations(root,base.commit,base.cases,trusted.roles);
  return {regression,classification:classification.rules,roles:trusted.roles,work:{resolution,check},required,sourceAssociations,problems:policyProblems};
}

function digest(state:Persisted,suite:string,config:string,begin:BeginRecord):DigestReport {
  const definition=state.profile.suites.find(s=>s.id===suite)!;
  return computeDigests({suite,suiteRoot:dirname(config),begin,cases:state.cases,ledger:state.ledger,recipes:state.recipes,declaredInputs:state.profile.declaredInputs,declaredEnvironmentInputs:definition.declaredEnvironmentInputs??[],declaredBaselines:state.profile.declaredBaselines,kitDir:join(dirname(config),'support/test-lab')});
}

function walk(root:string):string[] {
  const files:string[]=[];
  for(const e of readdirSync(root,{withFileTypes:true})) {
    if(e.name==='node_modules'||e.name==='.git'||e.name==='.test-lab'||e.name==='test-results'||e.name==='playwright-report')continue;
    const path=join(root,e.name);
    if(e.isDirectory())files.push(...walk(path));else if(e.isFile()&&/\.[cm]?[jt]sx?$/.test(e.name))files.push(path);
  }
  return files;
}
function hostProblems(profile:Profile,environment:EnvironmentDef,suite:string,config:string,rules:ReturnType<typeof effectiveClassification>['rules'],entries:string[],projects:string[]):string[] {
  // A project execution label doesn't own shared configuration/support files. Path exclusions do.
  const pathRules=rules.filter(r=>r.target.project===undefined||r.target.glob!==undefined);
  const findings:ReturnType<typeof literalHosts>=[];
  const closure=optionClosureProblems(entries,file=>projects.some(project=>laneClassOf(pathRules,suite,project,relative(dirname(config),file))==='excluded'),(file,text)=>findings.push(...literalHosts(relative(dirname(config),file),text)));
  return [...closure,...unsafeHosts(findings,[environment.baseUrl],profile.allowedHosts).map(f=>`unsafe literal host ${f.host} for this target in ${f.file}:${f.line}`)];
}
function actorProblems(state:Persisted,obs:InvocationObservation,selected:string[]):string[] {
  const problems:string[]=[];
  for(const t of obs.tests.filter(t=>selected.includes(t.declaration.project)))for(const r of t.results) {
    const probes=r.actorProbes??[];
    // An explained skip executes no body/beforeEach and supplies no passing witness.
    if(probes.length===0&&r.status==='skipped'&&r.expectedStatus==='skipped')continue;
    if(probes.length!==1) {problems.push(`after-setup actor observation missing/duplicate for ${testKey(t.identity)}`);continue;}
    const p=probes[0]!;const environment=obs.begin?.environment;
    const definition=state.profile.configurations.filter(c=>c.project===t.declaration.project);
    if(!p.ok||p.phase!=='after-setup'||p.project!==t.declaration.project||p.path!==state.local.actorProbe.path||p.roleField!==state.local.actorProbe.roleField||p.actual!==p.expected||!definition.some(c=>c.role===p.actual)||environment===null||environment===undefined||new URL(p.url).origin!==new URL(environment.baseUrl).origin)problems.push(`after-setup actor role/host was not confirmed for ${testKey(t.identity)}`);
    for(const step of r.steps)if(step.ids?.obligation!==null&&step.ids!==null&&step.ids!==undefined&&state.ledger.some(m=>m.layer==='served'&&testKey(m.test)===testKey(t.identity)&&m.obligation.case===step.ids!.case&&m.obligation.step===step.ids!.step&&m.obligation.obligation===step.ids!.obligation)&&step.ids.navigationOrigin!==new URL(environment!.baseUrl).origin)problems.push(`served obligation navigation target was not confirmed for ${testKey(t.identity)}`);
  }
  return problems;
}

export async function coordinate(request:CoordinatorRequest):Promise<CoordinatorResult> {
  const startedAt=new Date().toISOString();const now=new Date(startedAt);
  const appRoot=realpathSync(request.appRoot);const suiteRoot=realpathSync(request.suiteRoot);
  // Optional for standalone/legacy CLI results. Mod results must carry a validated request identity.
  let requestIdentity:RequestIdentity|undefined;
  if(request.requestIdentity!==undefined) {
    const parsed=parseIdentity(request.requestIdentity);
    const context={operation:request.operation,appRoot,suiteRoot,environment:request.environment,work:request.work??null,noWork:request.noWork===true};
    if(parsed===null||canonical(parsed.context)!==canonical(context)||parsed.inputsHash!==await inputHash(request.environmentValues??null))throw new Error('request identity does not match the core operation/context/work/inputs');
    requestIdentity=structuredClone(parsed);
  }

  if(await repoTop(suiteRoot)!==null) {
    const branch=await currentBranch(suiteRoot);
    if(branch===null||branch==='main'||branch==='master')throw new Error('persisted run artifacts require a dedicated suite branch/worktree');
  }
  const runRoot=inside(suiteRoot,'.test-lab/runs');mkdirSync(runRoot,{recursive:true});
  const runDir=join(runRoot,`${startedAt.replace(/[:.]/g,'-')}-${randomUUID()}`);mkdirSync(runDir);
  // A listener that throws never changes the operation.
  const progress=(event:CoordinatorProgress)=>{try{request.onProgress?.(event);}catch{/* progress is advisory */}};progress({kind:'run-dir',runDir});
  const manifest:{schema:1;requestIdentity?:RequestIdentity;operation:string;context:unknown;observations:unknown[];invocations:unknown[];problems:string[];before:unknown;after:unknown}={schema:1,...(requestIdentity===undefined?{}:{requestIdentity}),operation:request.operation,context:{appRoot,suiteRoot,via:'explicit arguments',environment:request.environment},observations:[],invocations:[],problems:[],before:null,after:null};
  let state:Persisted|null=null;let environment:EnvironmentDef|null=null;
  let regression=blankRegression();let identity=blankIdentity();let work:{resolution:WorkResolution;check:WorkCheck|null}={resolution:{status:'unresolved',reason:'work not read',suggestion:null},check:null};
  let normalized:ReturnType<typeof normalize>={tests:[],required:[],problems:[]};let evidence:CaseEvidence[]=[];const fixtures:FixtureCheck[]=[];
  let status:RunStatus={complete:false,problems:[]};let risks:ReturnType<typeof riskAcceptances>['live']=[];
  const profileProblems:string[]=[];const runProblems:string[]=[];let configurationDependent:string[]=[];let requiredFixtures:string[]=[];
  const suites:SuiteObservation[]=[];const locks:string[]=[];
  let before:ContentManifest|null=null;let after:ContentManifest|null=null;let beforeSuite:ContentManifest|null=null;let siteRoot:string|null=null;let afterSiteRoot:string|null=null;let configuration:string|null=null;
  const plans:Invocation[]=[];let frozen:Persisted|null=null;
  let normalizationInput:Omit<Parameters<typeof normalize>[0],'run'|'roleOverrideFiles'>|null=null;
  const retainedRuns=new Map<string,InvocationObservation>();
  const adapter=request.adapter===undefined?null:adapterOperation(request.adapter,{...(request.signal===undefined?{}:{signal:request.signal}),...(request.timeoutMs===undefined?{}:{timeoutMs:request.timeoutMs})});
  const executeObserved=async(planned:Invocation):Promise<InvocationObservation>=>{
    const inv={...planned,id:relative(runDir,planned.dir).replaceAll('/','-')};
    plans.push(inv);manifest.invocations.push({id:inv.id,suite:inv.suite,purpose:inv.purpose,cwd:inv.cwd,argv:inv.argv,environmentNames:Object.keys(inv.env),baseUrlOwned:true,dir:inv.dir});json(join(runDir,'manifest.json'),manifest);
    progress({kind:'invocation',suite:inv.suite,purpose:inv.purpose,id:inv.id});
    if(request.signal?.aborted)throw new Error('operation interrupted before invocation');
    const result=await execute(inv,{timeoutMs:request.timeoutMs??600000,...(request.signal===undefined?{}:{signal:request.signal})});const observed=readInvocation(inv);
    if(inv.purpose==='run')retainedRuns.set(inv.id,observed);
    if(result.signal!==null)observed.problems.push(`owned invocation ended with signal ${result.signal}`);
    return observed;
  };
  try {
    state=loadPersisted(suiteRoot);frozen=state;
    runProblems.push(...state.evidenceProblems.map(p=>`persisted evidence unavailable/invalid: ${p}`));
    manifest.context={appRoot,suiteRoot,via:'explicit arguments',environment:request.environment,corpusRevision:hashOf([...state.cases].map(([id,c])=>[id,c.approval?.hash??null]).sort()),files:state.files};
    if(realpathSync((await repoTop(suiteRoot))??suiteRoot)!==suiteRoot||await repoTop(suiteRoot)===null)throw new Error('suite/corpus root must be the selected Git checkout root');
    if(await repoTop(appRoot)===null||realpathSync((await repoTop(appRoot))!)!==appRoot)throw new Error('application root must be the served Git worktree root');
    const policy=await scope(suiteRoot,state,request,now);regression=policy.regression;work=policy.work;profileProblems.push(...policy.problems);
    const appBase=state.local.applicationBase;const appRef=await readBaseRef(appRoot,appBase.remote,appBase.branch);
    const appFresh=baseFreshness({...appRef,now,maxAgeHours:appBase.maxAgeHours});const appRemote=await checkRemote(appRoot,appBase.remote,appBase.branch,appRef.commit);
    if(appFresh)profileProblems.push(`application base: ${appFresh}`);if(appRemote)profileProblems.push(`application base: ${appRemote}`);
    manifest.observations.push({applicationBase:appRef,suiteBase:regression.base,work:{applicationRoot:appRoot,branch:await currentBranch(appRoot),resolution:work.resolution,check:work.check}});
    environment=state.profile.environments.find(e=>e.id===request.environment)??null;
    if(environment===null||environment.kind!=='local-candidate')profileProblems.push('only an explicitly selected local-candidate environment is supported');
    const required=new Set([...policy.required.regression,...policy.required.addendum]);
    configurationDependent=[...required].filter(id=>state!.cases.get(id)?.configurationDependent);
    requiredFixtures=[...new Set([...required].flatMap(id=>{const f=state!.cases.get(id)?.fixture;return f?[f]:[];}))];
    for(const f of state.profile.fixtures.filter(f=>requiredFixtures.includes(f.id)))if(!f.environments.includes(request.environment))profileProblems.push(`required fixture ${f.id} is not declared on ${request.environment}`);
    const quarantine=quarantines(state.dispositions,policy.roles,now,state.profile.quarantineCap,t=>state!.ledger.some(m=>required.has(m.obligation.case)&&testKey(m.test)===testKey(t)));
    const risk=riskAcceptances(state.dispositions,policy.roles,now);risks=risk.live;
    // Preserve the complete required denominator even if interruption stops before discovery/run.
    normalizationInput={configurations:state.profile.configurations,cases:state.cases,required:policy.required,ledger:state.ledger,classification:policy.classification,liveQuarantines:quarantine.live,quarantinesOnRequired:quarantine.onRequired};
    normalized=normalize({...normalizationInput,run:{invocations:[]},roleOverrideFiles:new Set<string>()});
    const selectedSuites=state.profile.suites.filter(s=>suiteExcluded(policy.classification,s.id)===null&&state!.ledger.some(m=>m.test.suite===s.id&&required.has(m.obligation.case)));
    const inputs=request.operation==='verify'||environment===null?{projections:new Map(),problems:[]}:operationInputs(selectedSuites,environment,request.environmentValues??{});
    profileProblems.push(...inputs.problems.map(p=>`operation inputs: ${p}`));
    if(request.signal?.aborted)throw new Error('operation interrupted before local adapters or invocations');
    manifest.observations.push({refusedDispositions:[...quarantine.refused,...risk.refused],evidenceProblems:state.evidenceProblems});
    // Policy refusals stop before loading configs, setup, or site commands.
    if(profileProblems.length===0&&regression.ok&&work.resolution.status!=='unresolved'&&environment!==null) {
      before=await contentManifest(appRoot,{assetDirs:state.profile.generatedAssets});beforeSuite=await contentManifest(suiteRoot);
      manifest.before={application:before,suite:beforeSuite,files:state.files};
      if(request.operation!=='verify') {
        const declaredUrls=Object.entries(request.environmentValues??{}).flatMap(([name,v])=>v.state==='set'?literalHosts(`declared input ${name}`,v.value):[]);
        runProblems.push(...unsafeHosts(declaredUrls,[environment.baseUrl],state.profile.allowedHosts).map(f=>`declared input ${f.file} names a host outside this target: ${f.host}`));
        if(request.adapter===undefined)runProblems.push('local identity/fixture adapter unavailable; these checks are not checked');
        else {
          try{siteRoot=realpathSync((await adapter!.call(context=>request.adapter!.identity(context))).appRoot);manifest.observations.push({siteAdapter:request.adapter.name,servedAppRoot:siteRoot});}catch(e){runProblems.push(`local identity observation unavailable: ${String(e)}`);}
          if(siteRoot!==appRoot)runProblems.push(`site application root ${siteRoot??'not checked'} does not match ${appRoot}`);
          if(request.adapter.configuration===undefined)manifest.observations.push({configuration:'not checked',lastImportAt:'not checked'});
          else try{const c=await adapter!.call(context=>request.adapter!.configuration!(context));configuration=c.status;if(parseConfigStatus(configuration)===null)runProblems.push('configuration observation is unreadable');manifest.observations.push({configuration:c.status,lastImportAt:c.lastImportAt});}catch(e){runProblems.push(`configuration observation unavailable: ${String(e)}`);}
          for(const fixture of state.profile.fixtures.filter(f=>requiredFixtures.includes(f.id)&&f.environments.includes(environment!.id)))try {
            const seen=await adapter!.call(context=>request.adapter!.fixture(fixture,context));fixtures.push(judgeFixture(fixture,seen.observation));manifest.observations.push({fixture:fixture.id,...seen});
          }catch(e){fixtures.push({fixture:fixture.id,existence:'not-established',detail:'local lookup unavailable',structure:fixture.structure});runProblems.push(`required fixture ${fixture.id} lookup unavailable: ${String(e)}`);}
        }
        if(configuration===null&&configurationDependent.length>0)runProblems.push('configuration-dependent cases need an actual configuration observation');
        const health=await probeHealth(new URL(state.local.healthPath,`${environment.baseUrl.replace(/\/+$/,'')}/`).href);manifest.observations.push({preflightHealth:health});if(!health.reachable)runProblems.push('target host is not reachable');
      }
      const index=existsSync(inside(suiteRoot,'.test-lab/source.json'))?parseSourceIndex(readJson(inside(suiteRoot,'.test-lab/source.json'))):null;
      const sourcePolicy=requiredSourceAssociations(required,state.cases,policy.sourceAssociations,index);runProblems.push(...sourcePolicy.problems);
      if(sourcePolicy.associations.size>0)try {
        if(index===null)throw new Error('source provenance index unavailable; owner-approved association cannot be removed');
        const snapshot=await readSnapshot(inside(suiteRoot,`.test-lab/${index.snapshot}`));
        const stale=snapshotProblem(snapshot,now,state.profile.maxSnapshotAgeHours);if(stale)runProblems.push(stale);
        const drafts=importSnapshot(snapshot);for(const [id,association] of sourcePolicy.associations){
          const c=state.cases.get(id)!;const binding=index.cases.find(x=>x.case===id);const draft=drafts.find(d=>d.source.case===binding?.sourceCase&&d.source.suite===binding?.suite);
          const sourceRef=`testrail:project:${snapshot.project}:suite:${binding?.suite}:case:${binding?.sourceCase}`;
          if(binding===undefined||draft===undefined||association===null||association.project!==snapshot.project||association.suite!==binding.suite||association.case!==binding.sourceCase||binding.rawHash!==draft.source.rawHash||binding.caseHash!==c.approval?.hash||!c.provenance.independentRefs.includes(sourceRef)||binding.approval.hash!==sourceBindingHash(snapshot.project,binding)||ownerRoleHolds(policy.roles,c.track,binding.approval)!==null)runProblems.push(`source provenance for ${c.id} is absent or changed; its owner must approve a current interpretation binding and source policy`);
        }
        manifest.observations.push({source:{project:snapshot.project,fetchedAt:snapshot.fetchedAt,complete:snapshot.complete},sourcePolicies:[...sourcePolicy.associations]});
      }catch(e){runProblems.push(`source provenance could not be validated: ${String(e)}`);}
      if(request.operation!=='verify'&&runProblems.length===0&&!fixtures.some(f=>f.existence==='missing'))for(const definition of state.profile.suites) {
        if(suiteExcluded(policy.classification,definition.id)!==null){manifest.observations.push({excluded:suiteExcluded(policy.classification,definition.id)});continue;}
        const rows=state.ledger.filter(m=>m.test.suite===definition.id&&required.has(m.obligation.case));if(rows.length===0)continue;
        const config=inside(suiteRoot,definition.config);const projects=[...new Set(rows.map(m=>state!.profile.configurations.find(c=>c.id===m.configuration)!.project))];
        const staticProblems=[...stagedKitProblems(join(dirname(config),'support/test-lab')),...hostProblems(state.profile,environment,definition.id,config,policy.classification,[config],['\0',...projects])];
        if(staticProblems.length){runProblems.push(...staticProblems);continue;}
        const lock=join(dirname(config),'.test-lab','operation.lock');mkdirSync(dirname(lock),{recursive:true});writeFileSync(lock,JSON.stringify({pid:process.pid,runDir}),{flag:'wx'});locks.push(lock);
        const selectedFiles=[...new Set(rows.map(m=>m.test.file))];
        const grep=rows.map(m=>`(?:^|\\s)${escape(m.test.titlePath.join(' '))}$`).join('|');
        // One invocation per project preserves project-specific exclusions and configuration identities.
        for(const project of projects) {
          const base:SuitePlanInput={suite:definition.id,config,rules:policy.classification,environment,runDir:join(runDir,`${definition.id}-${projects.indexOf(project)}`),reporter:join(dirname(config),'support/test-lab/reporter.ts'),projects:[project],secretOptions:state.profile.secretOptions,declaredEnvironmentInputs:definition.declaredEnvironmentInputs??[],environmentValues:inputs.projections.get(definition.id)??{},selectedFiles,extraArgs:['--grep',grep]};
          const probe=await executeObserved(probeInvocation(base));
          const probeErrors=probe.errors.filter(e=>!/^Error: No tests found\.\nMake sure that arguments are regular expressions matching test files\./.test(e.message));
          if(probe.begin===null||probe.begin.tests.length!==0||probe.problems.length||probeErrors.length||probe.completion===null||!['passed','failed'].includes(probe.completion.finalStatus)){runProblems.push(`config probe failed for ${definition.id}: ${[...probe.problems,...probeErrors.map(e=>e.message)].join('; ')}`);continue;}
          const wrong=probe.begin.projects.filter(p=>p.name===project).some(p=>p.use['baseURL']!==environment!.baseUrl);
          if(wrong){runProblems.push('resolved baseURL differs from planner target');continue;}
          const running=pulledIn(probe.begin.projects,[project]);
          const sources=[config,...probe.begin.globalSetup,...probe.begin.globalTeardown,...probe.begin.projects.filter(p=>running.has(p.name)).flatMap(p=>walk(p.testDir).filter(f=>laneClassOf(policy.classification,definition.id,p.name,relative(dirname(config),f))!=='excluded'))];
          runProblems.push(...hostProblems(state.profile,environment,definition.id,config,policy.classification,sources,[...running]));
          for(const p of probe.begin.projects.filter(p=>p.name===project)) {
            const browser=p.use['browserName']??'chromium';
            if(!['chromium','firefox','webkit'].includes(String(browser))){runProblems.push(`unsupported browser ${String(browser)}`);continue;}
            const library=createRequire(join(dirname(config),'package.json'))('@playwright/test');
            if(!existsSync(library[String(browser)].executablePath()))runProblems.push(`browser ${String(browser)} is not installed (no install attempted)`);
            for(const role of state.profile.configurations.filter(c=>c.project===project&&c.role!=='anonymous')) {
              const declared=state.profile.roleDefinitions.find(r=>r.name===role.role);const storage=p.use['storageState'];
              if(declared===undefined||!p.dependencies.includes(declared.setupProject)||typeof storage!=='string'||resolve(dirname(config),declared.storageState)!==resolve(dirname(config),storage))runProblems.push(`role ${role.role} lacks the declared login setup/storage state`);
            }
          }
          if(runProblems.length)continue;
          const discoveryPlan=planSuite(base,probe.begin,'discover');if(!discoveryPlan.ok){runProblems.push(...discoveryPlan.refusals);continue;}
          const discovery=await executeObserved(discoveryPlan.invocation);
          if(discovery.begin===null||discovery.problems.length||discovery.errors.length||discovery.completion===null||excludedListed(policy.classification,definition.id,discovery.begin).length){runProblems.push('discovery is incomplete, unsafe or unreadable');continue;}
          if(!discovery.begin.tests.some(t=>t.project===project)){runProblems.push(`selection for ${definition.id}/${project} is empty`);continue;}
          const beforeDigests=digest(state,definition.id,config,discovery.begin);
          for(const t of discovery.begin.tests.filter(t=>t.project===project)) {
            const current=beforeDigests.behavior.get(behaviorKey({suite:definition.id,file:t.file,titlePath:t.titlePath},project));
            if(current?.status!=='resolved'||!current.inputs.some(i=>i.path==='support/test-lab/actor-probe.ts'))runProblems.push(`test ${t.file} needs the explicit after-setup actor probe integration and resolved inputs`);
          }
          const observation:SuiteObservation={suite:definition.id,config,before:await contentManifest(suiteRoot),discovery,beforeDigests,run:null,afterDigests:null};suites.push(observation);
          if(request.operation==='run'&&runProblems.length===0) {
            const planned=planSuite(base,discovery.begin,'run');if(!planned.ok){runProblems.push(...planned.refusals);continue;}
            manifest.observations.push({exclusions:planned.exclusions});
            observation.run=await executeObserved(planned.invocation);
            // Read finalized runtime environment observations, never the config-only begin.
            if(observation.run.begin!==null)observation.afterDigests=digest(state,definition.id,config,observation.run.begin);
            const changes=compareManifests(observation.before,await contentManifest(suiteRoot));if(changes.length)runProblems.push(`suite changed during invocation: ${changes.map(x=>x.path).join(', ')}`);
            if(observation.afterDigests!==null&&canonicalJson({manifest:beforeDigests.manifest,behavior:[...beforeDigests.behavior],toolchain:beforeDigests.toolchain})!==canonicalJson({manifest:observation.afterDigests.manifest,behavior:[...observation.afterDigests.behavior],toolchain:observation.afterDigests.toolchain}))runProblems.push('behavior/toolchain inputs or effective settings changed between discovery and finalized run');
            runProblems.push(...actorProblems(state,observation.run,[project]));
            if(!observation.run.artifacts.html||!observation.run.artifacts.json)runProblems.push(`invocation ${planned.invocation.id} is missing a human report`);
          }
        }
      }
      const run:RunObservation={invocations:suites.flatMap(s=>s.run===null?[]:[s.run])};
      if(request.operation!=='run'||run.invocations.length===0)runProblems.push(`${request.operation}: no completed fast run; after-setup roles and readiness are not checked`);
      const overrides=new Set(suites.flatMap(s=>[...(s.afterDigests?.roleOverrideFiles??s.beforeDigests.roleOverrideFiles)]));
      for(const id of required) {
        const record=state.cases.get(id);if(record===undefined)continue;
        const suite=state.ledger.find(m=>m.obligation.case===id)?.test.suite;const observations=suites.filter(s=>s.suite===suite&&s.run!==null&&s.afterDigests!==null);
        if(observations.length===0){evidence.push({case:id,track:record.track,status:'insufficient',mappings:[],problems:['fresh finalized suite observations unavailable']});continue;}
        const first=observations[0]!;const digests:DigestReport={...first.afterDigests!,behavior:new Map(observations.flatMap(s=>[...s.afterDigests!.behavior])),roleOverrideFiles:overrides};
        const effective=effectiveConfig(first.run!.begin!,browsersOf(first.run!));
        const projects=observations.flatMap(s=>effectiveConfig(s.run!.begin!,browsersOf(s.run!)).projects);
        effective.projects=[...new Set(projects.map(p=>p.name))].map(name=>projects.find(p=>p.name===name&&p.browserVersion!==null)??projects.find(p=>p.name===name)!);
        evidence.push(evaluateCase(record,record.track,{evidenceDir:join(suiteRoot,'.test-lab/evidence'),recipesDir:join(suiteRoot,'.test-lab/recipes'),records:state.evidence,digests,effective,environment:{id:environment.id,kind:environment.kind,baseUrl:environment.baseUrl},configurations:state.profile.configurations,ledger:state.ledger,dispositions:state.dispositions,roles:policy.roles,materialFields:state.profile.materialFields}));
      }
    }
  }catch(error){if(state!==null&&request.signal?.aborted)runProblems.push(`operation interrupted: ${String(error)}`);else if(state===null)profileProblems.push(`persisted contract unavailable/invalid: ${String(error)}`);else if(normalizationInput===null)profileProblems.push(`operation policy could not be validated: ${String(error)}`);else runProblems.push(`operation could not complete: ${String(error)}`);}
  finally {
    // An aborted operation starts no new adapter work, and the interruption is always a run problem.
    if(request.signal?.aborted&&!runProblems.some(p=>p.startsWith('operation interrupted')))runProblems.push('operation interrupted: the request was aborted before finalization');
    if(before!==null)try {
      after=await contentManifest(appRoot,{assetDirs:state?.profile.generatedAssets??[]});const afterSuite=await contentManifest(suiteRoot);
      const current=loadPersisted(suiteRoot);if(frozen!==null&&canonicalJson(frozen.files)!==canonicalJson(current.files))runProblems.push('persisted corpus/evidence/profile changed during operation');
      if(beforeSuite!==null&&compareManifests(beforeSuite,afterSuite).length)runProblems.push('suite checkout inputs changed during operation');
      if(request.operation==='run'&&request.adapter!==undefined&&siteRoot!==null&&request.signal?.aborted!==true) {
        try{afterSiteRoot=realpathSync((await adapter!.call(context=>request.adapter!.identity(context))).appRoot);}catch(e){runProblems.push(`after-run served application observation unavailable: ${String(e)}`);}
      }
      manifest.after={application:after,suite:afterSuite,files:current.files,servedAppRoot:afterSiteRoot};
    }catch(e){runProblems.push(`after-run manifests unavailable: ${String(e)}`);}
    adapter?.dispose();
    for(const lock of locks)rmSync(lock,{force:true});
  }
  // Always aggregate observations, even if a later suite throws or an invocation is canceled.
  // Re-read any planned run not returned by execute() so partial failures remain visible.
  for(const inv of plans.filter(p=>p.purpose==='run'))if(!retainedRuns.has(inv.id))retainedRuns.set(inv.id,readInvocation(inv));
  const retained:RunObservation={invocations:[...retainedRuns.values()]};status=runStatus(retained);
  if(normalizationInput!==null) {
    const overrides=new Set(suites.flatMap(s=>[...(s.afterDigests?.roleOverrideFiles??s.beforeDigests.roleOverrideFiles)]));
    normalized=normalize({...normalizationInput,run:retained,roleOverrideFiles:overrides});
  }
  if(environment!==null&&state!==null) {
    identity=evaluateIdentity({environment,appRoot,before,after,ddevDescribe:null,drushConfigStatus:configuration,knownConfigOverrides:state.profile.knownConfigOverrides,effectiveBaseUrls:suites.flatMap(s=>(s.run?.begin??s.discovery.begin)?.projects.filter(p=>p.use['baseURL']!==undefined).map(p=>String(p.use['baseURL']))??[]),database:state.local.database,buildProbe:null});
    identity.checks=identity.checks.filter(c=>c.name!=='root');identity.checks.push({name:'root',status:siteRoot===null?'not-checked':siteRoot===appRoot?'matched':'mismatch',detail:siteRoot??'local application adapter unavailable'});
    if(siteRoot!==appRoot)identity.unknown.push('actual served application worktree was not confirmed');
    // Still rule 2: the served worktree is unconfirmed. Name the interruption as the reason, not a change.
    if(request.operation==='run'&&siteRoot!==null&&request.signal?.aborted===true)identity.unknown.push('served application worktree was not re-observed after the run: the operation was interrupted');
    else if(request.operation==='run'&&siteRoot!==null&&afterSiteRoot!==siteRoot)identity.unknown.push('served application worktree changed or could not be confirmed after the run');
    if(before?.commit===null||after?.commit===null)identity.unknown.push('application checkout has no commit identity');
    if(after?.missingAssetDirs.length)identity.unknown.push('declared generated assets are missing');
  }
  status.problems.push(...runProblems.map(detail=>({kind:'ledger-invalid' as const,invocation:'coordinator',detail})));status.complete=status.problems.length===0;
  manifest.problems.push(...profileProblems,...regression.problems,...runProblems);manifest.observations.push({suites:suites.map(s=>({suite:s.suite,discovery:s.discovery.plan,run:s.run?.plan??null,beforeDigests:s.beforeDigests,afterDigests:s.afterDigests})),identity,evidence});
  const health=request.operation==='run'&&suites.some(s=>s.run!==null)&&environment!==null&&state!==null?await probeHealth(new URL(state.local.healthPath,`${environment.baseUrl.replace(/\/+$/,'')}/`).href):null;
  const verdict=decide({profileProblems,regression,work,identity,configurationDependent,runStatus:status,fixtures,requiredFixtures,breaker:outageBreaker(normalized.tests,health),normalized,riskAcceptances:risks,evidence});
  const requiredIds=new Set([...regression.set,...(work.check?.addendum??[])]);
  if(state!==null) {
    verdict.outside.push(...[...state.cases.keys()].filter(id=>!requiredIds.has(id)).map(id=>`case ${id}: not in this work's required set; not selected in fast`));
    const used=new Set([...requiredIds].flatMap(id=>state!.cases.get(id)?.configurations??[]));
    verdict.outside.push(...state.profile.configurations.filter(c=>!used.has(c.id)).map(c=>`configuration ${c.id}: outside every required case's applicability`));
    verdict.outside.push(...state.profile.suites.filter(s=>!suites.some(o=>o.suite===s.id)).map(s=>`suite ${s.id}: not run in this fast operation (see manifest for exclusions/refusals)`));
  }
  const counts=[...new Set([...requiredIds].flatMap(id=>{const c=state?.cases.get(id);return c?[JSON.stringify([c.track,c.priority])]:[];}))].map(key=>{
    const [track,priority]=JSON.parse(key) as [string,string];const ids=[...requiredIds].filter(id=>{const c=state?.cases.get(id);return c?.track===track&&c.priority===priority;});
    const current=ids.filter(id=>normalized.required.some(c=>c.case===id)&&normalized.required.filter(c=>c.case===id).every(c=>c.outcome==='passed')).length;
    return {track,priority,cases:ids.length,current,verified:ids.filter(id=>evidence.find(e=>e.case===id)?.status==='verified').length,waived:ids.filter(id=>evidence.find(e=>e.case===id)?.status==='waived').length,developerAttested:ids.filter(id=>evidence.find(e=>e.case===id)?.status==='developer-attested').length};
  });
  const file=writeVerdict({runDir,...(requestIdentity===undefined?{}:{requestIdentity}),project:state?.profile.project??'unreadable profile',environment:environment?.id??request.environment,startedAt,finishedAt:new Date().toISOString(),...(environment===null||state===null?{}:{context:{appRoot,suiteRoot,environment:{id:environment.id,kind:environment.kind,baseUrl:environment.baseUrl},build:{commit:after?.commit??before?.commit??null,digest:after?.digest??before?.digest??null},suite:{commit:beforeSuite?.commit??null,digest:beforeSuite?.digest??null},corpusRevision:hashOf([...state.cases].map(([id,c])=>[id,c.approval?.hash??null]).sort()),identityChecks:identity.checks,counts}})},verdict,machineId());
  // The coordinator's report index is always local; individual Playwright reports stay in their own folders.
  const html=renderMarkdown(file).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  writeFileSync(join(runDir,'verdict.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>test-lab verdict</title><style>body{max-width:80rem;margin:2rem auto;padding:1rem;font:16px system-ui}pre{white-space:pre-wrap}</style><h1>test-lab local candidate</h1><pre>${html}</pre></html>`);
  mkdirSync(join(runDir,'html'));writeFileSync(join(runDir,'html/index.html'),`<!doctype html><meta charset="utf-8"><a href="../verdict.html">Local verdict</a><ul>${suites.filter(s=>s.run?.artifacts.html).map(s=>`<li><a href="../${relative(runDir,s.run!.plan.dir)}/html/index.html">${s.suite}</a></li>`).join('')}</ul>`);
  json(join(runDir,'manifest.json'),manifest);
  const validVerify=request.operation==='verify'&&profileProblems.length===0&&regression.ok&&work.resolution.status!=='unresolved'&&(work.check===null||work.check.ok)&&!runProblems.some(p=>!p.startsWith('verify:'));
  const exitCode=validVerify?0:EXIT_CODES[verdict.verdict];
  const summary=request.operation==='verify'&&validVerify?'Policy verification passed; local readiness was not evaluated.':`${verdict.verdict.toUpperCase().replaceAll('-',' ')} (rule ${verdict.rule}): ${verdict.reasons.join('; ')}`;
  return {runDir,verdict,exitCode,summary,file};
}
