#!/usr/bin/env node
/** Give tsc explicit shared-cache paths without a node_modules folder in the plugin. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, realpathSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pluginRoot, readyDependencyFolder } from '../src/runtime.ts';
const mode = process.argv[2];
if (mode !== 'check' && mode !== 'check-figma' && mode !== 'check-js')
  throw new Error('usage: ts-tool.ts check|check-figma|check-js');
/** check-js reads the pinned baseline (the oracle checkout), never files shipped in this plugin. */
function oraclePlugin(): string {
  const fail = (message: string): never => {
    console.error(message);
    return process.exit(1);
  };
  const supplied = process.env['DESIGN_LAB_ORACLE_ROOT'];
  if (!supplied || !isAbsolute(supplied))
    return fail(
      'check-js needs DESIGN_LAB_ORACLE_ROOT set to the absolute path of the baseline checkout (the plugin folder or its parent)',
    );
  const plugin = existsSync(resolve(supplied, 'design-lab/scripts')) ? resolve(supplied, 'design-lab') : supplied;
  if (!existsSync(resolve(plugin, 'scripts/render')))
    return fail('DESIGN_LAB_ORACLE_ROOT does not contain scripts/render: ' + supplied);
  return plugin;
}
const modules = realpathSync(resolve(readyDependencyFolder(), 'node_modules'));
const manifest = JSON.parse(readFileSync(resolve(pluginRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const paths = Object.fromEntries(
  Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).flatMap((name) => {
    const folder = resolve(modules, name);
    const pkg = JSON.parse(readFileSync(resolve(folder, 'package.json'), 'utf8')) as {
      types?: string;
      typings?: string;
    };
    return [
      [name, [resolve(folder, pkg.types ?? pkg.typings ?? 'index.d.ts')]],
      [`${name}/*`, [resolve(folder, '*')]],
    ];
  }),
);
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
  // The baseline has no package.json, so NodeNext would read its templates as CommonJS and reject
  // their top-level await (TS1309). They run inside an async function body, so check them as ES modules.
  const jsConfig = () => {
    const legacy = oraclePlugin();
    return {
      compilerOptions: {
        target: 'ES2024',
        module: 'ESNext',
        moduleResolution: 'bundler',
        moduleDetection: 'force',
        allowJs: true,
        checkJs: true,
        noEmit: true,
        strict: false,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        types: ['node'],
        typeRoots: [resolve(modules, '@types')],
        paths,
      },
      files: [
        resolve(modules, '@figma/plugin-typings/index.d.ts'),
        resolve(legacy, 'runner/code.js'),
        ...readdirSync(resolve(legacy, 'scripts'))
          .filter((n) => n.endsWith('.mjs'))
          .map((n) => resolve(legacy, 'scripts', n)),
        ...readdirSync(resolve(legacy, 'scripts/render'))
          .filter((n) => n.endsWith('.js'))
          .map((n) => resolve(legacy, 'scripts/render', n)),
      ],
    };
  };
  const configs = mode === 'check' ? [nodeConfig, figmaConfig] : mode === 'check-figma' ? [figmaConfig] : [jsConfig()];
  for (const [index, config] of configs.entries()) {
    const path = resolve(dir, `tsconfig-${index}.json`);
    writeFileSync(path, JSON.stringify(config, null, 2));
    const result = spawnSync(
      process.execPath,
      [resolve(modules, '@typescript/native/bin/tsc'), '--noEmit', '-p', path, '--pretty', 'false'],
      { stdio: 'inherit' },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
