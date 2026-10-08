import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { identity, loadConfig, sitePath, type EvaluationConfig } from './corpus.ts';
import * as scoreboardRender from './scoreboard-render.ts';
import type {ProjectView} from './run-metrics.ts';
import type {CorpusManifest} from './corpus.ts';
import { metrics as sharedMetrics } from './run-metrics.ts';

export interface ScoreboardOptions {
  config?: EvaluationConfig;
  getMetrics?: (run: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
  now?: () => string;
}
export function rows(config = loadConfig()): unknown[] { return existsSync(config.scoreboard!.ledger) ? scoreboardRender.loadRows(config.scoreboard!.ledger) : []; }
export async function record(runPath: string, tier: number, site?: string, options: ScoreboardOptions = {}) {
  if (tier !== 2 && tier !== 3) throw new Error('scoreboard tier must be 2 or 3');
  const run = resolve(runPath), config = options.config ?? loadConfig(), project = JSON.parse(readFileSync(join(run,'project.json'),'utf8')) as ProjectView;
  let label: string | undefined = site;
  if (!label) { try { const manifest = JSON.parse(readFileSync(join(run,'corpus.json'),'utf8')) as Partial<CorpusManifest>; label = manifest.label; } catch { /* fallback to project metadata */ } }
  label ||= project.run?.siteLabel ?? undefined;
  if (!label) throw new Error('missing site label; pass --site <neutral-label>');
  sitePath(label, config);
  const metrics = await (options.getMetrics ?? sharedMetrics)(run), row = { timestamp: (options.now ?? (() => new Date().toISOString()))(), ...identity(project), site: label, tier, ...metrics };
  const ledger = config.scoreboard!.ledger;
  mkdirSync(dirname(ledger), { recursive: true });
  const fd = openSync(ledger, 'a', 0o600);
  try { writeSync(fd, JSON.stringify(row) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  render(config);
  return row;
}
export function render(config = loadConfig()): string {
  const dashboard = config.scoreboard!.dashboard;
  mkdirSync(dirname(dashboard), { recursive: true });
  const page = scoreboardRender.render(rows(config));
  // Keep dashboard writes in the explicitly configured personal workspace.
  writeFileSync(dashboard, page, 'utf8');
  return dashboard;
}
export const renderDashboard = render;
export const normalise = scoreboardRender.normalise;
export { scoreboardRender };
