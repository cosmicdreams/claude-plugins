// Runs the example suite under a pinned Playwright release, with the kit copied in as a suite would have
// it, and hands back the run directory the step reporter, JSON and HTML reporters wrote into.
//
// Each run gets a fresh copy of the suite in a temporary folder whose node_modules links to the version's
// own install (tests/playwright/pw-<version>), so the suite resolves exactly that @playwright/test.

import { ownProcessGroup, stopProcessTree } from '../../src/process-tree.ts';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HTML_REPORT_DIR, JSON_REPORT, LEDGER_FILE } from '../../src/run-observation.ts';
import { ENVIRONMENT_ENV, STEP_OUTPUT_ENV } from '../../kit/records.ts';
import { stageParser } from '../../scripts/stage-parser.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = resolve(here, '..', '..');
export const VERSIONS = ['1.58.2', '1.60.0'] as const;
export type Version = (typeof VERSIONS)[number];

export function installed(version: Version): boolean {
  return existsSync(join(here, `pw-${version}`, 'node_modules', '@playwright', 'test', 'package.json'));
}

/** A fresh copy of the example suite with the kit under support/test-lab and the version's node_modules. */
export function stageSuite(version: Version, extra: Record<string, string> = {}): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), `test-lab-pw-${version}-`));
  cpSync(join(here, 'suite'), root, { recursive: true });
  mkdirSync(join(root, 'support', 'test-lab'), { recursive: true });
  for (const file of ['actor-probe.ts', 'environment-inputs.ts', 'environment-preload.cjs', 'case-step.ts', 'records.ts', 'reporter.ts', 'option-safety.ts', 'source-analysis.ts', 'package.json', 'package-lock.json']) cpSync(join(PLUGIN_ROOT, 'kit', file), join(root, 'support', 'test-lab', file));
  mkdirSync(join(root, 'support/test-lab/node_modules'), {recursive:true});
  // Physically stage the kit dependency. Runtime resolution must work without a parser in any
  // parent checkout; sharing the pinned Playwright install does not supply TypeScript implicitly.
  stageParser(join(root, 'support/test-lab/node_modules/typescript'));
  symlinkSync(join(here, `pw-${version}`, 'node_modules'), join(root, 'node_modules'), 'dir');
  for (const file of ['package.json', 'package-lock.json']) cpSync(join(here, `pw-${version}`, file), join(root, file));
  for (const [path, text] of Object.entries(extra)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}

export type PlaywrightRun = { dir: string; status: number | null; stdout: string; stderr: string };

/**
 * Runs `playwright test` in the staged suite, writing all three reports into `dir`. Asynchronous, so a
 * fixture site served from this process keeps answering while Playwright runs.
 */
export function runPlaywright(root: string, dir: string, args: string[], env: Record<string, string> = {}): Promise<PlaywrightRun> {
  mkdirSync(dir, { recursive: true });
  const cli = join(root, 'node_modules', '@playwright', 'test', 'cli.js');
  const child = spawn(process.execPath, [cli, 'test', '--reporter', './support/test-lab/reporter.ts,json,html', ...args], {
    cwd: root,
    detached:ownProcessGroup,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      ...(process.env['PLAYWRIGHT_BROWSERS_PATH'] === undefined ? {} : { PLAYWRIGHT_BROWSERS_PATH: process.env['PLAYWRIGHT_BROWSERS_PATH'] }),
      [ENVIRONMENT_ENV]: JSON.stringify({id:'local',kind:'local-candidate',baseUrl: env['EXAMPLE_BASE_URL'] ?? 'http://127.0.0.1:4180'}),
      [STEP_OUTPUT_ENV]: join(dir, LEDGER_FILE),
      PLAYWRIGHT_JSON_OUTPUT_FILE: join(dir, JSON_REPORT),
      PLAYWRIGHT_HTML_OUTPUT_DIR: join(dir, HTML_REPORT_DIR),
      PLAYWRIGHT_HTML_OPEN: 'never',
      ...env,
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  let stopping:Promise<void>|null=null;
  const timer = setTimeout(()=>{stopping=stopProcessTree(child);},180_000);
  return new Promise((done,reject) =>
    child.on('close', async (status) => {
      clearTimeout(timer);
      try {await stopping;done({ dir, status, stdout, stderr });}catch(error){reject(error);}
    }),
  );
}
