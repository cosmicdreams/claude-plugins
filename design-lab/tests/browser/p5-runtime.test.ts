import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pluginRoot } from '../../src/runtime.ts';

const cli = (script: string, args: string[], cwd: string) => new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
  const env = { ...process.env }; delete env.PLAYWRIGHT_BROWSERS_PATH; delete env.DESIGN_LAB_BROWSER_EXECUTABLE;
  const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', text => stdout += text); child.stderr.on('data', text => stderr += text);
  const timer = setTimeout(() => child.kill(), 45000);
  child.on('error', reject); child.on('close', code => { clearTimeout(timer); done({ code, stdout, stderr }); });
});

test('phase 5 documented standalone browser scripts use only shared packages and Chromium from unrelated cwd', async () => {
  const root = mkdtempSync('/tmp/design-lab-p5-browser-');
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<style>#card{width:120px;height:50px;background:blue}</style><div id="card">Local fixture</div>'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const copy = resolve(root, 'plugin'), cwd = resolve(root, 'unrelated'), configs = resolve(root, 'configs');
    mkdirSync(copy); mkdirSync(cwd); mkdirSync(configs);
    for (const name of ['src/runtime.ts', 'package.json', 'package-lock.json', 'scripts/measure.mjs', 'scripts/capture.mjs', 'scripts/check_selectors.mjs', 'scripts/cookie_preferences.mjs']) cpSync(resolve(pluginRoot, name), resolve(copy, name), { recursive: true });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/fixture`;
    const cfg = { component: 'card', componentId: 'card', machineName: 'card', path: '/fixture', verificationUrl: url, linkUrl: "https://public.test/fixture", rootSelector: '#card', cookiePreferences: false, viewports: [{ name: 'Desktop', width: 400, height: 300 }], states: [{ name: 'default', settle: 0 }] };
    const config = resolve(configs, 'card.json'); writeFileSync(config, JSON.stringify(cfg));
    const checks = resolve(root, 'checks.json'), checked = resolve(root, 'checked.json'); writeFileSync(checks, JSON.stringify([{ componentId: 'card', rootSelector: '#card', pages: [{ path: cfg.path, verificationUrl: url }] }]));
    const cases = [
      ['measure.mjs', ['--config', config, '--out', resolve(root, 'measurements')]],
      ['capture.mjs', ['--configs', configs, '--out', resolve(root, 'shots'), '--scale', '1']],
      ['check_selectors.mjs', ['--input', checks, '--out', checked]],
    ] as const;
    const results = await Promise.all(cases.map(async ([script, args]) => [script, await cli(resolve(copy, 'scripts', script), [...args], cwd)] as const));
    for (const [script, result] of results) assert.equal(result.code, 0, `${script}: ${result.stderr}`);
    assert.ok(existsSync(resolve(root, 'measurements/card.spec.json')));
    assert.ok(existsSync(resolve(root, 'shots/card__desktop.png')));
    assert.equal(JSON.parse(readFileSync(checked, 'utf8'))[0].chosen, '/fixture');
    assert.equal(existsSync(resolve(copy, 'node_modules')), false); assert.equal(existsSync(resolve(cwd, 'node_modules')), false);
  } finally { await new Promise<void>(r => server.close(() => r())); rmSync(root, { recursive: true, force: true }); }
});

test('phase 5 capture CLI prints per-component timing and ETA before its summary', async () => {
  const root = mkdtempSync('/tmp/design-lab-p5-progress-');
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<style>#card{width:120px;height:50px;background:blue}</style><div id="card">Local fixture</div>'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const configs = resolve(root, 'configs'), project = resolve(root, 'run'); mkdirSync(configs); mkdirSync(project);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/fixture`;
    for (const id of ['card', 'other']) writeFileSync(resolve(configs, id + '.json'), JSON.stringify({ component: id, componentId: id, machineName: id, path: '/fixture', verificationUrl: url, linkUrl: "https://public.test/fixture", rootSelector: '#card', cookiePreferences: false, viewports: [{ name: 'desktop', width: 400, height: 300 }], states: [{ name: 'default', settle: 0 }] }));
    const result = await cli(resolve(pluginRoot, 'scripts/capture_all.ts'), ['--project', project, '--configs', configs, '--canonical-base-url', 'https://public.test', '--concurrency', '2'], root);
    assert.equal(result.code, 0, result.stderr);
    assert.equal((result.stdout.match(/\[\d\/2\] (card|other): complete in \d+(?:\.\d+)?s — about \d+ min left/g) ?? []).length, 2, result.stdout);
    assert.ok(result.stdout.indexOf('[2/2]') < result.stdout.indexOf('"captures"'), result.stdout);
  } finally { await new Promise<void>(r => server.close(() => r())); rmSync(root, { recursive: true, force: true }); }
});
