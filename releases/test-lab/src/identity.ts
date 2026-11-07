// Build identity (plan §2). A local build is identified by a content manifest, taken before and after
// the run: the commit, a hash of every modified and untracked non-ignored file, and a hash of every file
// in the generated-asset folders the profile declares. Two uncommitted states at one commit differ; a file
// edited during the run makes the two manifests differ. The other parts (application root, configuration
// status, effective base URL, database, a deployed build probe) are each checked, shown as not checked, or
// recorded as declared, and never shown as passed when they were not performed.

import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { hashOf, sha256 } from './canonical.ts';
import { git } from './git.ts';
import type { EnvironmentDef } from './model.ts';
import { isOutput } from './outputs.ts';

export type ManifestFile = { path: string; state: 'changed' | 'deleted' | 'asset'; hash: string | null };

export type ContentManifest = {
  root: string;
  commit: string | null;
  files: ManifestFile[];
  missingAssetDirs: string[];
  takenAt: string;
  digest: string;
};

function hashPath(abs: string): string | null {
  const stat = lstatSync(abs, { throwIfNoEntry: false });
  if (stat === undefined) return null;
  if (stat.isSymbolicLink()) return `link:${sha256(readlinkSync(abs))}`;
  if (stat.isDirectory()) return 'directory';
  return sha256(readFileSync(abs));
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
}

/**
 * Takes the content manifest of an application checkout. `exclude` lists extra repository-relative globs
 * that are outputs (the run root); test-lab's own outputs are always excluded.
 */
export async function contentManifest(root: string, options: { assetDirs?: string[]; exclude?: string[] } = {}): Promise<ContentManifest> {
  const head = await git(root, ['rev-parse', '--verify', 'HEAD'], { allowFail: true });
  const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--ignore-submodules=none']);
  const files: ManifestFile[] = [];
  for (const entry of status.stdout.split('\0')) {
    if (entry.length < 4) continue;
    const path = entry.slice(3);
    if (isOutput(path, options.exclude)) continue;
    const hash = hashPath(join(root, path));
    files.push({ path, state: hash === null ? 'deleted' : 'changed', hash });
  }
  const missingAssetDirs: string[] = [];
  for (const dir of options.assetDirs ?? []) {
    const abs = join(root, dir);
    if (lstatSync(abs, { throwIfNoEntry: false })?.isDirectory() !== true) {
      missingAssetDirs.push(dir);
      continue;
    }
    const found: string[] = [];
    walk(abs, found);
    for (const file of found) {
      const path = relative(root, file).split(sep).join('/');
      files.push({ path: `asset:${path}`, state: 'asset', hash: hashPath(file) });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const commit = head.ok ? head.stdout.trim() : null;
  return { root, commit, files, missingAssetDirs, takenAt: new Date().toISOString(), digest: hashOf({ commit, files, missingAssetDirs }) };
}

export type ManifestDifference = { path: string; before: string | null; after: string | null };

export function compareManifests(before: ContentManifest, after: ContentManifest): ManifestDifference[] {
  const diffs: ManifestDifference[] = [];
  if (before.commit !== after.commit) diffs.push({ path: '(commit)', before: before.commit, after: after.commit });
  const a = new Map(before.files.map((f) => [f.path, f.hash ?? 'deleted']));
  const b = new Map(after.files.map((f) => [f.path, f.hash ?? 'deleted']));
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (a.get(path) !== b.get(path)) diffs.push({ path, before: a.get(path) ?? null, after: b.get(path) ?? null });
  }
  return diffs;
}

export type IdentityCheckName = 'code' | 'root' | 'generated-assets' | 'configuration' | 'base-url' | 'database' | 'build-probe';

/** matched: performed and agrees. changed: differed between before and after. mismatch: performed and wrong. */
export type IdentityCheck = {
  name: IdentityCheckName;
  status: 'matched' | 'changed' | 'mismatch' | 'not-checked' | 'declared' | 'drift';
  detail: string;
};

export type IdentityState = {
  environment: EnvironmentDef;
  appRoot: string;
  before: ContentManifest | null;
  after: ContentManifest | null;
  /** `ddev describe -j` standard output, as run. */
  ddevDescribe: string | null;
  /** `drush config:status --format=json` standard output, as run. */
  drushConfigStatus: string | null;
  knownConfigOverrides: string[];
  /** What Playwright resolved as baseURL for each project in the run (from the step ledger's begin record). */
  effectiveBaseUrls: string[];
  database: { source: string | null; pulledAt: string | null };
  /** Deployed only: the build probe read before and after, and the candidate the CI job intends. */
  buildProbe: { before: string | null; after: string | null; intended: string | null } | null;
};

export type IdentityResult = {
  checks: IdentityCheck[];
  /** Rule 2: identity unknown or changed during the run. */
  unknown: string[];
  changed: ManifestDifference[];
  /** Configuration names out of sync, after known overrides: gates configuration-dependent cases only. */
  configDrift: string[];
  /** Rule 1: a deployed verdict with no way to read its build. */
  notEvaluable: string[];
};

function sameDir(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

export function parseDdevDescribe(stdout: string): { approot: string; status: string | null } | null {
  try {
    const parsed = JSON.parse(stdout) as { raw?: { approot?: unknown; status?: unknown } };
    const approot = parsed.raw?.approot;
    if (typeof approot !== 'string') return null;
    return { approot, status: typeof parsed.raw?.status === 'string' ? parsed.raw.status : null };
  } catch {
    return null;
  }
}

/** Configuration names drush reports as differing. Empty output means no differences. */
export function parseConfigStatus(stdout: string): string[] | null {
  const text = stdout.trim();
  if (text === '') return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    const rows = Array.isArray(parsed) ? parsed : typeof parsed === 'object' && parsed !== null ? Object.entries(parsed).map(([name, v]) => ({ name, ...(v as object) })) : null;
    if (rows === null) return null;
    return rows.map((r) => String((r as { name?: unknown }).name ?? '')).filter((n) => n !== '');
  } catch {
    return null;
  }
}

const trimSlash = (u: string) => u.replace(/\/+$/, '');

export function evaluateIdentity(state: IdentityState): IdentityResult {
  const checks: IdentityCheck[] = [];
  const unknown: string[] = [];
  const notEvaluable: string[] = [];
  let changed: ManifestDifference[] = [];
  let configDrift: string[] = [];

  // The base URL the run actually used must be the environment's.
  if (state.effectiveBaseUrls.length === 0) checks.push({ name: 'base-url', status: 'not-checked', detail: 'no resolved configuration was recorded' });
  else {
    const wrong = state.effectiveBaseUrls.filter((u) => trimSlash(u) !== trimSlash(state.environment.baseUrl));
    if (wrong.length > 0) {
      checks.push({ name: 'base-url', status: 'mismatch', detail: `the run resolved ${wrong.join(', ')}, not ${state.environment.baseUrl}` });
      unknown.push(`the run's base URL is ${wrong.join(', ')}, not the environment's ${state.environment.baseUrl}`);
    } else checks.push({ name: 'base-url', status: 'matched', detail: state.environment.baseUrl });
  }

  if (state.environment.kind === 'deployed') {
    const probe = state.buildProbe;
    if (probe === null) notEvaluable.push('the profile declares no build probe for this deployed environment');
    else if (probe.before === null || probe.after === null || probe.intended === null) {
      checks.push({ name: 'build-probe', status: 'not-checked', detail: 'the probe or the intended candidate was not read' });
      unknown.push('the deployed build could not be read');
    } else if (probe.before !== probe.after) {
      checks.push({ name: 'build-probe', status: 'changed', detail: `${probe.before} before the run, ${probe.after} after` });
      unknown.push('the deployed build changed during the run');
    } else if (probe.after !== probe.intended) {
      checks.push({ name: 'build-probe', status: 'mismatch', detail: `the environment serves ${probe.after}, not the intended ${probe.intended}` });
      unknown.push('the environment does not serve the intended candidate');
    } else checks.push({ name: 'build-probe', status: 'matched', detail: probe.after });
    return { checks, unknown, changed, configDrift, notEvaluable };
  }

  // local-candidate: the content manifest is the identity, and it is always performable.
  if (state.before === null || state.after === null) {
    checks.push({ name: 'code', status: 'not-checked', detail: 'the content manifest was not taken before and after the run' });
    unknown.push('the build\'s content manifest is missing');
  } else {
    changed = compareManifests(state.before, state.after);
    if (changed.length > 0) {
      checks.push({ name: 'code', status: 'changed', detail: `${changed.length} difference(s), first ${changed[0]?.path}` });
      unknown.push(`the build changed during the run (${changed.map((d) => d.path).join(', ')})`);
    } else {
      checks.push({ name: 'code', status: 'matched', detail: `commit ${state.after.commit ?? '(none)'}, ${state.after.files.length} changed or asset file(s)` });
    }
    if (state.after.missingAssetDirs.length > 0)
      checks.push({ name: 'generated-assets', status: 'not-checked', detail: `missing: ${state.after.missingAssetDirs.join(', ')}` });
    else checks.push({ name: 'generated-assets', status: 'matched', detail: 'hashed in the content manifest' });
  }

  if (state.ddevDescribe === null) checks.push({ name: 'root', status: 'not-checked', detail: '`ddev describe -j` was not run' });
  else {
    const described = parseDdevDescribe(state.ddevDescribe);
    if (described === null) {
      checks.push({ name: 'root', status: 'mismatch', detail: '`ddev describe -j` output could not be read' });
      unknown.push('the site\'s application root could not be read');
    } else if (!sameDir(described.approot, state.appRoot)) {
      checks.push({ name: 'root', status: 'mismatch', detail: `the site serves ${described.approot}, not ${state.appRoot}` });
      unknown.push(`the site serves ${described.approot}, not this checkout`);
    } else checks.push({ name: 'root', status: 'matched', detail: described.approot });
  }

  if (state.drushConfigStatus === null) checks.push({ name: 'configuration', status: 'not-checked', detail: '`drush config:status` was not run' });
  else {
    const names = parseConfigStatus(state.drushConfigStatus);
    if (names === null) checks.push({ name: 'configuration', status: 'not-checked', detail: 'the configuration status could not be read' });
    else {
      configDrift = names.filter((n) => !state.knownConfigOverrides.includes(n));
      checks.push(
        configDrift.length === 0
          ? { name: 'configuration', status: 'matched', detail: 'no differences outside the known overrides' }
          : { name: 'configuration', status: 'drift', detail: configDrift.join(', ') },
      );
    }
  }

  checks.push({
    name: 'database',
    status: 'declared',
    detail: `source ${state.database.source ?? 'not declared'}, pulled ${state.database.pulledAt ?? 'not declared'} (declared, not checked)`,
  });
  return { checks, unknown, changed, configDrift, notEvaluable };
}
