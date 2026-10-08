import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeJson } from './corpus.ts';
import { BuildDriver } from './figma-build.ts';
import { ensureServer } from './figma-runner.ts';
import type { WaitOptions } from './rebuild.ts';
import { prepare as prepareWorkspace, siteUrls, waitForBuild as waitForRebuild, evaluate as evaluateWorkspace } from './rebuild.ts';

export interface Tier2Callbacks {
  prepare?: (site: string, key: string, workspace: string) => string | Promise<string>;
  command?: (script: string, ...args: string[]) => Promise<unknown> | unknown;
  init?: (workspace: string, key: string, siteUrl: string, canonicalBaseUrl: string) => Promise<unknown> | unknown;
  waitForBuild?: (workspace: string, timeout: number) => Promise<void> | void;
  status?:WaitOptions['status'];
  dumpStep?:WaitOptions['dumpStep'];
  evaluate?: (workspace: string) => Promise<unknown> | unknown;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  at?: () => string;
}

function replayStamp(date: Date): string {
  const iso = date.toISOString();
  const micros = (date.getUTCMilliseconds() * 1000 + Number(process.hrtime.bigint() % 1000n)).toString().padStart(6, '0');
  return iso.slice(0, 19).replace(/[-:]/g, '') + '.' + micros + 'Z';
}
/** Prepare through the shared rebuild contract and retain the source corpus manifest. */
export function prepare(site: string, key: string, options: { timestamp?: string; figmaUrl?: string; at?: () => string } = {}): string {
  site = resolve(site);
  const manifest = JSON.parse(readFileSync(join(site, 'corpus.json'), 'utf8'));
  const stamp = options.timestamp ?? replayStamp(new Date());
  const workspace = join(site, 'replays', stamp);
  mkdirSync(join(site, 'replays'), { recursive: true });
  prepareWorkspace(site, workspace, key, options.figmaUrl ?? `https://www.figma.com/design/${key}`, options.at ? { at: options.at } : {});
  writeJson(join(workspace, 'corpus.json'), manifest);
  return workspace;
}

export async function waitForBuild(workspace: string, timeout: number, callbacks: Tier2Callbacks = {}): Promise<void> {
  if (timeout <= 0) throw new Error('timeout must be positive');
  if (callbacks.status || callbacks.dumpStep) {
    if (!callbacks.status || !callbacks.dumpStep) throw new Error('tier2 wait callbacks must provide both status and dumpStep');
  }
  await waitForRebuild(workspace, timeout, (callbacks.pollMs ?? 2000) / 1000, {
    ...(callbacks.status ? { status: callbacks.status } : {}),
    ...(callbacks.dumpStep ? { dumpStep: callbacks.dumpStep } : {}),
    ...(callbacks.sleep !== undefined ? { sleep: callbacks.sleep } : {}),
    ...(callbacks.now !== undefined ? { now: callbacks.now } : {}),
    ...(callbacks.pollMs !== undefined ? { pollMs: callbacks.pollMs } : {}),
  });
}

export async function replay(site: string, key: string, timeout: number, callbacks: Tier2Callbacks = {}): Promise<unknown> {
  const workspace = await (callbacks.prepare ? callbacks.prepare(site, key, join(resolve(site), 'replays', replayStamp(new Date()))) : prepare(site, key, callbacks.at ? { at: callbacks.at } : {}));
  const [siteUrl, canonicalBaseUrl] = siteUrls(resolve(site));
  if (callbacks.init) await callbacks.init(workspace, key, siteUrl, canonicalBaseUrl);
  else if (callbacks.command) await callbacks.command('figma_build.ts', 'init', '--project', workspace, '--file-key', key, '--site-url', siteUrl, '--canonical-base-url', canonicalBaseUrl, '--rebuild', '--offline-images', '--iterate');
  else new BuildDriver(workspace).init({ fileKey: key, siteUrl, canonicalBaseUrl, rebuild: true, offlineImages: true, iterate: true });
  if (callbacks.command) await callbacks.command('workflow.ts', 'runner', '--project', workspace, '--ensure');
  else await ensureServer(workspace);
  if (callbacks.waitForBuild) await callbacks.waitForBuild(workspace, timeout);
  else await waitForBuild(workspace, timeout, callbacks);
  return await (callbacks.evaluate ? callbacks.evaluate(workspace) : evaluateWorkspace(workspace));
}
