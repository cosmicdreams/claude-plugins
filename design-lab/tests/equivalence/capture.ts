/** Manual acceptance lane: oracle and TS write only into a fresh /tmp folder. */
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { pluginRoot, dependencyFolder, sharedRequire } from '../../src/runtime.ts';
import { launchBrowser, measureConfig, captureConfig } from '../../src/capture/browser.ts';
import { isolated, pool } from '../../src/capture/pool.ts';
import { writeJson } from '../../src/contracts.ts';
import type { CaptureConfig, CaptureRow } from '../../src/capture/types.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
const source = resolve(homedir(), '.design/pncb/2026-10-06/capture/configs');
const names = [
  'paragraph__card',
  'paragraph__icon_callout',
  'paragraph__resource',
  'paragraph__accordion',
  'paragraph__cta_block',
];
const configs = names.map((name) => JSON.parse(readFileSync(resolve(source, name + '.json'), 'utf8')) as CaptureConfig);
const root = mkdtempSync('/tmp/design-lab-p2-capture-'),
  configDir = resolve(root, 'configs');
mkdirSync(configDir);
for (let i = 0; i < configs.length; i++) writeJson(resolve(configDir, names[i] + '.json'), configs[i]);
const summary: Record<string, unknown> = { root, components: names, viewports: 3, scale: 1 };
console.log(root);
let oracleMs = 0;
for (const cfg of configs) {
  for (const mode of ['measure', 'capture']) {
    const start = performance.now();
    const out = resolve(root, 'oracle', mode, cfg.componentId.replaceAll(':', '__'));
    mkdirSync(out, { recursive: true });
    const args =
      mode === 'measure'
        ? ['--config', resolve(configDir, cfg.componentId.replaceAll(':', '__') + '.json'), '--out', out]
        : ['--configs', configDir, '--only-ids', cfg.componentId, '--out', out, '--scale', '1'];
    const result = spawnSync(process.execPath, [resolve(pluginRoot, 'scripts', mode + '.mjs'), ...args], {
      cwd: dependencyFolder(),
      encoding: 'utf8',
      timeout: 180000,
    });
    writeFileSync(resolve(out, 'command.log'), (result.stdout ?? '') + (result.stderr ?? ''));
    assert.equal(result.status, 0, result.stderr);
    oracleMs += performance.now() - start;
  }
}
summary['oracleMs'] = oracleMs;
writeJson(resolve(root, 'summary.json'), summary);
for (const concurrency of [1, 4]) {
  const start = performance.now(),
    browser = await launchBrowser();
  const specs: unknown[] = [],
    rowsById = new Map<string, CaptureRow[]>();
  try {
    await pool(configs, concurrency, async (cfg) => {
      const dir = resolve(root, 'ts' + concurrency, cfg.componentId.replaceAll(':', '__'));
      mkdirSync(dir, { recursive: true });
      const spec = await isolated(browser, 900000, (scoped) => measureConfig(scoped, cfg));
      const rows = await isolated(browser, 1800000, (scoped) => captureConfig(scoped, cfg, dir, 1));
      assert.equal(rows.filter((row) => row.error).length, 0, JSON.stringify(rows));
      writeJson(resolve(dir, cfg.machineName + '.spec.json'), spec);
      writeJson(resolve(dir, 'index.json'), rows);
      const oracle = JSON.parse(
        readFileSync(
          resolve(root, 'oracle/measure', cfg.componentId.replaceAll(':', '__'), cfg.machineName + '.spec.json'),
          'utf8',
        ),
      ) as Record<string, unknown>;
      delete oracle['extractedAt'];
      const { extractedAt: _at, ...stable } = spec;
      assert.deepEqual(stable, oracle, cfg.componentId + ': spec');
      specs.push(cfg.componentId);
      const oracleRows = JSON.parse(
        readFileSync(resolve(root, 'oracle/capture', cfg.componentId.replaceAll(':', '__'), 'index.json'), 'utf8'),
      ) as CaptureRow[];
      assert.deepEqual(rows, oracleRows, cfg.componentId + ': screenshot index');
      rowsById.set(cfg.componentId, rows);
      for (const row of rows) {
        const a = await sharp(resolve(root, 'oracle/capture', cfg.componentId.replaceAll(':', '__'), row.file!))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const b = await sharp(resolve(dir, row.file!)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.deepEqual(b.info, a.info);
        assert.equal(b.data.equals(a.data), true, cfg.componentId + ': ' + row.viewport + ' pixels');
      }
    });
  } finally {
    await browser.close();
  }
  summary['ts' + concurrency] = {
    wallMs: performance.now() - start,
    specsEqual: specs.length,
    indexesEqual: rowsById.size,
    imagesPixelIdentical: [...rowsById.values()].reduce((n, rows) => n + rows.length, 0),
  };
  writeJson(resolve(root, 'summary.json'), summary);
  console.log(JSON.stringify(summary['ts' + concurrency]));
}
console.log(JSON.stringify(summary, null, 2));
