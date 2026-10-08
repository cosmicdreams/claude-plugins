#!/usr/bin/env node
/** Run cached ESLint and Prettier without creating a plugin node_modules directory. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pluginRoot, readyDependencyFolder, sharedRequire } from '../src/runtime.ts';

const mode = process.argv[2];
if (!['lint', 'format', 'format:check'].includes(mode ?? '')) {
  throw new Error('usage: lint-tool.ts lint|format|format:check');
}

const dependencyFolder = readyDependencyFolder();
const modules = realpathSync(resolve(dependencyFolder, 'node_modules'));
const manifest = JSON.parse(readFileSync(resolve(pluginRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const paths = Object.fromEntries(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).flatMap(name => {
  const folder = resolve(modules, name);
  const pkg = JSON.parse(readFileSync(resolve(folder, 'package.json'), 'utf8')) as { types?: string; typings?: string };
  return [[name, [resolve(folder, pkg.types ?? pkg.typings ?? 'index.d.ts')]], [`${name}/*`, [resolve(folder, '*')]]];
}));

function run(command: string, args: string[], env = process.env): void {
  const result = spawnSync(process.execPath, [command, ...args], { cwd: pluginRoot, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (mode === 'lint') {
  const overlay = mkdtempSync(resolve(tmpdir(), 'design-lab-eslint-'));
  try {
    const typeRoots = resolve(modules, '@types');
    const projects = ['tsconfig.src.json', 'tsconfig.figma.json'].map((name, index) => {
      const config = {
        extends: resolve(pluginRoot, name),
        compilerOptions: { paths, typeRoots: [typeRoots, modules] },
      };
      const path = resolve(overlay, `tsconfig-${index}.json`);
      writeFileSync(path, JSON.stringify(config, null, 2));
      return path;
    });
    const env = { ...process.env, DESIGN_LAB_ESLINT_PROJECTS: projects.join('|') };
    const eslintPath = resolve(dirname(sharedRequire().resolve('eslint/package.json')), 'bin/eslint.js');
    run(eslintPath, ['--config', resolve(pluginRoot, 'eslint.config.mjs'), '.', ...process.argv.slice(3)], env);
  } finally {
    rmSync(overlay, { recursive: true, force: true });
  }
} else {
  const prettierPath = sharedRequire().resolve('prettier/bin/prettier.cjs');
  run(prettierPath, [mode === 'format' ? '--write' : '--check', '**/*.ts', '--ignore-path', '.prettierignore']);
}
