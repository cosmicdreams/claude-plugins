#!/usr/bin/env node
// Typechecks every part against what it really runs with:
// - the core, scripts and Node tests (tsconfig.src.json);
// - the kit, copied into each locked Playwright install (tests/playwright/pw-<version>) and checked
//   against that release's own public types, as a suite would compile it;
// - the mod and its host tests against the Claude Code SDK declarations.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageParser } from './stage-parser.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules', '.bin', 'tsc');
const STRICT = {
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  useUnknownInCatchVariables: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noEmit: true,
  skipLibCheck: true,
};
let failed = 0;

function check(label: string, project: string): void {
  const r = spawnSync(tsc, ['-p', project], { stdio: 'inherit' });
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${label}`);
  if (r.status !== 0) failed++;
}

check('core, scripts and Node tests', join(root, 'tsconfig.src.json'));

for (const version of ['1.58.2', '1.60.0']) {
  const install = join(root, 'tests', 'playwright', `pw-${version}`);
  if (!existsSync(join(install, 'node_modules', '@playwright', 'test'))) {
    console.log(`FAIL kit on Playwright ${version}: run npm ci in ${install}`);
    failed++;
    continue;
  }
  const dir = mkdtempSync(join(tmpdir(), `test-lab-kit-types-${version}-`));
  try {
    mkdirSync(join(dir, 'kit'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    for (const f of ['actor-probe.ts', 'environment-inputs.ts', 'environment-preload.cjs', 'case-step.ts', 'records.ts', 'reporter.ts', 'option-safety.ts', 'source-analysis.ts', 'package.json', 'package-lock.json']) cpSync(join(root, 'kit', f), join(dir, 'kit', f));
    mkdirSync(join(dir, 'kit/node_modules'), { recursive: true });
    stageParser(join(dir, 'kit/node_modules/typescript'));
    symlinkSync(join(install, 'node_modules'), join(dir, 'node_modules'), 'dir');
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { ...STRICT, target: 'ES2022', lib: ['ES2022', 'DOM'], module: 'NodeNext', moduleResolution: 'NodeNext', allowImportingTsExtensions: true, verbatimModuleSyntax: true, typeRoots: [join(root, 'node_modules', '@types')], types: ['node'] },
        include: ['kit/*.ts'],
      }),
    );
    check(`kit on Playwright ${version}'s public types`, join(dir, 'tsconfig.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sdk = join(homedir(), '.claude', 'plugins', 'marketplaces', 'claude-code-plugins', 'mods', 'types', 'claude-code.d.ts');
if (!existsSync(sdk)) {
  console.log(`FAIL mod: no SDK declarations at ${sdk}`);
  failed++;
} else {
  const dir = mkdtempSync(join(root, '.mod-check-'));
  try {
    cpSync(sdk, join(dir, 'claude-code.d.ts'));
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { ...STRICT, target: 'es2023', lib: ['es2023'], types: [], module: 'esnext', moduleResolution: 'bundler', allowImportingTsExtensions: true, jsx: 'react', jsxFactory: 'h', jsxFragmentFactory: 'Fragment' },
        include: ['claude-code.d.ts', '../hooks/**/*.ts', '../hooks/**/*.tsx', '../tests/mod/**/*.tsx', '../src/artifacts.ts'],
      }),
    );
    check('mod and its host tests against the SDK declarations', join(dir, 'tsconfig.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exitCode = failed === 0 ? 0 : 1;
