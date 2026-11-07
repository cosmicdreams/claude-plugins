// One operation value per selected name; readers and projections remain local to each suite.
import { declarationProblems, valueProblems, type EnvironmentInputDeclaration, type EnvironmentInputValue } from '../kit/environment-inputs.ts';
import type { EnvironmentDef, SuiteDef } from './model.ts';
export function operationInputs(suites:SuiteDef[],environment:EnvironmentDef,values:Record<string,EnvironmentInputValue>):{projections:Map<string,Record<string,EnvironmentInputValue>>;problems:string[]} {
  const problems:string[]=[],declarations=new Map<string,EnvironmentInputDeclaration>();
  for(const suite of suites) {
    problems.push(...declarationProblems(suite.declaredEnvironmentInputs??[]).map(p=>`suite ${suite.id}: ${p}`));
    for(const d of suite.declaredEnvironmentInputs??[]) {
      const prior=declarations.get(d.name);
      if(prior&&prior.classification!==d.classification)problems.push(`conflicting selected-suite input declaration ${d.name}`);
      else if(!prior)declarations.set(d.name,d);
    }
  }
  const supplied={...values};
  if(declarations.has(environment.baseUrlEnv)) {
    const owned=supplied[environment.baseUrlEnv];
    if(owned!==undefined&&(owned.state!=='set'||owned.value!==environment.baseUrl))problems.push(`input ${environment.baseUrlEnv} is planner-owned and conflicts with the selected target`);
    supplied[environment.baseUrlEnv]={state:'set',value:environment.baseUrl};
  }
  problems.push(...valueProblems([...declarations.values()],supplied));
  const projections=new Map<string,Record<string,EnvironmentInputValue>>();
  if(problems.length===0)for(const suite of suites)projections.set(suite.id,Object.fromEntries((suite.declaredEnvironmentInputs??[]).map(d=>[d.name,supplied[d.name]!])));
  return {projections,problems};
}
