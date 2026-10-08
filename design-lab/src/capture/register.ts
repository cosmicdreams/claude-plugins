/** Capture's narrow workflow boundary; the general workflow CLI belongs to phase 5. */
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pluginRoot } from '../runtime.ts';
import { assertValid, writeArtifact, appendPhaseLog } from '../contracts.ts';
import type { Project } from '../generated/project.ts';
export function registerCapture(projectDir: string): void {
  const path = resolve(projectDir, 'project.json');
  if (!existsSync(path)) return;
  const project = JSON.parse(readFileSync(path, 'utf8')) as Project;
  const evidencePath = realpathSync(resolve(projectDir, 'capture-evidence.json')),
    data = readFileSync(evidencePath);
  const evidence: unknown = JSON.parse(data.toString('utf8'));
  assertValid('capture-evidence', evidence);
  for (const phase of ['plan', 'components', 'index', 'verify'])
    if (project.phases[phase]) project.phases[phase] = { status: 'pending' };
  project.artifacts = Object.fromEntries(
    Object.entries(project.artifacts).filter(
      ([, artifact]) =>
        !artifact ||
        typeof artifact !== 'object' ||
        !['plan', 'build-record', 'index', 'verify-report'].includes(
          String((artifact as Record<string, unknown>)['kind']),
        ),
    ),
  );
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const git = (...args: string[]): string | null => {
    const result = spawnSync('git', ['-C', pluginRoot, ...args], { encoding: 'utf8', timeout: 10000 });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const commit = git('ls-files', '--error-unmatch', '.claude-plugin/plugin.json') ? git('rev-parse', 'HEAD') : null;
  const status = commit ? git('status', '--porcelain', '--', '.') : null;
  const manifest = JSON.parse(readFileSync(resolve(pluginRoot, '.claude-plugin/plugin.json'), 'utf8')) as {
    version: string;
  };
  project.artifacts['captureEvidence'] = {
    path: relative(dirname(realpathSync(path)), evidencePath),
    kind: 'capture-evidence',
    sha256: 'sha256:' + createHash('sha256').update(data).digest('hex'),
    valid: true,
    errors: [],
    updatedAt: at,
    producedBy: {
      pluginDir: realpathSync(pluginRoot),
      toolVersion: 'design-lab ' + manifest.version,
      commit,
      dirty: status === null ? null : Boolean(status),
    },
  };
  project.phases['capture'] = { status: 'complete', updatedAt: at, detail: { artifact: 'captureEvidence' } };
  assertValid('project', project);
  writeArtifact('project', path, project);
  appendPhaseLog(resolve(projectDir, 'phase-log.jsonl'), { at, phase: 'capture', status: 'complete' });
}
