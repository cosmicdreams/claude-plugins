// Pre-load closure and reporter safety share the full AST/capability-use analysis with the core.
// The kit requires its pinned parser dependency (kit/package.json); a missing parser cannot emit
// verified records. No private Playwright introspection supplies fixture or scoped option values.
import { builtinModules } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { scanFile } from './source-analysis.ts';
export { ANALYSIS_VERSION } from './source-analysis.ts';
export function optionProblems(text:string):string[] { return scanFile('/source.ts',text,'/').problems; }

/** Read-only closure scan before specs load, also persisted by the reporter for historical receipts. */
export function optionClosureProblems(entries: string[], excluded: (file: string) => boolean = () => false, observe?: (file: string, text: string) => void): string[] {
  const seen=new Set<string>(), problems:string[]=[], stack=[...entries];
  const extensions=['','.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs','.json'];
  const builtin=new Set([...builtinModules,...builtinModules.map((s)=>`node:${s}`)]);
  while(stack.length>0) {
    const file=resolve(stack.pop()!);if(seen.has(file))continue;seen.add(file);
    if (excluded(file)) {problems.push(`${file}: import closure would load an excluded module`);continue;}
    let text:string;try{text=readFileSync(file,'utf8');}catch{problems.push(`${file}: source unavailable for scoped option check`);continue;}
    observe?.(file,text);
    if(!/\.[cm]?[jt]sx?$/.test(file))continue;
    const scan=scanFile(file,text,dirname(file));
    problems.push(...scan.problems.map(p=>`${file}: ${p}`));
    problems.push(...scan.computedImports.map(line=>`${file}:${line}: computed module input prevents closure analysis`));
    const imports=scan.imports;
    for(const spec of imports) {
      if(spec.startsWith('.') || spec.startsWith('/')) {
        const base=resolve(dirname(file),spec),stem=base.replace(/\.[cm]?jsx?$/, '');
        const paths=[...extensions.map((e)=>base+e),...extensions.map((e)=>stem+e),...extensions.map((e)=>join(base,`index${e}`))];
        const target=paths.find((p)=>existsSync(p) && statSync(p).isFile());
        if(target===undefined)problems.push(`${file}: unresolved module ${spec} prevents scoped option check`);else stack.push(target);
      } else if(!builtin.has(spec) && !['@playwright/test','@playwright/test/reporter','playwright','playwright/test'].includes(spec))
        problems.push(`${file}: external module ${spec} has unobservable fixture/option behavior`);
    }
  }
  return [...new Set(problems)];
}
