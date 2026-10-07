import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {render} from '../../src/scoreboard-render.ts';
import {differences} from '../equivalence/evaluation.ts';
test('finding 1: replacement metacharacters cannot duplicate markup or corrupt scoreboard JSON',()=>{for(const label of ["$'<img src=x onerror=alert(1)>",'$&','$$','$`','</script><img src=x onerror=alert(1)>']){const html=render([{site:label}],label);assert.equal((html.match(/<script>/g)??[]).length,1);assert.equal((html.match(/<\/script>/g)??[]).length,1);const payload=/const DATA=(.*);/.exec(html)![1]!;assert.equal(JSON.parse(payload).rows[0].site,label);}});
test('finding 2: harness rejects differing container types',()=>{assert.ok(differences([],{}).length);assert.ok(differences({a:[]},{a:{}}).length);});



test('finding 5: malformed redirects reject within Promise rather than crash Node',()=>{for(const helper of ['httpGet','fetchImage']){const module=fileURLToPath(new URL(`../../src/${helper==='httpGet'?'extract-drupal-usage':'fetch-images'}.ts`, import.meta.url));const result=spawnSync(process.execPath,['--input-type=module','-e',`import {createServer} from 'node:http';import {${helper}} from ${JSON.stringify(module)};const s=createServer((q,r)=>{r.writeHead(302,{Location:'http://['});r.end();});await new Promise(r=>s.listen(0,'127.0.0.1',r));try{await ${helper}('http://127.0.0.1:'+s.address().port,${helper==='fetchImage'?'1':'{}'});process.exitCode=2;}catch{console.log('caught');}finally{s.close();}`],{encoding:'utf8',env:process.env});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/caught/);}});

test('finding 7: required portable coverage manifest exists',()=>{assert.ok(existsSync(new URL('../fixtures/p34/coverage.json', import.meta.url)));});

test('finding 8: cropping copies at most one contiguous span per intersecting row',async()=>{const {region}=await import('../../src/figma-compare.ts');let spans=0;const raw=new Uint8Array(40*30*3);raw.forEach((_,i)=>raw[i]=i%256);const data=new Proxy(raw,{get(target,key){if(key==='subarray')return(...args:number[])=>{spans++;return target.subarray(...args);};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});for(const box of [{x:0,y:0,width:40,height:30},{x:-2,y:-3,width:17,height:16},{x:39,y:29,width:6,height:7},{x:1.5,y:2.5,width:4.5,height:6.5},{x:-100,y:40,width:9,height:8}]){spans=0;const crop=region({width:40,height:30,data},box);assert.ok(spans<=crop.height,`${spans} span copies for ${crop.height} rows`);}});
