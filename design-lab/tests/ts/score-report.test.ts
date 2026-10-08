import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {sharedRequire} from '../../src/runtime.ts';
import {coverageStrip,field,thumbnails,absent,costSection,renderReport,type ReportCard} from '../../src/score-report.ts';
import {esc,num,pct,duration,splitDuration,day} from '../../src/report-format.ts';
const sharp=sharedRequire()('sharp') as typeof import('sharp').default;
test('report escapes source labels and keeps baseline numeric/time formatting',()=>{
 assert.equal(esc('<a "x">&\''),'&lt;a &quot;x&quot;&gt;&amp;&#x27;');assert.equal(esc(null),'');
 assert.equal(num(1234.25),'1,234.2');assert.equal(num(1234),'1,234');assert.equal(pct(.005),'0%');
 assert.equal(duration(3750),'1 h 2 min');assert.deepEqual(splitDuration(3750),['1',' h 2 min']);
 assert.equal(day('2026-10-05T00:30:00+14:00'),'5 October 2026');assert.equal(day(null),'date not recorded');
});
test('coverage keeps cover category colors, gaps, exclusions and outside-inventory disclosure',()=>{
 const html=coverageStrip({status:'measured',built:2,coverBreakdown:[{tier:'High Use',built:2}],gap:{failed:1},excluded:{retirement:2},reasonLabels:{failed:'planned but not built',retirement:'retirement candidate'},items:[{label:'Lost <button>',reason:'failed'},{label:'Old',reason:'retirement'}],usageWeighted:{covered:3,placements:6,ratio:.5,structuralCovered:4,structuralRefs:8},outsideInventory:[{placements:2,structural:1}],summary:'summary'});
 assert.equal((html.match(/data-tier="High Use"/g)??[]).length,2);assert.match(html,/#FAD200/);assert.match(html,/Lost &lt;button&gt;/);assert.match(html,/c-out c-retire/);assert.match(html,/2 retirement candidates/);assert.match(html,/outside the inventory \(2 placements, 1 nested use\)/);
});
test('accuracy field orders passing widths first and preserves accessible verdicts',()=>{
 const pair=(id:string,pass:boolean,ratio:number)=>({component:id,label:id,breakpoint:'desktop',width:1200,original:{pass,ratio},corrected:{pass,ratio},heightDelta:0});
 const html=field({status:'measured',pairs:[pair('worse',false,.5),pair('best',true,.01)],threshold:.05,byBreakpoint:{desktop:{corrected:{pass:1,total:2,medianRatio:.255}}}});
 assert.ok(html.indexOf('best ·')<html.indexOf('worse ·'));assert.match(html,/y="19.0"/);assert.match(html,/aria-labelledby="field-t field-d"/);assert.match(html,/f-check/);
 assert.match(absent('Absent',{reason:'No <evidence>',howToMeasure:'capture again'}),/No &lt;evidence&gt;/);
});
test('thumbnail crop pads out-of-bounds black and flattens transparency onto white',async()=>{
 const run=mkdtempSync(resolve(tmpdir(),'design-lab-report-test-'));mkdirSync(resolve(run,'figma'));
 await sharp(Buffer.from([0,0,0,0,255,0,0,255]),{raw:{width:2,height:1,channels:4}}).png().toFile(resolve(run,'figma/specimen.png'));
 writeFileSync(resolve(run,'figma/geometry.json'),JSON.stringify({geometry:{variants:[{x:-1,y:0,width:2,height:1}],captures:[{x:0,y:0,width:1,height:1}]}}));
 const result=await thumbnails(run,[{component:'button',breakpoint:'desktop',original:{ratio:0,pass:true},evidence:{specimen:'figma/specimen.png',geometry:'figma/geometry.json',index:0}}],'desktop');
 const shot=result.get('button')?.live;assert.ok(shot);assert.equal(shot.w,1);assert.equal(shot.h,1);assert.equal(shot.cropped,false);
 const decoded=await sharp(Buffer.from(shot.src.split(',')[1]!,'base64')).removeAlpha().raw().toBuffer();assert.deepEqual([...decoded],[255,255,255]);
 assert.equal(result.get('button')?.figma?.w,2);rmSync(run,{recursive:true,force:true});
});


test('cost report discloses ambiguous sessions, approval limits and genuine interruptions',()=>{
 const card=JSON.parse(readFileSync(new URL('./fixtures/scorecard.json',import.meta.url),'utf8')),cost=card.sections.cost;
 cost.working.fullAccess=false;cost.developer={sessionWarning:'Two current sessions <ambiguous>'};
 cost.unattended={status:'measured',ranUnattended:false,count:2,goAheadAt:'2026-10-07T10:00:00Z',interruptions:[{at:'2026-10-07T10:01:00Z',kind:'question',phase:'capture',planned:false},{at:'2026-10-07T10:02:00Z',kind:'turn ended and waited for a prompt',phase:'capture',planned:false}]};
 const html=costSection(cost);assert.match(html,/Which session was scored/);assert.match(html,/Two current sessions &lt;ambiguous&gt;/);assert.match(html,/did not run with full access throughout/);assert.match(html,/2 interruptions after preflight/);assert.match(html,/A question to the person/);assert.match(html,/A turn that ended and waited for a prompt/);
});

test('cost report renders model totals without exposing transcript tool input',()=>{
 const card=JSON.parse(readFileSync(new URL('./fixtures/scorecard.json',import.meta.url),'utf8')),cost=card.sections.cost;
 cost.toolInput={secret:'DO_NOT_RENDER_TOOL_INPUT'};cost.model.toolInput={secret:'DO_NOT_RENDER_MODEL_INPUT'};
 const html=costSection(cost);assert.doesNotMatch(html,/DO_NOT_RENDER/);assert.match(html,/Tokens/);
});

const fixtureCard=():ReportCard=>JSON.parse(readFileSync(new URL('./fixtures/scorecard.json',import.meta.url),'utf8'));
test('schema-valid cards with optional evidence left out still render',()=>{
 // Each of these made the Python-emulating renderer throw a TypeError.
 const cases:[string,(card:ReportCard)=>void][]=[
  ['corrected accuracy without an original headline',card=>{card.headline.accuracy.original=null;}],
  ['measured coverage without a gap record',card=>{delete card.sections.coverage.gap;}],
  ['partly measured accuracy without totals',card=>{card.sections.accuracy={status:'partial'};}],
 ];
 for(const [name,change] of cases){const card=fixtureCard();change(card);assert.match(renderReport(card,new Map()),/<\/html>\n$/,name);}
});
test('repeatability rows, artifact differences and the level note render from a measured comparison',()=>{
 const card=fixtureCard();
 card.sections.repeatability={status:'measured',level:'build',levelNote:'Same <inputs>.',comparisons:[
  {run:'second',score:98.765,totalNodes:1200,identicalApartFromAddresses:1150,categoryCounts:{docs:3,geometry:0,text:2},artifactDifferences:[{artifact:'plan.json',path:'/a'},{artifact:'plan.json',path:'/b'},{artifact:'components.json',path:'/a'},{artifact:'plan.json',path:'/a'}],accuracyAgreement:{metric:'corrected',pairs:10,sameVerdict:9,maxRatioDifference:0.0123}},
  {run:'broken',error:'could not read <dump>'}]};
 const html=renderReport(card,new Map());
 assert.match(html,/<td class="n">98\.77<\/td><td class="n">1,150 of 1,200<\/td><td>docs 3 \(file links\), text 2<\/td><td>9 of 10 same verdict; ratios within 1\.23%<\/td>/);
 assert.match(html,/<td colspan="4">could not read &lt;dump&gt;<\/td>/);
 assert.match(html,/Same &lt;inputs&gt;\. Values that differ: <code>components\.json<\/code> 1; <code>plan\.json<\/code> 2\./);
 assert.match(html,/Compared node by node with 1 other run of the same site\./);
 assert.match(html,/<p class="v-n">95\.83<span class="v-u">%<\/span><\/p><p class="v-c">of 1,200 nodes identical across 2 runs/);
});
