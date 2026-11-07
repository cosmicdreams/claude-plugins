// Explicit suite integration: import this and registerActorProbe() in each governed spec.
// Playwright runs beforeEach after its setup dependencies and before the test body. This probe
// uses the browser context's request client (and therefore its actual login cookies), read-only.
import { test } from '@playwright/test';
import { ACTOR_ATTACHMENT, type ActorObservation } from './records.ts';
export function registerActorProbe(input:{path:string;roleField:string}):void {
  if(!input.path||input.path.startsWith('/')||input.path.includes('..')||input.roleField!=='role')throw new Error('actor probe needs a relative read-only endpoint returning a role field');
  test.beforeEach(async ({page},info)=>{
    const base=info.project.use.baseURL;
    if(typeof base!=='string')throw new Error('actor probe: no project baseURL');
    const storage=info.project.use.storageState;
    const expected=typeof storage==='string'?(storage.split(/[\\/]/).pop()??storage).replace(/\.json$/i,''):storage===undefined?'anonymous':'inline';
    const url=new URL(input.path,`${base.replace(/\/+$/,'')}/`);
    const response=await page.request.get(url.href,{maxRedirects:0,timeout:15000});
    let actual:string|null=null;
    try {const body:unknown=await response.json();if(body!==null&&typeof body==='object'&&!Array.isArray(body)){const role=(body as {role?:unknown}).role;if(typeof role==='string')actual=role;}}catch{/* Invalid response is a failed probe. */}
    const ok=response.ok()&&new URL(response.url()).origin===new URL(base).origin&&actual===expected;
    const observation:ActorObservation={schema:1,phase:'after-setup',project:info.project.name,path:input.path,roleField:input.roleField,expected,actual,url:response.url(),status:response.status(),ok};
    await info.attach(ACTOR_ATTACHMENT,{body:JSON.stringify(observation),contentType:'application/json'});
    if(!ok)throw new Error(`actor probe: role/host could not be confirmed for ${info.project.name} (HTTP ${response.status()})`);
  });
}
