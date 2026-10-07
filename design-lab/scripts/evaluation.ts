#!/usr/bin/env node
/** Phase-four CLI; the existing skills remain on Python until the phase-five cutover. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeJson} from '../src/contracts.ts';

export async function main(argv=process.argv.slice(2)):Promise<number> {
 const [command,...args]=argv,positionals:string[]=[],options:Record<string,string[]|boolean>={};
 for(let i=0;i<args.length;i++){const arg=args[i]!;if(!arg.startsWith('--')){positionals.push(arg);continue;}const name=arg.slice(2);if(['all','json','no-html'].includes(name)){options[name]=true;continue;}const values=[];while(i+1<args.length&&!args[i+1]!.startsWith('--')){values.push(args[++i]!);if(!['compare','session','transcripts','run'].includes(name))break;}if(!values.length)throw new Error('missing value for '+arg);options[name]=values;}
 const flag=(name:string,fallback?:string)=>Array.isArray(options[name])?(options[name] as string[])[0]:fallback;
 const run=()=>{const value=flag('run')??flag('project')??positionals[0];if(!value)throw new Error('pass a run directory');return resolve(value);};
 let result:unknown;
 switch(command) {
 case 'score-run':case 'score_run': {
  const {writeScore}=await import('../src/score-run.ts');
  const scored=await writeScore(run(),{compare:options.compare as string[]|undefined,session:options.session as string[]|undefined,transcripts:options.transcripts as string[]|undefined,since:flag('since'),until:flag('until'),siteLabel:flag('site-label'),out:flag('out'),noHtml:options['no-html']===true});if(scored.message)console.log(scored.message);console.log(JSON.stringify({written:scored.written,errors:scored.errors},null,2));return scored.code;
 }
 case 'verify': {
  const {verify,verifyFromFiles}=await import('../src/verify.ts');const state=flag('state');
  const opts:any={};for(const [key,flagName] of [['components','components'],['tokens','tokens'],['plan','plan'],['index','index'],['waivers','waivers'],['measurements','measurements'],['captureEvidence','capture-evidence'],['renderEvidence','render-evidence']]){const file=flag(flagName!);if(file)opts[key!]=JSON.parse(readFileSync(file,'utf8'));}for(const [key,flagName] of [['builds','builds'],['shotsDir','shots-dir'],['themeRoot','theme-root'],['brand','brand'],['out','out']]){const value=flag(flagName!);if(value)opts[key!]=value;}
  result=state?verify({...opts,state:JSON.parse(readFileSync(state,'utf8'))}):verifyFromFiles(run(),opts);
  console.log(JSON.stringify(result,null,2));return (result as {open:unknown[]}).open.length?1:0;
 }
 case 'verify-state':{const {merge}=await import('../src/verify-state.ts');const folder=resolve(run(),'figma/verify'),path=resolve(folder,'state.json');writeJson(path,merge(folder));result={state:path};break;}
 case 'evaluate':{const {evaluate}=await import('../src/rebuild.ts');result=await evaluate(run(),options.session as string[]|undefined);break;}
 case 'compare-runs':case 'compare_runs':{const {compareMany}=await import('../src/compare-runs.ts');const runs=options.run as string[]|undefined??positionals;if(runs.length<2)throw new Error('compare-runs requires at least two run directories');result=compareMany(runs.map(p=>resolve(p)));break;}
 case 'determinism':{const {hashLayout,checkHash}=await import('../src/determinism.ts');const operation=positionals[0]==='check'?positionals.shift():undefined;const path=flag('layout')??positionals[0];if(!path)throw new Error('pass a layout JSON path');const baseline=flag('check')??(operation==='check'?positionals[1]:undefined);if(operation&&!baseline)throw new Error('determinism check requires an expected hash file');result=baseline?checkHash(path,baseline):{hash:hashLayout(path)};if(baseline&&!(result as {pass:boolean}).pass){console.log(JSON.stringify(result));return 1;}break;}
 case 'scoreboard':{const {record,rows,render}=await import('../src/scoreboard.ts');const op=positionals.shift();if(op==='record')result=await record(run(),Number(flag('tier')),flag('site'));else if(op==='rows')result=rows();else if(op==='render')result={dashboard:render()};else throw new Error('scoreboard record|rows|render');break;}
 case 'corpus':{const {freeze,list}=await import('../src/corpus.ts');const op=positionals.shift();if(op==='freeze'){const label=flag('label');if(!label)throw new Error('pass --label');result=freeze(run(),label);}else if(op==='list')result=list();else throw new Error('corpus freeze|list');break;}
 case 'tier1':case 'tier2':{
  const {sites,sitePath}=await import('../src/corpus.ts');const site=flag('site'),paths=flag('run')?[run()]:options.all===true?sites():site?[sitePath(site)]:[];if(!paths.length)throw new Error('pass --run, --site or --all');
  if(command==='tier1'){const {replay}=await import('../src/tier1.ts');result=paths.map(path=>replay(path,site));}else{const {replay}=await import('../src/tier2.ts');const timeout=Number(flag('timeout','1800'));if(timeout<=0)throw new Error('timeout must be positive');if(options.all&&flag('file-key'))throw new Error('--all reads scratchFileKey from each corpus.json');const targets=paths.map(path=>{const key=flag('file-key')??JSON.parse(readFileSync(resolve(path,'corpus.json'),'utf8')).scratchFileKey;if(!key)throw new Error(`${path}/corpus.json: missing scratchFileKey; for --site pass --file-key`);return {path,key};});result=[];for(const {path,key}of targets)(result as unknown[]).push(await replay(path,key,timeout));}break;
 }
 default:throw new Error('usage: evaluation.ts score-run|verify|verify-state|evaluate|compare-runs|determinism|scoreboard|corpus|tier1|tier2 ...');
 }
 const output=flag('out');if(output&&!['score-run','score_run'].includes(command!))writeJson(resolve(output),result);else console.log(JSON.stringify(result,null,2));return 0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)try{process.exitCode=await main();}catch(error){console.error((error as Error).message);process.exitCode=2;}
