// Genuine seeded mutation/restoration and five repeats. No persisted verification conclusion.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { setupCoordinator } from './coordinator.ts';
import { writeJson } from './coordinator.ts';
import type { CoordinatorResult } from '../../src/coordinator.ts';
import { execute, planSuite, probeInvocation } from '../../src/run-plan.ts';
import { readInvocation } from '../../src/run-observation.ts';
import { effectiveClassification } from '../../src/dispositions.ts';
import { behaviorKey } from '../../src/digest.ts';
import { sha256 } from '../../src/canonical.ts';
import { acceptance } from '../ts/support.ts';
/** `mark` names each stage as it ends, for tests that time certification apart from what follows it. */
export async function certifyCoordinator(f:Awaited<ReturnType<typeof setupCoordinator>>,invoke:()=>Promise<CoordinatorResult>,mark:(stage:string)=>void=()=>{}):Promise<void> {
  const initial=await invoke();mark('certify: initial coordinate');assert.equal(initial.verdict.rule,7,initial.summary);
  const manifest=JSON.parse(readFileSync(join(initial.runDir,'manifest.json'),'utf8'));
  const digests=manifest.observations.at(-1).suites[0].afterDigests;
  const behavior=digests.behavior.find(([key]:[string,unknown])=>key===behaviorKey(f.test,'desktop'))[1];assert.equal(behavior.status,'resolved');
  const evidence=join(f.suite,'.test-lab/evidence');mkdirSync(join(evidence,'ledgers'),{recursive:true});
  const keep=(dir:string,name:string)=>{const to=join(evidence,'ledgers',name);copyFileSync(join(dir,'steps.jsonl'),to);return {path:`ledgers/${name}`,sha256:sha256(readFileSync(to))};};
  const rules=effectiveClassification(f.profile.classification,f.profile.roles,f.profile.classification).rules;
  const run=async(name:string,repeat=false)=>{
    const input={suite:'e2e',config:join(f.suite,'playwright.config.ts'),rules,environment:f.profile.environments[0]!,runDir:join(f.suite,'.test-lab/runs',name),reporter:join(f.suite,'support/test-lab/reporter.ts'),projects:['desktop'],secretOptions:[],declaredEnvironmentInputs:f.profile.suites[0]!.declaredEnvironmentInputs!,environmentValues:{},selectedFiles:['tests/home.spec.ts'],extraArgs:['--grep','(?:^|\\s)heading$',...(repeat?['--repeat-each','5','--fail-on-flaky-tests']:[])]};
    const probe=probeInvocation(input);await execute(probe);const observed=readInvocation(probe);assert.ok(observed.begin);const planned=planSuite(input,observed.begin);assert.ok(planned.ok);await execute(planned.invocation);return planned.invocation.dir;
  };
  f.state.mutant=true;let mutant:string;try{mutant=await run('source-mutant');}finally{f.state.mutant=false;}mark('certify: mutant');
  const restored=await run('source-restored');mark('certify: restored');const burn=await run('source-burn',true);mark('certify: burn-in');
  const binding={environment:{id:'local',kind:'local-candidate',baseUrl:f.url},behaviorDigest:behavior.digest,toolchainDigest:digests.toolchain.digest,configuration:'desktop@1440',test:f.test,appliesTo:[],at:new Date().toISOString()};
  writeJson(join(evidence,'red.json'),{...binding,kind:'red-check',id:'red',obligation:f.obligation,recipeHash:f.recipeHash,mutated:keep(mutant,'source-mutant.jsonl'),restored:keep(restored,'source-restored.jsonl')});
  writeJson(join(evidence,'burn.json'),{...binding,kind:'burn-in',id:'burn',run:keep(burn,'source-burn.jsonl')});
  writeJson(join(evidence,'acceptance.json'),acceptance(f.record,f.test,{behaviorDigest:behavior.digest,at:new Date().toISOString()}));
}
