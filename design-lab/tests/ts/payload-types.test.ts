import test from 'node:test';
import assert from 'node:assert/strict';
import {callPayload} from '../../src/render-payload.ts';
import {compact} from '../../src/spec-to-tree.ts';
import type {TemplateArgs, RenderTree} from '../../src/figma/payload-types.ts';
function compileOnly() {
 // @ts-expect-error a typo cannot enter the payload seam
 callPayload('build_responisve', {});
 // @ts-expect-error the build template requires its declared fields
 callPayload('build_responsive', {pageId:'p'});
 // @ts-expect-error args for a different template are rejected
 callPayload('pages', {collections:[]});
 // @ts-expect-error optional fields must be absent rather than undefined
 const cover:TemplateArgs['cover'] = {pageId:'p',ground:'#fff',headline:'h',subtitle:undefined};
 // @ts-expect-error compact text needs both its style index and characters
 const tree:RenderTree = {kind:'text',name:'t',source:'/t',sizing:'HUG',ts:0};
 void cover; void tree;
}
void compileOnly;
test('compact payload preserves variable padding, shared styles and the text discriminant', () => {
 const compacted=compact({kind:'frame',name:'root',source:'/root',sizing:'FIXED',layout:{mode:'VERTICAL',padding:{top:{var:'space'},right:2}},children:[{kind:'text',name:'t',source:'/t',sizing:'HUG',text:{characters:'Hello',family:'Inter',weight:400,size:16}}]});
 assert.deepEqual(compacted.tree.layout?.pad,[{var:'space'},2,0,0]);
 assert.deepEqual(compacted.tree.children?.[0],{kind:'text',name:'t',source:'/t',sizing:'HUG',chars:'Hello',ts:0});
 assert.deepEqual(compacted.styles,[{family:'Inter',weight:400,size:16}]);
});
test('every dump name is available through the typed renderer seam',()=>{
 for(const name of ['figma_dump_root','figma_dump_tree','figma_dump_page','figma_dump_getting_started'] as const) {
  const code=callPayload(name,{});
  assert.ok(code.startsWith('const ARGS = {};'));
  assert.doesNotMatch(code,/^import /m);
  assert.ok(code.includes('DL_API'));
 }
});
