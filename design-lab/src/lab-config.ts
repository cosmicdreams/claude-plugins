/** Personal configuration and run placement, shared by setup, workflow and evaluation. */
import { existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { writeJson } from './contracts.ts';

export type Settings = Record<string, any>;
export const CONVENTIONS = ['project', 'home'] as const;
export const expand = (path: string): string => resolve(path.replace(/^~(?=\/|$)/, homedir()));
export function configPath(): string {
  // A sandbox home also isolates personal settings; a plain copy needs no real account writes.
  const home = process.env['DESIGN_LAB_HOME'];
  if (home !== undefined && !isAbsolute(home)) throw new Error('DESIGN_LAB_HOME must be an absolute path');
  return expand(process.env['DESIGN_LAB_CONFIG'] ?? (home ? resolve(home, 'config.json') : '~/.claude/design-lab.json'));
}
export function readConfig(): Settings {
  try { const value = JSON.parse(readFileSync(configPath(), 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw new Error(`cannot read configuration ${configPath()}: ${String(error)}`); }
}
export function writeConfig(value: Settings): string { const path = configPath(); writeJson(path, value); return path; }
export function loadConfig(): { corpus: string; scoreboard: { ledger: string; dashboard: string } } {
  if (!existsSync(configPath())) throw new Error(`missing configuration file ${configPath()}; required keys: corpus, scoreboard.ledger, scoreboard.dashboard`);
  const value = readConfig();
  for (const key of ['corpus', 'scoreboard.ledger', 'scoreboard.dashboard']) {
    let item: any = value; for (const part of key.split('.')) item = item && typeof item === 'object' ? item[part] : null;
    if (typeof item !== 'string' || !item.trim()) throw new Error(`${configPath()}: missing or invalid configuration key ${key}`);
  }
  return { corpus: expand(value.corpus), scoreboard: { ledger: expand(value.scoreboard.ledger), dashboard: expand(value.scoreboard.dashboard) } };
}
export function repositoryRoot(start: string): string | null {
  for (let folder = resolve(start);;) { if (existsSync(resolve(folder, '.git'))) return folder; const parent = dirname(folder); if (parent === folder) return null; folder = parent; }
}
export function projectFolder(start: string): string | null {
  start = expand(start); const repo = repositoryRoot(start);
  if (repo && basename(dirname(repo)) === 'worktrees') return dirname(dirname(repo));
  for (let folder = repo ? dirname(repo) : start; folder !== homedir() && dirname(folder) !== folder; folder = dirname(folder)) {
    if ((!repo && existsSync(resolve(folder, 'worktrees'))) || ['plans', 'analysis-reports', 'design'].some(n => existsSync(resolve(folder, n)) && statSync(resolve(folder, n)).isDirectory())) return folder;
  }
  return null;
}
export const projectName = (start: string): string => basename(projectFolder(start) ?? repositoryRoot(start) ?? expand(start));
export function claudeAccountName(): string | null {
  const folder = process.env['CLAUDE_CONFIG_DIR'];
  try { const account = JSON.parse(readFileSync(folder ? resolve(expand(folder), '.claude.json') : resolve(homedir(), '.claude.json'), 'utf8')).oauthAccount ?? {}; const name = account.fullName ?? account.displayName; return typeof name === 'string' && name.trim() ? name.trim() : null; } catch { return null; }
}
export function runsFolder(start: string, config = readConfig()): string {
  const convention = config.runs?.convention;
  if (!CONVENTIONS.includes(convention)) throw new Error('design-lab has not been set up on this machine: run design-lab:init once, which decides where runs live (or give --workspace)');
  if (convention === 'home') return resolve(homedir(), '.design', projectName(start));
  const folder = projectFolder(start);
  if (!folder) throw new Error(`cannot tell which folder holds the project for ${start}: create PROJECT/design, give --workspace, or switch design-lab:init to the home convention`);
  return resolve(folder, 'design');
}
export function insideRepository(path: string): string | null {
  let existing = expand(path); while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  return repositoryRoot(realpathSync(existing));
}
export function runsIn(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).flatMap(name => { const child = resolve(folder, name); try { return [{ child, name, created: JSON.parse(readFileSync(resolve(child, 'project.json'), 'utf8')).createdAt || '' }]; } catch { return []; } })
    .sort((a, b) => a.created < b.created ? -1 : a.created > b.created ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(row => row.child);
}
export function nextRun(start: string, today: string, config = readConfig()): string {
  const folder = runsFolder(start, config), repo = insideRepository(folder);
  if (repo) throw new Error(`the runs folder ${folder} is inside the working copy ${repo}; runs are personal and never committed, so they live outside every repository`);
  mkdirSync(folder, { recursive: true });
  for (let n = 1;; n++) { const candidate = resolve(folder, n === 1 ? today : `${today}-${n}`); try { mkdirSync(candidate); return candidate; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } }
}
export function currentRun(start: string): [string | null, string | null] {
  let folder: string; try { folder = runsFolder(start); } catch { return [null, null]; } return [runsIn(folder).at(-1) ?? null, folder];
}
