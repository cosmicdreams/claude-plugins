import { oracleScript, oracleExecutable, oracleRoot } from './oracle.ts';
/** Required acceptance independent of DDEV availability. All output confined to /tmp. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { pluginRoot } from '../../src/runtime.ts';
import { writeJson } from '../../src/contracts.ts';
export type PortableResult = { status: string; [key: string]: unknown };
import { parsePyYaml } from '../../src/pyyaml.ts';
import {
  collectRows,
  buildUsage,
  mergeCanvasUsage,
  PLACEMENTS_SQL,
  PAGES_SQL,
  ALIASES_SQL,
} from '../../src/extract-canvas-usage.ts';
import { httpGet } from '../../src/extract-drupal-usage.ts';
import { fetchUrl } from '../../src/find-examples.ts';
import { fetchImage } from '../../src/fetch-images.ts';
import { differences, normalize } from './discovery.ts';
const folder = resolve(pluginRoot, 'tests/fixtures/p34');
type CoverageRow = {
  id: string;
  expected: number;
  artifacts?: string[];
  files?: string[];
  manifest: string;
  core?: Record<string, string[]>;
  status?: string;
};
type CoverageMatrix = { version: number; required: CoverageRow[]; pending: CoverageRow[] };
type CanvasFixture = {
  rows: { placements: string[][]; pages: string[][]; aliases: string[][] };
  components: Parameters<typeof buildUsage>[0];
  source: Parameters<typeof buildUsage>[2];
  sql: { placements: string; pages: string; aliases: string };
};
type HttpRow = {
  path: string;
  result: [number, string];
  status: number;
  headers?: Record<string, string>;
  body?: string;
  drop?: boolean;
};
const read = <T = unknown>(name: string): T => JSON.parse(readFileSync(resolve(folder, name + '.json'), 'utf8')) as T;
export function portableManifest() {
  const matrix = read<CoverageMatrix>('coverage');
  assert.equal(matrix.version, 1);
  for (const id of [
    'repository-discovery',
    'canvas-sql-replay',
    'network-http-replay',
    'scalar-corpus',
    'six-run-evaluation',
  ])
    assert.ok(
      matrix.required.some((r) => r.id === id),
      'missing required coverage ' + id,
    );
  const repository = matrix.required.find((r) => r.id === 'repository-discovery');
  if (!repository) throw new Error('repository-discovery coverage requirement is missing');
  const artifacts: { core: Record<string, string[]> } = JSON.parse(
    readFileSync(resolve(folder, repository.manifest), 'utf8'),
  );
  assert.equal(
    Object.values(artifacts.core).reduce((n, items) => n + items.length, 0),
    repository.expected,
    'repository coverage count',
  );
  const evaluation = matrix.required.find((r) => r.id === 'six-run-evaluation');
  if (!evaluation) throw new Error('six-run-evaluation coverage requirement is missing');
  assert.equal(evaluation.expected, 6);
  assert.deepEqual(evaluation.artifacts, ['scorecard', 'report', 'completion']);
  for (const row of matrix.required)
    for (const file of row.files ?? [])
      assert.ok(
        existsSync(resolve(folder, file)) && readFileSync(resolve(folder, file)).length,
        'missing required coverage artifact ' + file,
      );
  for (const id of ['pncb-whole-file-verify', 'kingtec-whole-file-verify'])
    assert.equal(matrix.pending.find((r) => r.id === id)?.status, 'pending live build');
  return matrix;
}
export async function portableParity(root: string) {
  assert.ok(root.startsWith('/tmp/'));
  mkdirSync(root, { recursive: true });
  const matrix = portableManifest(),
    results: PortableResult[] = [];
  const requestFile = resolve(root, 'portable-request.json'),
    oracle = oracleScript('portable-oracle.py'),
    python = oracleExecutable;
  const py = (request: unknown) => {
    writeJson(requestFile, request);
    const p = spawnSync(python, [oracle, requestFile], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    assert.equal(p.status, 0, p.stderr);
    return p.stdout;
  };
  const fixture = read<CanvasFixture>('canvas-sql'),
    calls: string[] = [];
  const rows = collectRows(root, null, (_command, args) => {
    if (args[0] === 'describe')
      return { status: 0, stdout: JSON.stringify({ raw: { status: 'running', name: 'portable-canvas' } }), stderr: '' };
    const sql = args.at(-1)!;
    calls.push(sql);
    const key =
      sql === PLACEMENTS_SQL.trim()
        ? 'placements'
        : sql === PAGES_SQL.trim()
          ? 'pages'
          : sql === ALIASES_SQL.trim()
            ? 'aliases'
            : null;
    assert.ok(key, 'unexpected SQL');
    return { status: 0, stdout: fixture.sql[key], stderr: '' };
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(rows, {
    placements: fixture.rows.placements,
    pages: fixture.rows.pages,
    aliases: fixture.rows.aliases,
  });
  const usage = buildUsage(fixture.components, { ...fixture.rows, ...rows }, fixture.source);
  usage.generatedAt = 'oracle-clock';
  const actual = { usage, merged: mergeCanvasUsage(fixture.components, usage) },
    expected = JSON.parse(py({ action: 'canvas', fixture }));
  assert.deepEqual(differences(expected, read('canvas-expected')), [], 'checked-in oracle drift');
  const baselineVersion = JSON.parse(
      readFileSync(resolve(oracleRoot, 'design-lab/.claude-plugin/plugin.json'), 'utf8'),
    ).version,
    currentVersion = JSON.parse(readFileSync(resolve(pluginRoot, '.claude-plugin/plugin.json'), 'utf8')).version;
  assert.equal(expected.usage.toolVersion, 'design-lab ' + baselineVersion);
  assert.equal(actual.usage.toolVersion, 'design-lab ' + currentVersion);
  expected.usage.toolVersion = actual.usage.toolVersion;
  assert.deepEqual(differences(expected, actual), [], 'Canvas oracle parity');
  writeJson(resolve(root, 'canvas-actual.json'), actual);
  results.push({ id: 'canvas-sql-replay', status: 'match', queries: 3, placements: rows.placements.length });
  const scalars = read<string[]>('yaml-scalars'),
    yaml = scalars.map((s, i) => `- value: ${s}\n  key:\n    ${s}: item-${i}`).join('\n') + '\n';
  const parsed = parsePyYaml(yaml);
  py({ action: 'yaml', yaml, actual: JSON.stringify(parsed) });
  const keys =
    'true: a\n1: b\n1.0: c\nfalse: d\n0: e\n-0.0: f\n9007199254740992: g\n9007199254740993: h\n1000000000000000000000: i\n1.0e+21: j\n';
  py({ action: 'yaml', yaml: keys, actual: JSON.stringify(parsePyYaml(keys)) });
  results.push({ id: 'scalar-corpus', status: 'match', scalars: scalars.length, contexts: ['value', 'mapping-key'] });
  const responses = read<HttpRow[]>('http-responses'),
    server = createServer((q, r) => {
      const f = responses.find((f) => f.path === q.url);
      if (!f) {
        r.writeHead(404);
        r.end();
        return;
      }
      if (f.drop) {
        q.socket.destroy();
        return;
      }
      r.writeHead(f.status, f.headers ?? {});
      r.end(f.body ?? '');
    });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  try {
    const paths = responses.map((f) => f.path);
    writeJson(requestFile, { action: 'http', base, paths });
    const expected: HttpRow[] = await new Promise((resolveResult, reject) => {
      const p = spawn(python, [oracle, requestFile], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
      let out = '',
        err = '';
      p.stdout.on('data', (b) => (out += b));
      p.stderr.on('data', (b) => (err += b));
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolveResult(JSON.parse(out)) : reject(new Error(err))));
    });
    const actual = [];
    for (const item of expected) {
      const result = await fetchUrl(base + item.path);
      assert.equal(result[0], item.result[0], item.path);
      if (result[0] !== 0) assert.equal(result[1], item.result[1], item.path);
      else assert.ok(result[1] && item.result[1], 'both runtimes disclose network errors');
      actual.push({ path: item.path, result });
      if (['/error', '/missing'].includes(item.path)) {
        const response = await httpGet(base + item.path);
        assert.equal(response.status, item.result[0]);
      }
    }
    for (const path of ['/malformed', '/unsupported']) await assert.rejects(fetchImage(base + path, 1));
    const stable = expected.map((item) => ({
      ...item,
      result: item.result[0] === 0 ? [0, item.result[1].replaceAll(base, '<base>')] : item.result,
    }));
    const saved = resolve(folder, 'http-expected.json');
    if (process.argv.includes('--generate-http')) writeJson(saved, stable);
    else assert.deepEqual(stable, read<HttpRow[]>('http-expected'), 'checked-in HTTP oracle drift');
    writeJson(resolve(root, 'http-actual.json'), actual);
    results.push({
      id: 'network-http-replay',
      status: 'match',
      responses: paths.length,
      htmlPages: 12,
      helpers: ['httpGet', 'fetchImage'],
    });
  } finally {
    await new Promise<void>((res, rej) => server.close((error) => (error ? rej(error) : res())));
  }
  const result = { matrix, results };
  writeJson(resolve(root, 'portable-summary.json'), result);
  return result;
}
if (import.meta.main)
  console.log(JSON.stringify(await portableParity(process.argv[2] ?? '/tmp/design-lab-p34-portable'), null, 2));
