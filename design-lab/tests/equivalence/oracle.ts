/** All equivalence reads come from the external, read-only baseline checkout. */
import {mkdtempSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,isAbsolute,dirname} from 'node:path';
import {adapters} from './oracle-adapters.ts';
export const oracleRoot = process.env['DESIGN_LAB_ORACLE_ROOT'] ?? '/Users/Chris.Weber/Tools/CLAUDE-PLUGINS/worktrees/design-lab-oracle';
if(!isAbsolute(oracleRoot)||!existsSync(resolve(oracleRoot,'design-lab/scripts')))throw new Error('DESIGN_LAB_ORACLE_ROOT must name an absolute baseline checkout containing design-lab/scripts');
process.env['DESIGN_LAB_ORACLE_ROOT']=oracleRoot;
process.env['PYTHONDONTWRITEBYTECODE']='1';
export const oracleExecutable = process.env['DESIGN_LAB_PYTHON'] ?? '/tmp/dl-venv/bin/python';
export const oracleScripts=resolve(oracleRoot,'design-lab/scripts');
const root=mkdtempSync('/tmp/design-lab-oracle-adapters-');
export function oracleScript(name:string):string{const source=adapters[name];if(source===undefined)throw new Error('unknown oracle adapter '+name);const file=resolve(root,name);writeFileSync(file,source);return file;}
