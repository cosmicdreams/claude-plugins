/** Cross-field acceptance rules also inspect structurally invalid input without trusting it. */
import type { ArtifactKind } from './contracts.ts';
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const rows=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
export function policyErrors(kind:ArtifactKind,value:unknown):string[]{
 const doc=object(value),errors:string[]=[];
 const unique=(values:unknown,label:string)=>{const ids=new Set<unknown>();for(const value of rows(values)){const id=object(value)['id'];if(id){if(ids.has(id))errors.push(`${label}: duplicate id ${String(id)}`);ids.add(id);}}};
 if(kind==='components')unique(doc['components'],'components');
 if(kind==='plan')unique(doc['plans'],'plans');
 if(kind==='index'){unique(doc['rows'],'index rows');const total=object(doc['totals'])['components'];if(Number.isInteger(total)&&total!==rows(doc['rows']).length)errors.push('totals.components must equal the number of rows');}
 if(kind==='capture-evidence')for(const [id,value] of Object.entries(object(doc['captures'])))if(String(object(value)['linkUrl']??'').includes('.ddev.site'))errors.push(`captures[${id}].linkUrl must not use a DDEV hostname`);
 if(kind==='foundation'&&rows(object(doc['validation'])['errors']).length)errors.push('validation.errors must be empty');
 if(kind==='build-record'){const comparison=object(object(doc['visualEvidence'])['comparison']),breakpoints=object(comparison['breakpoints']);if(comparison['verdict']==='pass'&&['desktop','tablet','mobile'].some(name=>breakpoints[name]!=='pass'))errors.push('a passing comparison must pass all three breakpoints');}
 return errors;
}
