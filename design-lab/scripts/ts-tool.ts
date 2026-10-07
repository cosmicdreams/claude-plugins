#!/usr/bin/env node
/** Give tsc explicit shared-cache paths without a node_modules folder in the plugin. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pluginRoot, readyDependencyFolder } from '../src/runtime.ts';
const mode = process.argv[2];
if (mode !== 'check' && mode !== 'check-figma' && mode !== 'check-js') throw new Error('usage: ts-tool.ts check|check-figma|check-js');
const modules = realpathSync(resolve(readyDependencyFolder(), 'node_modules'));
const manifest = JSON.parse(readFileSync(resolve(pluginRoot, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
const paths = Object.fromEntries(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).flatMap(name => {
  const folder = resolve(modules, name);
  const pkg = JSON.parse(readFileSync(resolve(folder, 'package.json'), 'utf8')) as { types?: string; typings?: string };
  return [[name, [resolve(folder, pkg.types ?? pkg.typings ?? 'index.d.ts')]], [`${name}/*`, [resolve(folder, '*')]]];
}));
const dir = mkdtempSync(resolve(tmpdir(), 'design-lab-tsc-'));
try {
  const nodeConfig = {
    extends: resolve(pluginRoot, 'tsconfig.src.json'),
    compilerOptions: { paths, typeRoots: [resolve(modules, '@types')] },
  };
  const figmaConfig = {
    extends: resolve(pluginRoot, 'tsconfig.figma.json'),
    compilerOptions: { paths, typeRoots: [modules] },
    // Supply the ambient API as an input so the config also works before the
    // first Figma TS entrypoint exists. No Node declarations enter this config.
    files: [resolve(modules, '@figma/plugin-typings/index.d.ts')],
  };
  const jsConfig = () => ({
    compilerOptions: { target: 'ES2024', module: 'NodeNext', moduleResolution: 'NodeNext',
      allowJs: true, checkJs: true, noEmit: true, strict: false, skipLibCheck: true,
      allowImportingTsExtensions: true, types: ['node'], typeRoots: [resolve(modules, '@types')], paths },
    files: [resolve(modules, '@figma/plugin-typings/index.d.ts'), resolve(pluginRoot, 'runner/code.js'),
      ...readdirSync(resolve(pluginRoot, 'scripts')).filter(n => n.endsWith('.mjs')).map(n => resolve(pluginRoot, 'scripts', n)),
      ...readdirSync(resolve(pluginRoot, 'scripts/render')).filter(n => n.endsWith('.js')).map(n => resolve(pluginRoot, 'scripts/render', n))],
  });
  const configs = mode === 'check' ? [nodeConfig, figmaConfig] : mode === 'check-figma' ? [figmaConfig] : [jsConfig()];
  for (const [index, config] of configs.entries()) {
    const path = resolve(dir, `tsconfig-${index}.json`);
    writeFileSync(path, JSON.stringify(config, null, 2));
    const result = spawnSync(process.execPath, [resolve(modules, 'typescript/bin/tsc'), '--noEmit', '-p', path, '--pretty', 'false'], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
