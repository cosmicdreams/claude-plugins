// Persisted records are untrusted. Only this schema boundary constructs core records from JSON.
// object()'s single mapped-type assertion follows validation of every key, including unknown keys.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { CaseRecord, Disposition, EvidenceRecord, Mapping, Profile } from './model.ts';
import type { Transition } from './regression.ts';
import { declarationProblems } from '../kit/environment-inputs.ts';
import { configurationProblems } from './cases.ts';
import { hashOf, sha256 } from './canonical.ts';

type Schema<T> = { read(value: unknown, path: string): T };
type Value<S> = S extends Schema<infer T> ? T : never;
const fail = (path: string, why: string): never => { throw new Error(`${path}: ${why}`); };
const scalar = <T>(check: (v: unknown) => v is T, label: string): Schema<T> => ({ read: (v,p) => check(v) ? v : fail(p,label) });
const string = scalar((v): v is string => typeof v === 'string', 'expected string');
const text = scalar((v): v is string => typeof v === 'string' && v.trim().length > 0, 'expected nonempty string');
const boolean = scalar((v): v is boolean => typeof v === 'boolean', 'expected boolean');
const number = scalar((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0, 'expected nonnegative finite number');
const integer = scalar((v): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0, 'expected nonnegative integer');
const date = scalar((v): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\d(?:T.*(?:Z|[+-]\d\d:\d\d))?$/.test(v) && Number.isFinite(Date.parse(v)), 'expected dated timestamp');
const hash = scalar((v): v is string => typeof v === 'string' && /^(?:sha256:)?[0-9a-f]{64}$/.test(v), 'expected SHA-256 hash');
const id = scalar((v): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v), 'expected safe record ID');
const enumeration = <T extends string | number>(...values: T[]): Schema<T> => ({ read: (v,p) => values.some(x => x === v) ? v as T : fail(p,`expected ${values.join('|')}`) });
const array = <T>(s: Schema<T>): Schema<T[]> => ({ read: (v,p) => Array.isArray(v) ? v.map((x,i) => s.read(x,`${p}[${i}]`)) : fail(p,'expected array') });
const nullable = <T>(s: Schema<T>): Schema<T | null> => ({ read: (v,p) => v === null ? null : s.read(v,p) });
const optional = <T>(s: Schema<T>): Schema<T | undefined> => ({ read: (v,p) => v === undefined ? undefined : s.read(v,p) });
function object<S extends Record<string, Schema<unknown>>>(shape: S): Schema<{ [K in keyof S]: Value<S[K]> }> {
  return { read(v,p) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return fail(p,'expected object');
    const source = v as Record<string,unknown>;
    for (const k of Object.keys(source)) if (!Object.hasOwn(shape,k)) fail(`${p}.${k}`,'unknown field');
    const parsed: Record<string,unknown> = {};
    for (const [k,s] of Object.entries(shape)) { const x = s.read(source[k],`${p}.${k}`); if (x !== undefined) parsed[k] = x; }
    return parsed as { [K in keyof S]: Value<S[K]> };
  } };
}
const unique = <T>(s: Schema<T[]>): Schema<T[]> => ({read(v,p) { const xs=s.read(v,p); if(new Set(xs.map(x=>JSON.stringify(x))).size!==xs.length) fail(p,'duplicate entries'); return xs; }});
const strings = unique(array(text));
const role = enumeration('qa','developer');
const track = enumeration('regression','addendum');
const layer = enumeration('served','synthetic');
const lane = enumeration('governed','legacy','visual','excluded');
const path = scalar((v): v is string => typeof v === 'string' && v.length > 0 && !isAbsolute(v) && !v.split(/[\\/]/).includes('..') && !v.includes('\0'), 'expected checkout-relative path');
const viewport = nullable(object({width:integer,height:integer}));
const signed = {id,by:text,role,standIn:boolean,at:date,reason:text};
const approval = object({by:text,role,standIn:boolean,on:date,hash});
const testIdentity = object({suite:id,file:path,titlePath:array(text)});
const obligation = object({case:id,step:id,obligation:id});
const ledgerRef = object({path,sha256:hash});
const environment = object({id,kind:enumeration('local-candidate','deployed'),baseUrl:text});
const configuration = object({id:text,project:text,viewport,role:text});
const classification = object({...signed,target:object({suite:id,project:optional(text),glob:optional(text)}),from:nullable(lane),to:lane});
// Optional property schemas are assigned after decoding so exactOptionalPropertyTypes stays honest.
export function parseProfile(value: unknown): Profile {
  const v=object({schema:enumeration(1),project:text,regression:strings,baseBranch:text,remote:text,maxBaseRefAgeHours:number,
    roles:object({qa:array(object({name:text,standIn:boolean}))}),roleDefinitions:array(object({name:text,setupProject:text,storageState:path})),
    configurations:array(configuration),suites:array(object({id,config:path,declaredEnvironmentInputs:optional(array(object({name:text,classification:enumeration('nonsecret'),readers:strings})))})),
    classification:array(classification),environments:array(object({id,kind:enumeration('local-candidate','deployed'),baseUrl:text,baseUrlEnv:text})),
    fixtures:array(object({id,environments:strings,path:text,title:text,structure:nullable(text)})),
    declaredInputs:array(object({reader:text,paths:strings,read:optional(integer)})),declaredBaselines:strings,generatedAssets:array(path),knownConfigOverrides:strings,
    quarantineCap:integer,materialFields:unique(array(enumeration('browserName','browserVersion','channel','headless','retries'))),secretOptions:strings,maxSnapshotAgeHours:number,allowedHosts:strings,
  }).read(value,'profile');
  const profile: Profile = {...v,
    suites:v.suites.map(s=>({id:s.id,config:s.config,...(s.declaredEnvironmentInputs===undefined?{}:{declaredEnvironmentInputs:s.declaredEnvironmentInputs})})),
    classification:v.classification.map(c=>({...c,target:{suite:c.target.suite,...(c.target.project===undefined?{}:{project:c.target.project}),...(c.target.glob===undefined?{}:{glob:c.target.glob})}})),
    declaredInputs:v.declaredInputs.map(d=>({reader:d.reader,paths:d.paths,...(d.read===undefined?{}:{read:d.read})})),
  };
  const problems=configurationProblems(profile.configurations);
  for(const [name,xs] of [['suite',v.suites],['configuration',v.configurations],['environment',v.environments],['fixture',v.fixtures],['classification',v.classification]] as const)
    if(new Set(xs.map(x=>x.id)).size!==xs.length) problems.push(`duplicate ${name} ID`);
  for(const s of profile.suites) problems.push(...declarationProblems(s.declaredEnvironmentInputs??[]));
  if(new Set(profile.roles.qa.map(p=>p.name)).size!==profile.roles.qa.length)problems.push('duplicate QA identity');
  if(new Set(profile.roleDefinitions.map(r=>r.name)).size!==profile.roleDefinitions.length)problems.push('duplicate browser role definition');
  for(const e of profile.environments) {
    try {const u=new URL(e.baseUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password) throw new Error();}catch{problems.push(`invalid environment URL ${e.id}`);}
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.baseUrlEnv)) problems.push(`invalid base URL variable ${e.id}`);
  }
  if(problems.length) fail('profile',problems.join('; '));
  return profile;
}
const caseSchema = object({id,aliases:strings,track,title:text,preconditions:string,
  steps:array(object({id,text:text,obligations:array(object({id,text:text,layer}))})),priority:text,configurations:strings,refs:strings,fixture:nullable(id),configurationDependent:boolean,
  sourcePolicy:optional(object({association:nullable(object({source:enumeration('testrail'),project:integer,suite:integer,case:integer})),reason:text})),
  provenance:object({draftedFrom:enumeration('ticket','coverage-map','test-plan','existing-test','testrail'),independentRefs:strings,selfDerivedAcceptedBy:nullable(approval)}),approval:nullable(approval)});
export function parseCase(v:unknown):CaseRecord {
  const decoded=caseSchema.read(v,'case');const {sourcePolicy,...rest}=decoded;
  const c:CaseRecord={...rest,...(sourcePolicy===undefined?{}:{sourcePolicy})};
  if(sourcePolicy?.association&&[sourcePolicy.association.project,sourcePolicy.association.suite,sourcePolicy.association.case].some(id=>id<1))fail('case.sourcePolicy','source identities must be positive');
  if(c.provenance.draftedFrom!=='existing-test'&&c.provenance.independentRefs.length===0)fail('case.provenance','independent source needs an explicit reference');
  return c;
}
export const parseTransition = (v:unknown):Transition => object({...signed,kind:enumeration('approval','scope','graduation','reconcile'),baseCommit:text,setBefore:hash,setAfter:hash,
  delta:array(object({case:id,before:text,after:text})),supersedes:strings}).read(v,'transition');
const mapping: Schema<Mapping> = object({obligation,test:testIdentity,configuration:text,layer});
const ledgerSchema = object({schema:enumeration(1),mappings:array(mapping)});
const dispositionsSchema = object({schema:enumeration(1),records:array({read(v,p):Disposition {
  const kind=v!==null&&typeof v==='object'&&!Array.isArray(v)?Reflect.get(v,'kind'):null;
  switch(kind) {
    case 'quarantine':return object({...signed,kind:enumeration('quarantine'),test:testIdentity,owner:text,ticket:text,expires:date}).read(v,p);
    case 'risk-acceptance':return object({...signed,kind:enumeration('risk-acceptance'),test:testIdentity,project:text,signature:hash,owner:text,expires:date}).read(v,p);
    case 'sensitivity-waived':return object({...signed,kind:enumeration('sensitivity-waived'),case:id,step:id,obligation:id,caseHash:hash}).read(v,p);
    case 'graduation':return object({...signed,kind:enumeration('graduation'),case:id,decision:enumeration('proposed','graduated','kept-out')}).read(v,p);
    default:return fail(p,'unsupported disposition');
  }
}})});
export function parseEvidence(v:unknown):EvidenceRecord {
  const kind=v!==null&&typeof v==='object'&&!Array.isArray(v)?Reflect.get(v,'kind'):null;
  const bound={id,environment,test:testIdentity,configuration:text,behaviorDigest:hash,toolchainDigest:hash,appliesTo:strings,at:date};
  switch(kind) {
    case 'red-check':return object({...bound,kind:enumeration('red-check'),obligation,recipeHash:hash,mutated:ledgerRef,restored:ledgerRef}).read(v,'evidence');
    case 'burn-in':return object({...bound,kind:enumeration('burn-in'),run:ledgerRef}).read(v,'evidence');
    case 'acceptance':return object({kind:enumeration('acceptance'),id,test:testIdentity,case:id,caseHash:hash,behaviorDigest:hash,by:text,role,standIn:boolean,at:date}).read(v,'evidence');
    default:return fail('evidence','unsupported record');
  }
}
export type LocalContract = {schema:1;applicationBase:{remote:string;branch:string;maxAgeHours:number};healthPath:string;actorProbe:{path:string;roleField:string};database:{source:string|null;pulledAt:string|null}};
export function parseLocal(v:unknown):LocalContract { return object({schema:enumeration(1),applicationBase:object({remote:text,branch:text,maxAgeHours:number}),healthPath:path,actorProbe:object({path,roleField:enumeration('role')}),database:object({source:nullable(text),pulledAt:nullable(date)})}).read(v,'local'); }
export type Recipe = {format:1;test:Value<typeof testIdentity>;obligation:Value<typeof obligation>;hypothesis:string;technique:string;[key:string]:unknown};
export function parseRecipe(v:unknown):Recipe {
  if(v===null||typeof v!=='object'||Array.isArray(v))return fail('recipe','expected object');
  const x=v as Record<string,unknown>;
  // Technique payload is data for a later replay adapter; this coordinator never executes it.
  return {...x,format:enumeration(1).read(x['format'],'recipe.format'),test:testIdentity.read(x['test'],'recipe.test'),obligation:obligation.read(x['obligation'],'recipe.obligation'),hypothesis:text.read(x['hypothesis'],'recipe.hypothesis'),technique:text.read(x['technique'],'recipe.technique')};
}
export function parseSourceIndex(v:unknown) {
  const index=object({schema:enumeration(1),snapshot:path,cases:array(object({case:id,sourceCase:integer,suite:integer,rawHash:hash,caseHash:hash,approval}))}).read(v,'source');
  if(new Set(index.cases.map(c=>c.case)).size!==index.cases.length)fail('source.cases','duplicate case binding');
  return index;
}
/** The owner approves this source-to-interpretation binding, in addition to the canonical case. */
export function sourceBindingHash(project:number,binding:{case:string;sourceCase:number;suite:number;rawHash:string;caseHash:string}):string {
  return hashOf({project,case:binding.case,sourceCase:binding.sourceCase,suite:binding.suite,rawHash:binding.rawHash,caseHash:binding.caseHash});
}
export function readJson(file:string):unknown {return JSON.parse(readFileSync(file,'utf8')) as unknown;}
export function inside(root:string,path:string):string {
  const target=resolve(root,path);let ancestor=target;
  while(!existsSync(ancestor)&&dirname(ancestor)!==ancestor)ancestor=dirname(ancestor);
  const canonical=resolve(realpathSync(ancestor),relative(ancestor,target));const rel=relative(realpathSync(root),canonical);
  if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw new Error(`${path} leaves selected root ${root}`);
  return canonical;
}
export type Persisted = {profile:Profile;local:LocalContract;cases:Map<string,CaseRecord>;ledger:Mapping[];dispositions:Disposition[];evidence:EvidenceRecord[];evidenceProblems:string[];recipes:{hash:string;test:Value<typeof testIdentity>}[];files:{path:string;hash:string}[]};
export function loadPersisted(root:string):Persisted {
  const files:{path:string;hash:string}[]=[];
  const read=(path:string) => {const f=inside(root,path);files.push({path,hash:sha256(readFileSync(f))});return readJson(f);};
  const profile=parseProfile(read('.test-lab/profile.json'));const local=parseLocal(read('.test-lab/local.json'));
  const cases=new Map<string,CaseRecord>();
  for(const track of ['regression','addendum','drafts']) {
    const dir=inside(root,`.test-lab/cases/${track}`);if(!existsSync(dir))throw new Error(`missing corpus folder ${dir}`);
    for(const name of readdirSync(dir).filter(n=>n.endsWith('.json')).sort()) {
      const c=parseCase(read(`.test-lab/cases/${track}/${name}`));
      if(name!==`${c.id}.json`||(track!=='drafts'&&c.track!==track))throw new Error(`case path/identity mismatch ${name}`);
      if(track==='drafts'&&c.approval!==null)throw new Error(`approved case ${c.id} must leave the drafts folder`);
      if(cases.has(c.id))throw new Error(`duplicate corpus case ${c.id}`);cases.set(c.id,c);
    }
  }
  const ledger=ledgerSchema.read(read('.test-lab/ledger.json'),'ledger').mappings;
  const dispositions=dispositionsSchema.read(read('.test-lab/dispositions.json'),'dispositions').records;
  const recipes:Persisted['recipes']=[];
  const recipeDir=inside(root,'.test-lab/recipes');if(!existsSync(recipeDir))throw new Error('missing recipes folder');
  for(const name of readdirSync(recipeDir).filter(n=>n.endsWith('.json')).sort()) {
    const path=`.test-lab/recipes/${name}`;const recipe=parseRecipe(read(path));const hash=sha256(readFileSync(inside(root,path)));
    if(name!==`${hash}.json`)throw new Error(`recipe content/name mismatch ${name}`);recipes.push({hash:`sha256:${hash}`,test:recipe.test});
  }
  const evidence:EvidenceRecord[]=[];const evidenceProblems:string[]=[];const dir=inside(root,'.test-lab/evidence');
  if(!existsSync(dir))evidenceProblems.push('no evidence folder');else for(const name of readdirSync(dir,{recursive:true,encoding:'utf8'}).filter(n=>n.endsWith('.json')).sort()) {
    try{evidence.push(parseEvidence(read(`.test-lab/evidence/${name}`)));}catch(e){evidenceProblems.push(`${name}: ${String(e)}`);}
  }
  if(new Set(evidence.map(e=>e.id)).size!==evidence.length)throw new Error('duplicate evidence ID');
  if(new Set(dispositions.map(d=>d.id)).size!==dispositions.length)throw new Error('duplicate disposition ID');
  // Freeze scope history, source metadata and raw receipts too. They are outputs for behavior hashing,
  // but changes during an operation must not substitute a different approval/evidence denominator.
  const retained=new Set(files.map(f=>f.path));
  for(const folder of ['work','transitions','evidence','sources']) {
    const dir=inside(root,`.test-lab/${folder}`);if(!existsSync(dir))continue;
    for(const name of readdirSync(dir,{recursive:true,encoding:'utf8'}).filter(n=>/\.(?:json|jsonl)$/.test(n)).sort()) {
      const path=`.test-lab/${folder}/${name}`;if(!retained.has(path))files.push({path,hash:sha256(readFileSync(inside(root,path)))});
    }
  }
  if(existsSync(inside(root,'.test-lab/source.json'))) {
    read('.test-lab/source.json');const index=parseSourceIndex(readJson(inside(root,'.test-lab/source.json')));
    const path=`.test-lab/${index.snapshot}`;if(!retained.has(path))files.push({path,hash:sha256(readFileSync(inside(root,path)))});
  }
  files.sort((a,b)=>a.path.localeCompare(b.path));
  return {profile,local,cases,ledger,dispositions,evidence,evidenceProblems,recipes,files};
}
