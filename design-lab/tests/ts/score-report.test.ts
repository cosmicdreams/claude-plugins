import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {sharedRequire} from '../../src/runtime.ts';
import {esc,num,pct,duration,split_duration,day,coverage_strip,field,thumbnails,absent} from '../../src/score-report.ts';
const sharp=sharedRequire()('sharp') as typeof import('sharp').default;
test('report escapes source labels and keeps Python numeric/time formatting',()=>{
 assert.equal(esc('<a "x">&\''),'&lt;a &quot;x&quot;&gt;&amp;&#x27;');assert.equal(esc(null),'');
 assert.equal(num(1234.25),'1,234.2');assert.equal(num(1234),'1,234');assert.equal(pct(.005),'0%');
 assert.equal(duration(3750),'1 h 2 min');assert.deepEqual(split_duration(3750),['1',' h 2 min']);
 assert.equal(day('2026-10-05T00:30:00+14:00'),'5 October 2026');assert.equal(day(null),'date not recorded');
});
test('coverage keeps cover category colors, gaps, exclusions and outside-inventory disclosure',()=>{
 const html=coverage_strip({status:'measured',built:2,coverBreakdown:[{tier:'High Use',built:2}],gap:{failed:1},excluded:{retirement:2},reasonLabels:{failed:'planned but not built',retirement:'retirement candidate'},items:[{label:'Lost <button>',reason:'failed'},{label:'Old',reason:'retirement'}],usageWeighted:{covered:3,placements:6,ratio:.5,structuralCovered:4,structuralRefs:8},outsideInventory:[{placements:2,structural:1}],summary:'summary'});
 assert.equal((html.match(/data-tier="High Use"/g)??[]).length,2);assert.match(html,/#FAD200/);assert.match(html,/Lost &lt;button&gt;/);assert.match(html,/c-out c-retire/);assert.match(html,/2 retirement candidates/);assert.match(html,/outside the inventory \(2 placements, 1 nested use\)/);
});
test('accuracy field orders passing widths first and preserves accessible verdicts',()=>{
 const pair=(id:string,pass:boolean,ratio:number)=>({component:id,label:id,breakpoint:'desktop',width:1200,original:{pass,ratio},corrected:{pass,ratio},heightDelta:0});
 const html=field({pairs:[pair('worse',false,.5),pair('best',true,.01)],threshold:.05,byBreakpoint:{desktop:{corrected:{pass:1,total:2,medianRatio:.255}}}});
 assert.ok(html.indexOf('best ·')<html.indexOf('worse ·'));assert.match(html,/y="19.0"/);assert.match(html,/aria-labelledby="field-t field-d"/);assert.match(html,/f-check/);
 assert.match(absent('Absent',{reason:'No <evidence>',howToMeasure:'capture again'}),/No &lt;evidence&gt;/);
});
test('thumbnail crop pads out-of-bounds black and flattens transparency onto white',async()=>{
 const run=mkdtempSync(resolve(tmpdir(),'design-lab-report-test-'));mkdirSync(resolve(run,'figma'));
 await sharp(Buffer.from([0,0,0,0,255,0,0,255]),{raw:{width:2,height:1,channels:4}}).png().toFile(resolve(run,'figma/specimen.png'));
 writeFileSync(resolve(run,'figma/geometry.json'),JSON.stringify({geometry:{variants:[{x:-1,y:0,width:2,height:1}],captures:[{x:0,y:0,width:1,height:1}]}}));
 const result=await thumbnails(run,[{component:'button',breakpoint:'desktop',evidence:{specimen:'figma/specimen.png',geometry:'figma/geometry.json',index:0}}],'desktop');
 const shot=result.button!.live!;assert.equal(shot.w,1);assert.equal(shot.h,1);assert.equal(shot.cropped,false);
 const decoded=await sharp(Buffer.from(shot.src.split(',')[1]!,'base64')).removeAlpha().raw().toBuffer();assert.deepEqual([...decoded],[255,255,255]);
 const padding=result.button!.figma!;assert.equal(padding.w,2);
});
