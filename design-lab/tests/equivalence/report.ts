/** Independent DOM, embedded-pixel and desktop screenshot comparison of the HTML output. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sharedRequire} from '../../src/runtime.ts';
import {assertPixels,EDGE,JPEG} from './image-pixels.ts';
const {chromium}=sharedRequire()('playwright') as typeof import('playwright');
export async function compareReports(python:string,ts:string,out:string) {
  assert.ok(out.startsWith('/tmp/'));mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,colorScheme:'light',locale:'en-US',timezoneId:'America/Chicago'});
    const inspect=async(path:string,label:string)=>{
      const page=await context.newPage();await page.goto(pathToFileURL(path).href);await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});
      const dom=await page.evaluate(()=>{
        const images:string[]=[];
        function node(n:Node):unknown {
          if(n.nodeType===Node.TEXT_NODE)return {text:n.textContent};
          if(!(n instanceof Element))return null;
          const attributes=[...n.attributes].map(a=>{let value=a.value;if(a.name==='src'&&value.startsWith('data:image/')){images.push(value);value='embedded-image-'+(images.length-1);}return [a.name,value];}).sort(([a],[b])=>a!.localeCompare(b!));
          return {tag:n.tagName,attributes,children:[...n.childNodes].map(node).filter(n=>n!==null)};
        }
        return {tree:node(document.documentElement),images};
      });
      const screenshot=await page.screenshot({fullPage:true,animations:'disabled'});writeFileSync(resolve(out,label+'.png'),screenshot);await page.close();return {...dom,screenshot};
    };
    const [a,b]=await Promise.all([inspect(python,'python'),inspect(ts,'typescript')]);
    const differences:string[]=[];
    function diff(a:any,b:any,p='') {if(differences.length>=60)return;if(Object.is(a,b))return;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b)){differences.push(p+': '+JSON.stringify(a)+' != '+JSON.stringify(b));return;}for(const k of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[k],b[k],p+'/'+k);}
    diff(a.tree,b.tree);writeFileSync(resolve(out,'dom-differences.json'),JSON.stringify(differences,null,2));
    const images=[];assert.equal(a.images.length,b.images.length,'embedded image count');
    for(let i=0;i<a.images.length;i++) {const bytes=(s:string)=>Buffer.from(s.split(',')[1]!,'base64');try{images.push({index:i,...await assertPixels(bytes(b.images[i]!),bytes(a.images[i]!),'thumbnail '+i,JPEG),match:true});}catch(error){images.push({index:i,match:false,error:String(error)});}}
    let screenshot:any;try{screenshot={...await assertPixels(b.screenshot,a.screenshot,'report screenshot',EDGE),match:true};}catch(error){screenshot={match:false,error:String(error)};}
    const result={domMatch:differences.length===0,differences,images,screenshot};writeFileSync(resolve(out,'summary.json'),JSON.stringify(result,null,2));return result;
  }finally{await browser.close();}
}
/** completion.md is the plain-text chat reply; inspect its text/DOM and render that reply verbatim. */
export async function compareCompletion(python:string,ts:string,out:string) {
  assert.ok(out.startsWith('/tmp/'));mkdirSync(out,{recursive:true});
  const escape=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const html=(path:string)=>'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Completion reply</title><style>body{margin:32px;background:#fff;color:#111}pre{white-space:pre-wrap;font:16px/1.5 monospace}</style></head><body><pre>'+escape(readFileSync(path,'utf8'))+'</pre></body></html>';
  const pyView=resolve(out,'python.html'),tsView=resolve(out,'typescript.html');writeFileSync(pyView,html(python));writeFileSync(tsView,html(ts));
  return {textMatch:readFileSync(python,'utf8')===readFileSync(ts,'utf8'),...await compareReports(pyView,tsView,out)};
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(JSON.stringify(await compareReports(process.argv[2]!,process.argv[3]!,process.argv[4]!),null,2));
