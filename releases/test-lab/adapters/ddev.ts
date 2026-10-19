#!/usr/bin/env node
// The local adapter for a Drupal site served by DDEV. test-lab runs it with the application worktree as
// its working folder: `node adapters/ddev.ts <identity|configuration|fixture|mutate|restore> <json>`.
//
// - identity: DDEV's own application root (`ddev describe -j`, raw.approot), resolved to its real path.
//   It is never this process's folder and never the suite checkout, so a site serving another checkout
//   is caught by the caller's comparison. DDEV must report the project running before anything else.
// - configuration: `drush config:status --format=json`, once DDEV is running.
// - fixture: whether the fixture's path resolves on the site and, for a node, whether it is published.
// - mutate / restore: application-side faults for red checks are project-specific; they come from the
//   application worktree's own `.test-lab/mutations.ts` (exporting mutate(recipe) and restore(recipe)).
//
// No shell: every command is an argument vector. Nothing here reads or prints a secret.
import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const out = (value: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ schema: 1, ...value })}\n`);

async function ddev(args: string[], timeout = 120_000): Promise<string> {
  const r = await run('ddev', args, { cwd: process.cwd(), timeout, maxBuffer: 16 * 1024 * 1024, env: process.env });
  return r.stdout;
}

/** `ddev describe -j` prints log lines as JSON; the one carrying `raw` describes the project. */
async function describe(): Promise<{ approot: string; status: string | null }> {
  const text = await ddev(['describe', '-j'], 60_000);
  for (const line of text.split('\n').reverse()) {
    try {
      const parsed = JSON.parse(line) as { raw?: { approot?: unknown; status?: unknown } };
      if (typeof parsed.raw?.approot === 'string') return { approot: parsed.raw.approot, status: typeof parsed.raw.status === 'string' ? parsed.raw.status : null };
    } catch { /* not this line */ }
  }
  throw new Error('ddev describe -j reported no application root');
}

async function running(): Promise<string> {
  const d = await describe();
  if (d.status !== 'running') throw new Error(`DDEV reports this project ${d.status ?? 'in an unknown state'}; start it and wait until it is ready before any Drush command`);
  return realpathSync(d.approot);
}

const PATH = /^\/[A-Za-z0-9/_.~-]*$/;

async function main(): Promise<void> {
  const [action, raw] = process.argv.slice(2);
  const arg = raw === undefined ? {} : (JSON.parse(raw) as Record<string, unknown>);
  switch (action) {
    case 'identity':
      out({ appRoot: await running() });
      return;
    case 'configuration': {
      await running();
      out({ status: (await ddev(['drush', 'config:status', '--format=json'])).trim(), lastImportAt: null });
      return;
    }
    case 'fixture': {
      const path = arg['path'];
      if (typeof path !== 'string' || !PATH.test(path)) throw new Error('fixture path must be a site-relative path of letters, digits and / _ . ~ -');
      await running();
      // The path is validated above, so it is safe inside a single-quoted PHP string.
      const code = [
        `$path = '${path}';`,
        "$internal = \\Drupal::service('path_alias.manager')->getPathByAlias($path);",
        '$url = \\Drupal\\Core\\Url::fromUserInput($internal);',
        '$exists = $url->isRouted(); $published = $exists;',
        "if ($exists && $url->getRouteName() === 'entity.node.canonical') { $node = \\Drupal::entityTypeManager()->getStorage('node')->load($url->getRouteParameters()['node']); $exists = $node !== NULL; $published = $node !== NULL && $node->isPublished(); }",
        "echo json_encode(['exists' => (bool) $exists, 'published' => (bool) $published]);",
      ].join(' ');
      const seen = JSON.parse((await ddev(['drush', 'php:eval', code])).trim()) as { exists?: unknown; published?: unknown };
      if (typeof seen.exists !== 'boolean' || typeof seen.published !== 'boolean') throw new Error('drush returned no fixture observation');
      out({ exists: seen.exists, published: seen.published, structureObservation: null });
      return;
    }
    case 'mutate':
    case 'restore': {
      const module = join(process.cwd(), '.test-lab', 'mutations.ts');
      if (!existsSync(module)) throw new Error('application-side mutations come from the application worktree\'s .test-lab/mutations.ts (mutate(recipe), restore(recipe)); none exists');
      await running();
      const m = (await import(pathToFileURL(module).href)) as { mutate?: (r: unknown) => Promise<void>; restore?: (r: unknown) => Promise<void> };
      const fn = action === 'mutate' ? m.mutate : m.restore;
      if (typeof fn !== 'function') throw new Error(`.test-lab/mutations.ts exports no ${action}()`);
      await fn(arg);
      out(action === 'mutate' ? { applied: true } : { restored: true });
      return;
    }
    default:
      throw new Error('action is identity, configuration, fixture, mutate or restore');
  }
}

main().catch((error: unknown) => { process.stderr.write(`ddev adapter: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
