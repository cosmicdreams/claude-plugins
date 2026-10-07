import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface EvaluationConfig { corpus: string; scoreboard: { ledger: string; dashboard: string } }
export function loadConfig(): EvaluationConfig {
  const setting = process.env['DESIGN_LAB_CONFIG'] ?? '~/.claude/design-lab.json';
  const expanded = setting === '~' ? homedir() : setting.startsWith('~/') ? join(homedir(), setting.slice(2)) : setting;
  const path = resolve(expanded);
  let value: any;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`missing configuration file ${path}; required keys: corpus, scoreboard.ledger, scoreboard.dashboard`);
    throw new Error(`cannot read configuration ${path}: ${(error as Error).message}`);
  }
  for (const key of ['corpus', 'scoreboard.ledger', 'scoreboard.dashboard']) { let item = value; for (const part of key.split('.')) item = item && typeof item === 'object' ? item[part] : null; if (typeof item !== 'string' || !item.trim()) throw new Error(`${path}: missing or invalid configuration key ${key}`); }
  return { corpus: resolve(value.corpus), scoreboard: { ledger: resolve(value.scoreboard.ledger), dashboard: resolve(value.scoreboard.dashboard) } };
}
export function sitePath(label: string, config = loadConfig()): string {
  if (!label || label === '.' || label === '..' || basename(label) !== label || label.includes('\\') || isAbsolute(label)) throw new Error('site label must be a single directory name');
  return resolve(config.corpus, label);
}
export function identity(project: any) {
  const plugin = project?.run?.plugin ?? {};
  return { pluginVersion: plugin.version || project?.pluginVersion || null, pluginCommit: plugin.commit || project?.pluginCommit || null };
}
export function sha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
export function copyRun(source: string, target: string, replay = false): void {
  source = resolve(source); target = resolve(target);
  if (target === source || (source.startsWith(target + sep)) || (target.startsWith(source + sep) && !(replay && dirname(target) === join(source, 'replays')))) throw new Error('copy destination must be outside the source run');
  cpSync(source, target, { recursive: true, preserveTimestamps: true, filter: path => !['replays', 'corpus.json'].includes(basename(path)) });
}
export function freeze(runPath: string, label: string, config = loadConfig()) {
  const run = resolve(runPath), project = JSON.parse(readFileSync(join(run, 'project.json'), 'utf8'));
  if (!existsSync(join(run, 'components.json')) || !existsSync(join(run, 'capture/measurements'))) throw new Error(`${run}: freeze needs components.json and capture/measurements`);
  const target = sitePath(label, config);
  if (existsSync(target)) throw new Error(`corpus site already exists: ${target}; use a new label for a refresh`);
  mkdirSync(dirname(target), { recursive: true });
  try {
    copyRun(run, target);
    const paths: string[] = [];
    const walk = (folder: string): void => { for (const name of readdirSync(folder)) { const path = join(folder, name), stat = statSync(path); if (stat.isDirectory()) walk(path); else paths.push(path); } };
    walk(target); paths.sort();
    const manifest = { label, sourceRun: run, ...identity(project), frozenAt: new Date().toISOString(), fileCount: paths.length, totalBytes: paths.reduce((sum, p) => sum + statSync(p).size, 0), artifacts: Object.fromEntries(paths.filter(p => p.endsWith('.json')).map(p => [relative(target, p).split(sep).join('/'), sha256(p)])) };
    writeJson(join(target, 'corpus.json'), manifest);
    return manifest;
  } catch (error) { rmSync(target, { recursive: true, force: true }); throw error; }
}
export function sites(config = loadConfig()): string[] {
  if (!existsSync(config.corpus)) return [];
  return readdirSync(config.corpus).map(name => join(config.corpus, name)).filter(path => existsSync(join(path, 'corpus.json'))).sort();
}
export function list(config = loadConfig()): any[] { return sites(config).map(path => JSON.parse(readFileSync(join(path, 'corpus.json'), 'utf8'))); }
export function writeJson(path: string, value: unknown): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
