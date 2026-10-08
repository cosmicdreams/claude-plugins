import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pluginRoot } from '../../src/runtime.ts';
import { testTitles } from '../support/test-titles.ts';
interface CoverageRow {
  original: string;
  behavior: string;
  tests: { file: string; name: string }[];
  uncovered?: string;
}

void test('every retained scenario names existing individual tests or an explicit coverage gap', () => {
  const manifest = JSON.parse(readFileSync(resolve(pluginRoot, 'tests/keep-coverage.json'), 'utf8')) as {
    retained: number;
    mapping: CoverageRow[];
  };
  assert.equal(manifest.retained, 330);
  assert.equal(manifest.mapping.length, manifest.retained);
  assert.equal(new Set(manifest.mapping.map((row) => row.original)).size, manifest.retained);
  const catalog = new Map<string, Set<string>>();
  for (const row of manifest.mapping) {
    assert.ok(row.original && row.behavior);
    assert.ok(!Object.hasOwn(row, 'suites'), `${row.original}: suite mappings are forbidden`);
    assert.ok(Array.isArray(row.tests), `${row.original}: individual tests are required`);
    if (!row.tests.length) {
      assert.ok(row.uncovered?.trim(), `${row.original}: an unmapped scenario must explain its gap`);
      continue;
    }
    assert.equal(row.uncovered, undefined, `${row.original}: covered and uncovered are mutually exclusive`);
    for (const { file, name } of row.tests) {
      assert.match(file, /^tests\/(ts|browser)\/[^/]+\.test\.ts$/);
      assert.ok(name?.trim(), `${row.original}: a test name is required`);
      let titles = catalog.get(file);
      if (!titles) {
        titles = testTitles(resolve(pluginRoot, file));
        catalog.set(file, titles);
      }
      assert.ok(titles.has(name), `${row.original}: missing test ${file} :: ${name}`);
    }
  }
});

void test('title discovery resolves parameterized names and rejects comments, unrelated calls and invented titles', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-test-titles-'));
  try {
    const file = resolve(root, 'example.test.ts');
    writeFileSync(
      file,
      `
import test from 'node:test';
// test('comment', () => {});
other('unrelated', () => {});
void test('literal', () => {});
for (const [label, width] of [['mobile', 375], ['desktop', 1400]] as const)
  void test('width ' + label + ' at ' + width, () => {});
for (const set of [false, true]) void test(\`native \${set ? 'set' : 'master'}\`, () => {});
`,
    );
    assert.deepEqual(
      [...testTitles(file)],
      ['literal', 'width mobile at 375', 'width desktop at 1400', 'native master', 'native set'],
    );
    assert.equal(testTitles(file).has('invented'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
