import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stageParser } from '../scripts/stage-parser.ts';
import { sha256 } from './canonical.ts';
import { inside } from './persistence.ts';
import { currentBranch } from './work.ts';

export const KIT_FILES=['environment-inputs.ts','environment-preload.cjs','actor-probe.ts','case-step.ts','records.ts','reporter.ts','option-safety.ts','source-analysis.ts','package.json','package-lock.json'];
const kitSource=join(import.meta.dirname,'../kit');
/** Explicit controlled staging only. Never patches the selected suite's specs or config. */
export async function stageKit(suiteRoot:string,config:string):Promise<{path:string;hash:string}[]> {
  const branch=await currentBranch(suiteRoot);
  if(branch===null||branch==='main'||branch==='master')throw new Error('kit staging requires a dedicated branch/worktree');
  const destination=inside(suiteRoot,join(dirname(config),'support/test-lab'));
  if(existsSync(destination)&&readdirSync(destination).length>0)throw new Error('kit destination is nonempty; review an explicit kit upgrade instead of overwriting it');
  mkdirSync(destination,{recursive:true});
  for(const file of KIT_FILES)cpSync(join(kitSource,file),join(destination,file));
  stageParser(join(destination,'node_modules/typescript'));
  return KIT_FILES.map(path=>({path,hash:sha256(readFileSync(join(destination,path)))}));
}
export function stagedKitProblems(dir:string):string[] {
  const problems:string[]=[];
  for(const f of KIT_FILES)if(!existsSync(join(dir,f))||sha256(readFileSync(join(dir,f)))!==sha256(readFileSync(join(kitSource,f))))problems.push(`staged kit ${f} is missing or differs; explicit staging/upgrade required`);
  const parser=join(dir,'node_modules/typescript/package.json');
  if(!existsSync(parser)||Reflect.get(JSON.parse(readFileSync(parser,'utf8')),'version')!=='6.0.3')problems.push('staged parser 6.0.3 is missing');
  return problems;
}
