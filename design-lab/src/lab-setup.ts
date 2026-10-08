/** Machine checks and explicit setup actions. Checks never install or alter settings. */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { cacheRoot, dependencyFolder, dependenciesReady, pluginRoot, sharedRequire, chromiumFolder } from './runtime.ts';
import { writeJson } from './contracts.ts';
import * as config from './lab-config.ts';
import { designLabHome, TOKEN_FILE } from './design-lab-home.ts';

export interface SetupCheck {id:string;status:'ok'|'missing'|'advice';label:string;detail:string;fix:string|null;needsApproval:string|null;nodeCwd?:string|null;manifest?:string;neededFolders?:string[]}
export const READ_BLOCK = 'blockReadsOutsideWorkingDirectories';
export const browserFolder = chromiumFolder;
export function playwrightReady(): [boolean, string] {
  if (!dependenciesReady()) return [false, `Dependencies are not installed in ${dependencyFolder()}`];
  const executable = process.env['DESIGN_LAB_BROWSER_EXECUTABLE'];
  try {
    // Provisioning and every launch use the same shared, explicit browser location.
    process.env['PLAYWRIGHT_BROWSERS_PATH'] ??= browserFolder();
    const path = executable ?? (sharedRequire()('playwright') as typeof import('playwright')).chromium.executablePath();
    return [existsSync(path), existsSync(path) ? path : `Chromium is not downloaded (${path})`];
  } catch (error) { return [false, String(error)]; }
}
export function claudeConfigDirs(): string[] { return [...new Set([resolve(homedir(), '.claude'), ...(process.env['CLAUDE_CONFIG_DIR'] ? [config.expand(process.env['CLAUDE_CONFIG_DIR'])] : [])])]; }
export function pluginFolders(dirs = claudeConfigDirs()): string[] {
  const folders: string[] = [];
  for (const dir of dirs) { const cache = resolve(dir, 'plugins/cache'); if (existsSync(cache)) for (const name of readdirSync(cache)) { const folder = resolve(cache, name, 'design-lab'); if (existsSync(folder) && statSync(folder).isDirectory()) folders.push(realpathSync(folder)); } }
  if (!folders.some(folder => isWithin(pluginRoot, folder))) folders.push(dirname(pluginRoot).endsWith('/design-lab') ? dirname(pluginRoot) : resolve(pluginRoot));
  return folders;
}
export function runFolders(value: config.Settings): string[] { return value.runs?.convention === 'home' ? [resolve(homedir(), '.design')] : (value.runs?.projectsFolders ?? []).map(config.expand); }
const isWithin = (path: string, parent: string): boolean => { const rel = relative(parent, path); return rel === '' || !rel.startsWith('..') && !isAbsolute(rel); };
const canonical = (path: string): string => existsSync(config.expand(path)) ? realpathSync(config.expand(path)) : config.expand(path);
export const uncovered = (needed: string[], allowed: string[]): string[] => needed.filter(n => !allowed.some(a => isWithin(canonical(n), canonical(a))));
export function blockingSettings(dirs = claudeConfigDirs()): string[] { return [...new Set(dirs.flatMap(dir => { const path = resolve(dir, 'settings.json'); try { return JSON.parse(readFileSync(path, 'utf8')).permissions?.[READ_BLOCK] === true ? [realpathSync(path)] : []; } catch { return []; } }))]; }
export function setValue(key: string, values: string[]): unknown {
  const value = config.readConfig();
  if (key === 'runs') { if (!config.CONVENTIONS.includes(values[0] as 'project' | 'home')) throw new Error('runs takes one of: project, home'); value.runs = { convention: values[0]! }; }
  else if (key === 'operator') { if (!values[0]?.trim()) throw new Error('operator takes a name'); value.operator = values[0].trim(); }
  else if (key === 'evaluation') { if (values.length !== 3) throw new Error('evaluation takes three paths: corpus, scoreboard ledger, scoreboard dashboard'); value.corpus = values[0]!; value.scoreboard = { ledger: values[1]!, dashboard: values[2]! }; }
  else throw new Error(`unknown setting ${key}`);
  return { written: config.writeConfig(value), [key]: key === 'evaluation' ? values : value[key] };
}
export function allowFolders(projects: string[], dirs = claudeConfigDirs(), plugins = pluginFolders(dirs)): unknown {
  const value = config.readConfig();
  if (projects.length) { value.runs ??= {}; value.runs.projectsFolders = [...new Set([...(value.runs.projectsFolders ?? []), ...projects.map(config.expand)])].sort(); config.writeConfig(value); }
  const needed = [...plugins, ...runFolders(value)], changed = [];
  for (const path of blockingSettings(dirs)) { const settings = JSON.parse(readFileSync(path, 'utf8')); const allowed: string[] = settings.permissions.additionalDirectories ??= []; const added = uncovered(needed, allowed); if (added.length) { allowed.push(...added); writeJson(path, settings); changed.push({ settings: path, added }); } }
  return { changed, restart: !!changed.length };
}
export function allowReads(dirs = claudeConfigDirs()): unknown { const changed = blockingSettings(dirs); for (const path of changed) { const value = JSON.parse(readFileSync(path, 'utf8')); delete value.permissions[READ_BLOCK]; writeJson(path, value); } return { changed, restart: !!changed.length }; }
export function checks(): SetupCheck[] {
  const value = config.readConfig(), out: SetupCheck[] = [], convention = value.runs?.convention;
  const check = (id: string, status: SetupCheck['status'], label: string, detail: string, fix: string | null = null, needsApproval: string | null = null, extra:Partial<SetupCheck> = {}) => out.push({ id, status, label, detail, fix, needsApproval, ...extra });
  check('runs', config.CONVENTIONS.some(c=>c===convention) ? 'ok' : 'missing', 'Where runs live', convention ?? 'not chosen: runs need a folder outside every repository', 'lab_setup.ts set runs project|home');
  if (config.projectFolder(process.cwd())) try { const folder = config.runsFolder(process.cwd(), value); check('project', 'advice', "This project's runs", `${folder} (${existsSync(folder) ? 'exists' : 'does not exist yet'})`, 'lab_setup.ts runs-folder --create'); } catch {}
  check('operator', 'ok', 'Your name for reports', value.operator ?? config.claudeAccountName() ?? 'your git user name');
  const node = Number(process.versions.node.split('.')[0]); check('node', node >= 24 ? 'ok' : 'missing', 'Node.js 24', process.version, node >= 24 ? null : 'install Node.js 24');
  check('dependencies', dependenciesReady() ? 'ok' : 'missing', 'Pinned Node dependencies', dependencyFolder(), dependenciesReady() ? null : 'lab_setup.ts install dependencies', dependenciesReady() ? null : `downloads the committed lockfile packages into ${dependencyFolder()}`);
  const [ready, detail] = playwrightReady(); check('playwright', ready ? 'ok' : 'missing', 'Playwright and its Chromium, for capture', detail, ready ? null : 'lab_setup.ts install playwright', ready ? null : `downloads pinned dependencies and Chromium into ${cacheRoot()}`, { nodeCwd: ready ? dependencyFolder() : null });
  const ddev = spawnSync('ddev', ['version'], { encoding: 'utf8', timeout: 20_000 }); check('ddev', ddev.status === 0 ? 'ok' : 'advice', 'DDEV, for usage counts from a site database', ddev.status === 0 ? 'installed' : 'runs can still build without database usage tiers');
  const home = designLabHome(), copied = existsSync(resolve(home, 'runner/manifest.json')), token = existsSync(resolve(home, 'runner-token')), imported = !!value.runner?.imported;
  check('runner', copied && token && imported ? 'ok' : 'missing', 'The design-lab runner in Figma desktop', copied && token && imported ? 'copied, token ready, imported into Figma desktop' : 'copy and import the runner once', 'lab_setup.ts runner, then import it in Figma desktop, then lab_setup.ts runner --imported', null, { manifest: resolve(home, 'runner/manifest.json') });
  const needed = [...pluginFolders(), ...runFolders(value)], blocked = blockingSettings(), missing = blocked.flatMap(path => uncovered(needed, JSON.parse(readFileSync(path, 'utf8')).permissions?.additionalDirectories ?? []));
  const noProjects = blocked.length && convention === 'project' && !runFolders(value).length;
  check('claude-settings', missing.length || noProjects ? 'missing' : 'ok', 'Claude Code runs design-lab without asking', missing.length || noProjects ? `${READ_BLOCK} is on; not yet allowed: ${missing.join(', ')}${noProjects ? '; the folders you keep projects in' : ''}` : `${READ_BLOCK} is off or design-lab folders are allowed`, 'lab_setup.ts claude-settings --allow-folders <projects> or --allow-reads', 'changes Claude Code settings; open sessions need restarting', { neededFolders: needed });
  const probe = spawnSync('claude', ['--model','claude-haiku-5-5','--version'], { encoding: 'utf8', timeout: 20_000 }), match = probe.stdout?.match(/(\d+)\.(\d+)\.(\d+)/), parts = match?.slice(1).map(Number);
  const pane = !!parts && (parts[0]! > 2 || parts[0] === 2 && (parts[1]! > 1 || parts[1] === 1 && parts[2]! >= 286)); check('pane', pane ? 'ok' : 'advice', 'Claude Code can draw the design-lab pane', pane ? match![0] : 'the pane needs Claude Code 2.1.286 or later; runs work without it', pane ? null : 'update Claude Code');
  let evaluation = true; try { config.loadConfig(); } catch { evaluation = false; } check('evaluation', evaluation ? 'ok' : 'advice', 'Scoreboard and corpus (optional)', evaluation ? 'set' : 'runs work and score without them', evaluation ? null : 'lab_setup.ts set evaluation <corpus> <ledger> <dashboard>');
  return out;
}
export function installDependencies(chromium = false): unknown {
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserFolder() }, flags = chromium ? ['--chromium'] : [];
  const result = spawnSync(process.execPath, [resolve(pluginRoot, 'scripts/setup-ts.ts'), ...flags], { env, stdio: 'inherit', timeout: 900_000 });
  if (result.status !== 0) throw new Error(`dependency setup failed (${result.status}): ${result.error ?? ''}`);
  const value = config.readConfig(); value.nodeCwd = dependencyFolder(); value.browserPath = browserFolder(); config.writeConfig(value);
  return { nodeCwd: dependencyFolder(), browserPath: browserFolder(), ...(chromium ? { chromium: playwrightReady()[1] } : {}) };
}
export async function runner(imported: boolean): Promise<unknown> { const {installRunner, personToken} = await import('./figma-runner.ts'); const install = installRunner(); personToken(); const value = config.readConfig(); if (imported) { value.runner = { imported: true }; config.writeConfig(value); } const tokenPath = resolve(designLabHome(), TOKEN_FILE); return { ...install, imported: !!value.runner?.imported, token: `ready (copy it in your own terminal with: pbcopy < ${tokenPath})` }; }
export function createRunsFolder(from: string): string { const folder = config.runsFolder(from), inside = config.insideRepository(folder); if (inside) throw new Error(`${folder} is inside the working copy ${inside}`); mkdirSync(folder, { recursive: true }); return folder; }
