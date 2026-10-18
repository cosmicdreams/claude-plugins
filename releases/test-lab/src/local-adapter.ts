// Explicit local adapter boundary. Commands receive an action and JSON argument, never shell text.
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { ownProcessGroup, stopProcessTree } from './process-tree.ts';
import type { FixtureDef } from './model.ts';
import type { FixtureObservation } from './fixtures.ts';
export type SiteIdentity = {appRoot:string};
export type ConfigurationObservation = {status:string;lastImportAt:string|null};
/** Custom adapters must honor signal and release any resources they own on abort. */
export type AdapterContext = {signal:AbortSignal;timeoutMs:number};
export type LocalAdapter = {
  name:string;
  identity:(context?:AdapterContext)=>Promise<SiteIdentity>;
  fixture:(fixture:FixtureDef,context?:AdapterContext)=>Promise<{observation:FixtureObservation;structureObservation:string|null}>;
  configuration?:(context?:AdapterContext)=>Promise<ConfigurationObservation>;
  /** Owned resource cleanup; command adapters reap their process groups before returning. */
  stop?:()=>Promise<void>;
};
const interrupted=()=>new Error('local adapter operation interrupted/aborted');
/** Bound custom calls too: a hung promise cannot hang finalization or start subsequent commands. */
export function adapterOperation(adapter:LocalAdapter,options:{signal?:AbortSignal;timeoutMs?:number}) {
  const controller=new AbortController();const timeoutMs=Math.min(options.timeoutMs??15000,15000);
  const abort=()=>controller.abort(options.signal?.reason??interrupted());
  if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
  return {
    async call<T>(invoke:(context:AdapterContext)=>Promise<T>):Promise<T> {
      if(controller.signal.aborted)throw interrupted();
      let listener:()=>void=()=>{};
      const canceled=new Promise<never>((_done,reject)=>{listener=()=>reject(controller.signal.reason??interrupted());controller.signal.addEventListener('abort',listener,{once:true});});
      const timer=setTimeout(()=>controller.abort(new Error(`local adapter timeout after ${timeoutMs}ms`)),timeoutMs);
      try {
        return await Promise.race([Promise.resolve().then(()=>{if(controller.signal.aborted)throw interrupted();return invoke({signal:controller.signal,timeoutMs});}),canceled]);
      }finally {
        clearTimeout(timer);controller.signal.removeEventListener('abort',listener);
        if(controller.signal.aborted&&adapter.stop) {
          let cleanupTimer:ReturnType<typeof setTimeout>|undefined;
          try {await Promise.race([adapter.stop(),new Promise<never>((_done,reject)=>{cleanupTimer=setTimeout(()=>reject(new Error('adapter cleanup did not complete')),3000);})]);}
          finally{clearTimeout(cleanupTimer);}
        }
      }
    },
    dispose(){options.signal?.removeEventListener('abort',abort);},
  };
}
function obj(v:unknown):Record<string,unknown>{if(v===null||typeof v!=='object'||Array.isArray(v))throw new Error('adapter response must be an object');return v as Record<string,unknown>;}
export function commandAdapter(path:string,appRoot:string):LocalAdapter {
  const script=realpathSync(path);const children=new Set<ReturnType<typeof spawn>>();
  const stops=new Map<ReturnType<typeof spawn>,Promise<void>>();
  const stop=(child:ReturnType<typeof spawn>)=>{let stopping=stops.get(child);if(!stopping){stopping=stopProcessTree(child);stops.set(child,stopping);}return stopping;};
  const invoke=async(action:string,args:unknown={},context?:AdapterContext)=>{
    if(context?.signal.aborted)throw interrupted();
    const child=spawn(process.execPath,[script,action,JSON.stringify(args)],{cwd:appRoot,env:process.env,detached:ownProcessGroup,stdio:['ignore','pipe','pipe']});children.add(child);
    let stdout='',stderr='',problem:Error|null=null;
    // A cleanup failure surfaces where the call awaits the same stop, together with why it stopped.
    const cancel=(error:Error)=>{problem??=error;void stop(child).catch(()=>{});};
    const aborted=()=>cancel(interrupted());
    const timer=setTimeout(()=>cancel(new Error('local adapter timeout')),context?.timeoutMs??15000);
    context?.signal.addEventListener('abort',aborted,{once:true});if(context?.signal.aborted)aborted();
    child.stdout!.on('data',(b:Buffer)=>{stdout+=b.toString();if(Buffer.byteLength(stdout)>1024*1024)cancel(new Error('adapter output exceeded limit'));});
    child.stderr!.on('data',(b:Buffer)=>{stderr+=b.toString();if(Buffer.byteLength(stderr)>1024*1024)cancel(new Error('adapter error output exceeded limit'));});
    try {
      const code=await new Promise<number|null>((done,reject)=>{child.once('error',reject);child.once('close',done);});
      // Also reap descendants left behind by a command which returned successfully. Unverified
      // cleanup is never success, and it never hides why the call was stopped.
      try {await stop(child);}
      catch(cleanup) {throw new Error(`${(problem as Error|null)?.message??`local adapter ${action} ended`}; adapter tree cleanup could not be confirmed: ${cleanup instanceof Error?cleanup.message:String(cleanup)}`,{cause:cleanup});}
      if(problem!==null)throw problem;
      if(code!==0)throw new Error(`local adapter ${action} failed (${code}): ${stderr.trim()}`);
      const v=obj(JSON.parse(stdout) as unknown);if(v['schema']!==1)throw new Error('unsupported local adapter response');return v;
    }finally {
      clearTimeout(timer);context?.signal.removeEventListener('abort',aborted);children.delete(child);stops.delete(child);
    }
  };
  return {name:script,
    async stop(){await Promise.all([...children].map(stop));},
    async identity(context){const v=await invoke('identity',{},context);if(typeof v['appRoot']!=='string')throw new Error('adapter identity did not observe an application root');return {appRoot:realpathSync(v['appRoot'])};},
    async fixture(fixture,context){const v=await invoke('fixture',fixture,context);if(typeof v['exists']!=='boolean'||typeof v['published']!=='boolean'||(v['structureObservation']!==null&&typeof v['structureObservation']!=='string'))throw new Error('invalid local fixture observation');return {observation:{via:'local',exists:v['exists'],published:v['published']},structureObservation:v['structureObservation']};},
    async configuration(context){const v=await invoke('configuration',{},context);if(typeof v['status']!=='string'||(v['lastImportAt']!==null&&typeof v['lastImportAt']!=='string'))throw new Error('invalid configuration observation');return {status:v['status'],lastImportAt:v['lastImportAt']};},
  };
}
