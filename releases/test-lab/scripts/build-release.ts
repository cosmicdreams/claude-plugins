#!/usr/bin/env node
// The release package: the plugin as it ships, without its tests and without any node_modules. Node 24
// runs the TypeScript sources directly (type stripping), so there is nothing to compile or bundle. The
// one runtime dependency, the pinned source parser (kit/package.json `typescript`), is never committed
// or shipped: each installed copy installs its own, once, with `node scripts/install-runtime.ts` (npm
// ci in its kit folder, from kit/package-lock.json). release.json records which parser that is.
//
// Reproducible from the sources and lockfiles alone, offline, with nothing fetched:
// - the plugin files are the ones Git would ship (tracked, or untracked and not ignored), minus tests;
// - release.json lists every file with its hash and mode, and a digest of that list. It has no
//   timestamps, so two builds of the same inputs have the same digest;
// - a release tree that holds any node_modules is refused, by the build and by `--check`.
//
//   node scripts/build-release.ts [destination]     (default: repository-root releases/test-lab, marketplace artifact)
//   node scripts/build-release.ts --check           (the release gate: npm run check:release)
//
// Node.js 24 or newer with npm stays a prerequisite of the installed plugin; it is not bundled.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const PLUGIN = resolve(import.meta.dirname, '..');
export const RELEASE_MANIFEST = 'release.json';
export const DEFAULT_RELEASE = resolve(PLUGIN, '..', 'releases', 'test-lab');
/** Where an installed copy's parser lands; never part of the release itself. */
const PARSER_DESTINATION = 'kit/node_modules/typescript';

export type ReleaseFile = { path: string; sha256: string; mode: string };
export type ReleaseManifest = {
  schema: 2;
  plugin: { name: string; version: string };
  node: string;
  parser: { name: 'typescript'; version: string; integrity: string; resolved: string; path: string };
  inputs: { packageLock: string; kitLock: string };
  files: ReleaseFile[];
  digest: string;
};

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

/** The files Git would ship from the plugin folder, minus its tests, its .gitignore and any earlier release. */
export function releaseFiles(root = PLUGIN): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '.'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    // The plugin's own .gitignore would hide node_modules from a tracked copy of the release.
    .filter((f) => f !== '' && f !== '.gitignore' && !/^(tests|release)(\/|$)/.test(f) && !/(^|\/)node_modules(\/|$)/.test(f) && existsSync(join(root, f)))
    .sort();
}

/** The parser both lockfiles pin: the same name, version and integrity, or the build stops. */
export function pinnedParser(root = PLUGIN): ReleaseManifest['parser'] {
  const kitPin = (readJson(join(root, 'kit', 'package.json'))['dependencies'] as Record<string, unknown> | undefined)?.['typescript'];
  const kitLock = (readJson(join(root, 'kit', 'package-lock.json'))['packages'] as Record<string, Record<string, unknown>>)['node_modules/typescript'];
  const lock = readJson(join(root, 'package-lock.json'))['packages'] as Record<string, Record<string, unknown>>;
  // The repository's own compiler is a compatibility wrapper whose dependency is the real parser.
  const plugin = Object.entries(lock).find(([, p]) => p['name'] === 'typescript' && p['version'] === kitPin)?.[1] ?? lock['node_modules/typescript'];
  if (typeof kitPin !== 'string' || kitLock === undefined || plugin === undefined) throw new Error('the lockfiles pin no source parser');
  for (const key of ['version', 'integrity', 'resolved'] as const) {
    if (kitLock[key] !== plugin[key]) throw new Error(`the kit and plugin lockfiles disagree on the parser's ${key}`);
  }
  if (kitLock['version'] !== kitPin || typeof kitLock['integrity'] !== 'string' || !kitLock['integrity'].startsWith('sha512-') || typeof kitLock['resolved'] !== 'string') throw new Error(`the kit lockfile does not pin typescript ${kitPin} by sha512 integrity`);
  return { name: 'typescript', version: kitPin, integrity: kitLock['integrity'], resolved: kitLock['resolved'], path: PARSER_DESTINATION };
}

/** Every node_modules folder under `dir`, relative to it. */
export function nodeModulesIn(dir: string, base = dir): string[] {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    if (!lstatSync(path).isDirectory()) return [];
    return name === 'node_modules' ? [relative(base, path).split('\\').join('/')] : nodeModulesIn(path, base);
  });
}

/** The release's files; `kit/node_modules` (an installed parser) is skipped only when `installed` is set. */
function walk(root: string, dir = root, installed = false): ReleaseFile[] {
  const out: ReleaseFile[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (installed && relative(root, path) === join('kit', 'node_modules')) continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`release would contain a link: ${relative(root, path)}`);
    if (stat.isDirectory()) out.push(...walk(root, path, installed));
    else if (stat.isFile()) out.push({ path: relative(root, path).split('\\').join('/'), sha256: sha256(readFileSync(path)), mode: stat.mode & 0o100 ? '755' : '644' });
    else throw new Error(`release would contain a special file: ${relative(root, path)}`);
  }
  return out;
}

/** Drift gate: every current Git-shipped source and lock must match the selected release. */
export function sourceDriftProblem(dir = DEFAULT_RELEASE, root = PLUGIN): string | null {
  const problem = releaseProblem(dir);
  if (problem !== null) return problem;
  const manifest = readJson(join(dir, RELEASE_MANIFEST)) as unknown as ReleaseManifest;
  const source = releaseFiles(root);
  const shipped = manifest.files;
  if (source.join('\n') !== shipped.map(f => f.path).sort().join('\n')) return 'release source file list drifted; rebuild with npm run build:release';
  for (const f of shipped) {
    const path = join(root, f.path);
    const mode = statSync(path).mode & 0o100 ? '755' : '644';
    if (sha256(readFileSync(path)) !== f.sha256 || mode !== f.mode) return `release source drifted at ${f.path}; rebuild with npm run build:release`;
  }
  if (manifest.inputs.packageLock !== sha256(readFileSync(join(root, 'package-lock.json'))) || manifest.inputs.kitLock !== sha256(readFileSync(join(root, 'kit/package-lock.json'))) || canonicalParser(manifest.parser) !== canonicalParser(pinnedParser(root))) return 'release parser/lock inputs drifted; rebuild with npm run build:release';
  return null;
}
const canonicalParser = (parser: ReleaseManifest['parser']) => JSON.stringify(parser);

export const digestOf = (files: readonly ReleaseFile[]): string => sha256(files.map((f) => `${f.path}\0${f.mode}\0${f.sha256}\n`).join(''));

/**
 * Builds the release into `destination`, which must not exist or must hold an earlier release (it is
 * replaced whole). Built in a sibling folder first, so a failed build leaves nothing half-made. Nothing
 * is fetched or installed: the release carries no node_modules.
 */
export function buildRelease(destination = DEFAULT_RELEASE): ReleaseManifest {
  const target = resolve(destination);
  if (existsSync(target) && readdirSync(target).length > 0 && !existsSync(join(target, RELEASE_MANIFEST))) throw new Error(`${target} exists and is not a test-lab release; it is left alone`);
  const parser = pinnedParser();
  mkdirSync(dirname(target), { recursive: true });
  const work = mkdtempSync(join(dirname(target), '.test-lab-release-'));
  try {
    for (const file of releaseFiles()) {
      mkdirSync(dirname(join(work, file)), { recursive: true });
      cpSync(join(PLUGIN, file), join(work, file));
      chmodSync(join(work, file), statSync(join(PLUGIN, file)).mode & 0o100 ? 0o755 : 0o644);
    }
    const modules = nodeModulesIn(work);
    if (modules.length > 0) throw new Error(`the release would hold ${modules.join(', ')}; node_modules is never shipped`);
    const plugin = readJson(join(work, '.claude-plugin', 'plugin.json'));
    const files = walk(work);
    const manifest: ReleaseManifest = {
      schema: 2,
      plugin: { name: String(plugin['name']), version: String(plugin['version']) },
      node: String((readJson(join(work, 'package.json'))['engines'] as Record<string, unknown> | undefined)?.['node'] ?? '>=24'),
      parser,
      inputs: { packageLock: sha256(readFileSync(join(PLUGIN, 'package-lock.json'))), kitLock: sha256(readFileSync(join(PLUGIN, 'kit', 'package-lock.json'))) },
      files,
      digest: digestOf(files),
    };
    writeFileSync(join(work, RELEASE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    rmSync(target, { recursive: true, force: true });
    renameSync(work, target);
    return manifest;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Why a release folder is not the one its manifest describes, or null. A release as shipped holds no
 * node_modules at all; an installed copy (`installed`) may also hold its own kit/node_modules, which is
 * then not compared, and nothing else.
 */
export function releaseProblem(dir: string, options: { installed?: boolean } = {}): string | null {
  let manifest: ReleaseManifest;
  try {
    manifest = readJson(join(dir, RELEASE_MANIFEST)) as unknown as ReleaseManifest;
  } catch {
    return 'no release.json';
  }
  if (manifest.schema !== 2) return `release.json schema ${String(manifest.schema)} is not 2; rebuild with npm run build:release`;
  const modules = nodeModulesIn(dir).filter((m) => !(options.installed === true && m === 'kit/node_modules'));
  if (modules.length > 0) return `the release holds ${modules.join(', ')}; node_modules is never committed or shipped`;
  if (manifest.files.some((f) => /(^|\/)node_modules(\/|$)/.test(f.path))) return 'release.json lists node_modules files; node_modules is never shipped';
  const files = walk(dir, dir, options.installed === true).filter((f) => f.path !== RELEASE_MANIFEST);
  if (digestOf(files) !== manifest.digest || digestOf(manifest.files) !== manifest.digest) return 'the release files are not the ones release.json lists';
  return null;
}

if (import.meta.main) {
  if (process.argv[2] === '--check') {
    const problem = sourceDriftProblem();
    if (problem !== null) throw new Error(problem);
    process.stdout.write('test-lab marketplace release matches source and manifest\n');
  } else {
  const manifest = buildRelease(process.argv[2]);
  process.stdout.write(`test-lab ${manifest.plugin.version} release: ${manifest.files.length} files, no node_modules (each copy installs typescript ${manifest.parser.version}), digest ${manifest.digest}\n`);
  }
}
