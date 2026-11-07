// What both live host spikes start from, all in temporary folders: the generic cross-repository fixture
// (a disposable app and QA suite and a local HTTP server; no client site, no TestRail), certified so a
// fast run can be Ready; the plugin staged as it ships, with this checkout's install linked in; a private
// test-lab data folder; and one Ready run made by the staged runner itself, outside any host.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setupCoordinator } from '../tests/fixtures/coordinator.ts';
import { certifyCoordinator } from '../tests/fixtures/coordinator-evidence.ts';
import { coordinate } from '../src/coordinator.ts';
import { commandAdapter } from '../src/local-adapter.ts';
import { tmp } from '../tests/ts/support.ts';
import { stagePlugin } from './stage-plugin.ts';
import { writeRequest } from '../tests/ts/mod-request.ts';

export const clip = (text: unknown, n = 1500): string => String(text).slice(0, n);

/** A log of chosen fields only, and checks that print as they land. */
export function spikeLog(name: string) {
  const path = join('/tmp', `test-lab-${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const state = { failed: false };
  const note = (entry: Record<string, unknown>) => appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  const check = (label: string, ok: boolean, detail: unknown = null) => {
    if (!ok) state.failed = true;
    note({ check: label, ok, detail });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === null ? '' : ` — ${clip(typeof detail === 'string' ? detail : JSON.stringify(detail), 300)}`}`);
  };
  return { path, note, check, state };
}

export async function prepareSpike() {
  const f = await setupCoordinator('1.60.0');
  const data = realpathSync(tmp('test-lab-host-data-'));
  const staged = realpathSync(tmp('test-lab-host-plugin-'));
  const env = { ...process.env, TEST_LAB_DATA: data };
  const cleanup = async (keep = false) => {
    await f.cleanup();
    if (!keep) {
      rmSync(data, { recursive: true, force: true });
      rmSync(staged, { recursive: true, force: true });
    }
  };
  try {
    await certifyCoordinator(f, () => coordinate({ operation: 'run', appRoot: f.app, suiteRoot: f.suite, environment: 'local', noWork: true, adapter: commandAdapter(join(f.suite, 'adapter.ts'), f.app) }));
    stagePlugin(staged, { dependencies: true });
    const operationDir = join(data, 'mod', 'sessions', 'spike', 'op-ready');
    mkdirSync(operationDir, { recursive: true });
    // Asynchronously: the fixture's site and adapter endpoints are served from this process.
    const cli = ['run', '--app-root', f.app, '--suite-root', f.suite, '--env', 'local', '--no-work', '--adapter', join(f.suite, 'adapter.ts')];
    writeRequest(operationDir, cli, 300_000);
    const direct = spawn(process.execPath, [join(staged, 'src/mod-entry.ts'), '--operation-dir', operationDir, '--deadline-ms', '300000', '--', ...cli], { env, stdio: 'ignore' });
    const exit = await new Promise<number | null>((done) => direct.on('close', done));
    const readyDir = (JSON.parse(readFileSync(join(operationDir, 'status.json'), 'utf8')) as { runDir: string | null }).runDir;
    return { f, data, staged, env, readyDir, directExit: exit, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
