/** All equivalence reads come from the external, read-only baseline checkout. */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, dirname } from 'node:path';
import { adapters } from './oracle-adapters.ts';
function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required for the equivalence harness; set it explicitly.`);
  return value;
}
const suppliedRoot = requiredEnvironment('DESIGN_LAB_ORACLE_ROOT');
export const oracleExecutable = requiredEnvironment('DESIGN_LAB_PYTHON');
export const oracleRoot = existsSync(resolve(suppliedRoot, 'design-lab/scripts'))
  ? suppliedRoot
  : dirname(suppliedRoot);
process.env['DESIGN_LAB_ORACLE_ROOT'] = oracleRoot;
process.env['PYTHONDONTWRITEBYTECODE'] = '1';
export const oracleScripts = resolve(oracleRoot, 'design-lab/scripts');
process.env['DESIGN_LAB_DISCOVERY_MANIFEST'] = resolve(import.meta.dirname, 'discovery-artifacts.json');
const root = '/tmp/design-lab-merge-oracle';
export function oracleScript(name: string): string {
  if (!isAbsolute(oracleRoot) || !existsSync(oracleScripts))
    throw new Error('DESIGN_LAB_ORACLE_ROOT must name an absolute baseline checkout or its design-lab directory');
  mkdirSync(root, { recursive: true });
  const source = adapters[name];
  if (source === undefined) throw new Error('unknown oracle adapter ' + name);
  const file = resolve(root, name);
  writeFileSync(file, source);
  return file;
}
