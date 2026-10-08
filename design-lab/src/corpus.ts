import type { ProjectView } from './run-metrics.ts';
export interface CorpusManifest {
  label: string;
  sourceRun: string;
  pluginVersion: string | null;
  pluginCommit: string | null;
  frozenAt: string;
  fileCount: number;
  totalBytes: number;
  artifacts: Record<string, string>;
}
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface EvaluationConfig {
  corpus: string;
  scoreboard: { ledger: string; dashboard: string };
}
export { loadConfig } from './lab-config.ts';
import { loadConfig } from './lab-config.ts';
export function sitePath(label: string, config = loadConfig()): string {
  if (
    !label ||
    label === '.' ||
    label === '..' ||
    basename(label) !== label ||
    label.includes('\\') ||
    isAbsolute(label)
  )
    throw new Error('site label must be a single directory name');
  return resolve(config.corpus, label);
}
export function identity(project: (ProjectView & { pluginCommit?: string | null }) | null | undefined) {
  const plugin = project?.run?.plugin ?? {};
  return {
    pluginVersion: plugin.version || project?.pluginVersion || null,
    pluginCommit: plugin.commit || project?.pluginCommit || null,
  };
}
export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
export function copyRun(source: string, target: string, replay = false): void {
  source = resolve(source);
  target = resolve(target);
  if (
    target === source ||
    source.startsWith(target + sep) ||
    (target.startsWith(source + sep) && !(replay && dirname(target) === join(source, 'replays')))
  )
    throw new Error('copy destination must be outside the source run');
  cpSync(source, target, {
    recursive: true,
    preserveTimestamps: true,
    filter: (path) => !['replays', 'corpus.json'].includes(basename(path)),
  });
}
export function freeze(runPath: string, label: string, config = loadConfig()) {
  const run = resolve(runPath),
    project = JSON.parse(readFileSync(join(run, 'project.json'), 'utf8')) as ProjectView;
  if (!existsSync(join(run, 'components.json')) || !existsSync(join(run, 'capture/measurements')))
    throw new Error(`${run}: freeze needs components.json and capture/measurements`);
  const target = sitePath(label, config);
  if (existsSync(target)) throw new Error(`corpus site already exists: ${target}; use a new label for a refresh`);
  mkdirSync(dirname(target), { recursive: true });
  try {
    copyRun(run, target);
    const paths: string[] = [];
    const walk = (folder: string): void => {
      for (const name of readdirSync(folder)) {
        const path = join(folder, name),
          stat = statSync(path);
        if (stat.isDirectory()) walk(path);
        else paths.push(path);
      }
    };
    walk(target);
    paths.sort();
    const manifest: CorpusManifest = {
      label,
      sourceRun: run,
      ...identity(project),
      frozenAt: new Date().toISOString(),
      fileCount: paths.length,
      totalBytes: paths.reduce((sum, p) => sum + statSync(p).size, 0),
      artifacts: Object.fromEntries(
        paths.filter((p) => p.endsWith('.json')).map((p) => [relative(target, p).split(sep).join('/'), sha256(p)]),
      ),
    };
    writeJson(join(target, 'corpus.json'), manifest);
    return manifest;
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    throw error;
  }
}
export function sites(config = loadConfig()): string[] {
  if (!existsSync(config.corpus)) return [];
  return readdirSync(config.corpus)
    .map((name) => join(config.corpus, name))
    .filter((path) => existsSync(join(path, 'corpus.json')))
    .sort();
}
export function list(config = loadConfig()): CorpusManifest[] {
  return sites(config).map((path) => JSON.parse(readFileSync(join(path, 'corpus.json'), 'utf8')) as CorpusManifest);
}
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
