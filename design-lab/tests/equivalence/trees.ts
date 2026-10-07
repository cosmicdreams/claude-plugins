import { oracleScript, oracleScripts, oracleExecutable } from './oracle.ts';
/** Compare every measured component in five read-only runs; all writes go to /tmp. */
import { readFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, mkdtempSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { pluginRoot } from '../../src/runtime.ts';
import { writeJson } from '../../src/contracts.ts';
import { build as flat, compact } from '../../src/spec-to-tree.ts';
import { build as responsive } from '../../src/responsive.ts';
import { Renderer, literal } from '../../src/render-payload.ts';
import { tokens, withoutCache } from './template-parity.ts';
import type { Spec } from '../../src/generated/spec.ts';
const sources = { pncb: resolve(homedir(), '.design/pncb/2026-10-06'), definitive: resolve(homedir(), 'Sites/DEFINITIVEHC/design/2026-10-05'),
  massport: resolve(homedir(), 'Tools/design-lab-corpus/massport'), kingtec: resolve(homedir(), 'Tools/design-lab-corpus/kingtec'), acu: resolve(homedir(), 'Tools/design-lab-corpus/americas-credit-unions') };
const root = mkdtempSync('/tmp/design-lab-p2-trees-');
const manifest: { run: string; copy: string; oracle: string; label: string; key: string; original: string }[] = [];
for (const [run, source] of Object.entries(sources)) {
  const measurements = resolve(source, 'capture/measurements');
  assert.equal(existsSync(measurements), true, measurements);
  const components = JSON.parse(readFileSync(resolve(source, 'components.json'), 'utf8')) as { components: { id: string; label?: string; machineName?: string }[] };
  const dir = resolve(root, run); mkdirSync(dir);
  for (const file of readdirSync(measurements).filter(name => name.endsWith('.spec.json')).sort()) {
    const original = resolve(measurements, file), copy = resolve(dir, file); copyFileSync(original, copy);
    const spec = JSON.parse(readFileSync(copy, 'utf8')) as Spec;
    const c = components.components.find(c => c.id.replaceAll(':', '__').replaceAll('/', '__') + '.spec.json' === file)
      ?? components.components.find(c => c.machineName === spec.machineName);
    assert.ok(c, file + ': no source component');
    manifest.push({ run, original, copy, oracle: copy + '.oracle.json', label: c.label || c.id, key: c.id, });
  }
}
writeJson(resolve(root, 'manifest.json'), manifest);
const python = oracleExecutable;
const oracle = spawnSync(python, [oracleScript('trees-oracle.py'), resolve(root, 'manifest.json')], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
assert.equal(oracle.status, 0, oracle.stderr);
const renderer = new Renderer();
const normalizePayloadSource = (source: string): string => tokens(withoutCache(source.split('\n').slice(4).join('\n'), renderer.units.get('_cache') ?? ''));
let checkedPayloadMutation = false;
const started = performance.now(), summary: Record<string, { components: number; flat: number; responsive: number; payloads: number; rejected: number; oracleErrors: string[] }> = {}, failures: unknown[] = [];
for (const item of manifest) {
  const spec = JSON.parse(readFileSync(item.copy, 'utf8')) as Spec;
  const expected = JSON.parse(readFileSync(item.oracle, 'utf8')) as Record<string, { tree?: unknown; args?: unknown; error?: string }>;
  const row = summary[item.run] ??= { components: 0, flat: 0, responsive: 0, payloads: 0, rejected: 0, oracleErrors: [] }; row.components++;
  for (const [kind, build] of [['flat', () => flat(spec, item.label)], ['responsive', () => responsive(spec, item.label, item.key)]] as const) {
    if (expected[kind]?.error) {
      row.oracleErrors.push(item.original + ': ' + kind + ': ' + expected[kind]!.error);
      try { assert.throws(build, item.original + ': TS must reject invalid oracle input'); row.rejected++; }
      catch (error) { failures.push({ file: item.original, kind, error: String(error) }); }
      continue;
    }
    try { const tree = build(); writeJson(item.copy + '.' + kind + '.ts.json', tree); assert.deepEqual(JSON.parse(JSON.stringify(tree)), expected[kind]!.tree); row[kind]++; }
    catch (error) { failures.push({ file: item.original, kind, error: String(error).slice(0, 4000) }); }
  }
  if (expected['responsive']?.args) {
    try {
      const tree = responsive(spec, item.label, item.key);
      const args = { id: item.key, pageId: 'equivalence-fixture', variables: tree.variables, ...compact(tree.tree) };
      assert.deepEqual(JSON.parse(JSON.stringify(args)), expected['responsive'].args, item.original + ': compact ARGS');
      const payload = renderer.call('build_responsive', args), python = readFileSync(item.copy + '.payload.oracle.js', 'utf8');
      assert.deepEqual(JSON.parse(literal(args)), JSON.parse(/^const ARGS = (.*);$/m.exec(python)![1]!), item.original + ': payload ARGS');
      if (!checkedPayloadMutation) {
        const cache = renderer.units.get('_cache') ?? '', cacheEnd = payload.indexOf(cache) + cache.length;
        assert.ok(cache && cacheEnd > cache.length, 'reviewed cache block must exist in generated payload');
        const tail = payload.slice(cacheEnd), changedTail = tail.replace('figma.', 'figna.');
        assert.notEqual(changedTail, tail, 'mutation target must exist after the reviewed cache block');
        const changed = payload.slice(0, cacheEnd) + changedTail;
        assert.notEqual(normalizePayloadSource(changed), normalizePayloadSource(payload), 'payload source normalization must detect a one-character change outside the reviewed cache block');
        checkedPayloadMutation = true;
      }
      assert.equal(normalizePayloadSource(payload), normalizePayloadSource(python), item.original + ': payload source');
      row.payloads++;
    } catch (error) { failures.push({ file: item.original, kind: 'payload', error: String(error).slice(0, 4000) }); }
  }
}
const result = { root, summary, failures, tsMs: performance.now() - started, python: JSON.parse(oracle.stdout) as unknown };
writeJson(resolve(root, 'summary.json'), result); console.log(JSON.stringify(result, null, 2));
process.exitCode = failures.length ? 1 : 0;
