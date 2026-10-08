import {Script,createContext} from 'node:vm';
import {assertNever} from '../../src/assert-never.ts';
/** Exact reviewed substitutions, followed by the existing complete executable AST check.
 * No wildcard removal: every changed function is pinned literally and must occur once. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pluginRoot } from '../../src/runtime.ts';
interface Edit {current:string;previous:string}
export const reviewedSeams = JSON.parse(readFileSync(resolve(pluginRoot,'tests/fixtures/typed-seams-reviewed-diff.json'),'utf8')) as {helper:Edit;responsive:Edit[];runner:Edit[]};
export function restoreSeams(source:string, surface:'responsive'|'runner'):string {
  for (const edit of [reviewedSeams.helper,...reviewedSeams[surface]]) {
    assert.ok(edit.current && source.includes(edit.current), `reviewed ${surface} seam is present exactly: ${edit.current.slice(0,80)}`);
    assert.equal(source.indexOf(edit.current),source.lastIndexOf(edit.current),'reviewed seam is unambiguous');
    source=source.replace(edit.current,edit.previous);
  }
  return source;
}

/** Execute the old and new expansion walks on each real payload's JSON arguments. */
export function assertExpansionParity(args:unknown):void {
 const execute=(code:string,guard:string)=>{
  const context=createContext({ARGS:structuredClone(args),assertNever});
  new Script(code+guard+`
if(ARGS.styles) expand(ARGS.tree);
for(const alt of ARGS.alternates || []) expand(alt.tree,alt.styles);
`
    +(guard ? `assertExpanded(ARGS.tree); for(const alt of ARGS.alternates || []) assertExpanded(alt.tree);` : '')).runInContext(context);
  return JSON.parse(JSON.stringify(context['ARGS']));
 };
 const expand=reviewedSeams.responsive[0]!,guard=reviewedSeams.responsive[1]!;
 assert.deepEqual(execute(expand.current,guard.current),execute(expand.previous,''),'expanded arguments preserve their exact JSON values');
}
