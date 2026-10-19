// Source eligibility comes from immutable upstream associations or canonical owner policy.
// A provenance label is a drafting aid; it cannot remove a source's freshness obligation.
import { canonicalJson } from './canonical.ts';
import { caseValue } from './case-file.ts';
import { approvalProblem } from './cases.ts';
import { ownerRoleHolds } from './dispositions.ts';
import { git } from './git.ts';
import type { CaseRecord, Roles, SourceAssociation } from './model.ts';
import { parseCase, parseSourceIndex, sourceBindingHash } from './persistence.ts';
import { validateSnapshot } from './source.ts';
export type TrustedAssociations = Map<string,SourceAssociation|null>;
export async function trustedSourceAssociations(root:string,commit:string,regression:Map<string,CaseRecord>,roles:Roles):Promise<TrustedAssociations> {
  const records=new Map(regression);
  const files=await git(root,['ls-tree','-r','--name-only',commit,'--','.test-lab/cases/addendum']);
  for(const path of files.stdout.trim().split('\n').filter(p=>/\.(json|md)$/.test(p))) {
    const record=parseCase(caseValue(path,(await git(root,['show',`${commit}:${path}`])).stdout));records.set(record.id,record);
  }
  const associations:TrustedAssociations=new Map();
  for(const c of records.values()) {
    if(approvalProblem(c,roles)!==null)continue; // Unapproved addenda cannot establish trusted associations.
    if(c.sourcePolicy!==undefined){if(c.sourcePolicy.association!==null)associations.set(c.id,c.sourcePolicy.association);continue;}
    if(c.provenance.draftedFrom==='testrail') {
      const refs=c.provenance.independentRefs.map(r=>/^testrail:project:(\d+):suite:(\d+):case:(\d+)$/.exec(r)).filter(r=>r!==null);
      const r=refs.length===1?refs[0]:undefined;
      associations.set(c.id,r?{source:'testrail',project:Number(r[1]),suite:Number(r[2]),case:Number(r[3])}:null);
    }
  }
  const indexText=await git(root,['show',`${commit}:.test-lab/source.json`],{allowFail:true});
  if(indexText.ok) {
    const index=parseSourceIndex(JSON.parse(indexText.stdout));
    const snapshot=validateSnapshot(JSON.parse((await git(root,['show',`${commit}:.test-lab/${index.snapshot}`])).stdout));
    for(const binding of index.cases) {
      const c=records.get(binding.case);if(c===undefined||c.sourcePolicy!==undefined)continue;
      if(binding.caseHash!==c.approval?.hash||binding.approval.hash!==sourceBindingHash(snapshot.project,binding)||ownerRoleHolds(roles,c.track,binding.approval)!==null)throw new Error(`trusted source provenance for ${binding.case} has no valid interpretation approval`);
      const association:SourceAssociation={source:'testrail',project:snapshot.project,suite:binding.suite,case:binding.sourceCase};
      if(associations.get(c.id)&&canonicalJson(associations.get(c.id))!==canonicalJson(association))throw new Error(`trusted source associations disagree for ${c.id}; owner migration required`);
      associations.set(c.id,association);
    }
  }
  return associations;
}
/** Current signed bindings cannot be detached by removing a mutable label or reference. */
export function requiredSourceAssociations(required:Set<string>,cases:Map<string,CaseRecord>,trusted:TrustedAssociations,index:ReturnType<typeof parseSourceIndex>|null):{associations:TrustedAssociations;problems:string[]} {
  const associations:TrustedAssociations=new Map(),problems:string[]=[];
  for(const id of required) {
    const c=cases.get(id);if(c===undefined)continue;
    if(c.sourcePolicy!==undefined) {if(c.sourcePolicy.association!==null)associations.set(id,c.sourcePolicy.association);continue;}
    if(trusted.has(id)){associations.set(id,trusted.get(id)!);continue;}
    if(index?.cases.some(b=>b.case===id)||c.provenance.draftedFrom==='testrail') {
      associations.set(id,null);
      problems.push(`source provenance for ${id} needs an explicit owner-approved sourcePolicy migration (and QA transition for regression); legacy approval cannot authorize a new association`);
    }
  }
  return {associations,problems};
}
