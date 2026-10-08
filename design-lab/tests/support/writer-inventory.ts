/** Syntax inventory, not a schema-acceptance proof. Includes unchecked writers so they cannot disappear from review. */
import { readdirSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, relative } from 'node:path';
import { pluginRoot, sharedRequire } from '../../src/runtime.ts';
import { isEntrypoint } from '../../src/entrypoint.ts';
const acorn = sharedRequire()('acorn') as typeof import('acorn');
const boundaries = new Set(['writeJson', 'writeArtifact', 'writeOnChange', 'writeArtifactOnChange', 'writeAtomic', 'writeFileSync', 'appendFileSync', 'writeSync', 'appendPhaseLog', 'appendJsonl', 'writePlanJson', 'artifact', 'registerOutputs', 'validate', 'assertValid', 'validateRunnerRecord', 'reply', 'call']);
interface Ast { type: string; start: number; end: number; loc?: { start: { line: number } }; [key: string]: unknown }
const ast = (value: unknown): value is Ast => !!value && typeof value === 'object' && 'type' in value && typeof value.type === 'string';
export function writerInventory() {
  const calls: { file: string; line: number; operation: string; arguments: string[] }[] = [];
  const templates: { file: string; line: number; value: string }[] = [];
  const visit = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        const file = relative(pluginRoot, path), source = readFileSync(path, 'utf8');
        // Strip mode retains line positions. TS 7's native compiler has no JS parser API.
        const root = acorn.parse(stripTypeScriptTypes(source), { ecmaVersion: 'latest', sourceType: 'module', locations: true });
        const walk = (node: unknown): void => {
          if (!ast(node)) return;
          if (node.type === 'CallExpression' && ast(node['callee'])) {
            const callee = node['callee'], property = callee['property'];
            const operation = callee.type === 'Identifier' ? callee['name'] : ast(property) ? property['name'] : '';
            if (typeof operation === 'string' && boundaries.has(operation)) calls.push({ file, line: node.loc!.start.line, operation, arguments: (node['arguments'] as unknown[]).filter(ast).map(arg => source.slice(arg.start, arg.end)) });
          }
          if ((file.startsWith('scripts/render/') || file.startsWith('templates/figma/')) && node.type === 'ReturnStatement' && ast(node['argument']))
            templates.push({ file, line: node.loc!.start.line, value: source.slice(node['argument'].start, node['argument'].end) });
          for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else walk(value);
        };
        walk(root);
      }
    }
  };
  for (const folder of ['src', 'scripts', 'templates', 'runner']) visit(resolve(pluginRoot, folder));
  return { calls: calls.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line), templates };
}
if (isEntrypoint(import.meta.url)) console.log(JSON.stringify(writerInventory(), null, 2));
