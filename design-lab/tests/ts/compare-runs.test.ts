import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash, hashLayout, normalize } from '../../src/determinism.ts';
import { compareMany, compareRuns } from '../../src/compare-runs.ts';

function node(path: string) {
  return { path, type: 'TEXT', x: 0, y: 0, width: 20, height: 10, layoutMode: 'NONE', paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, itemSpacing: 0,
    layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED', fills: [{ type: 'SOLID', color: '#ff0000', boundVariables: { color: 'Red' } }], strokes: [], cornerRadius: 0, characters: 'Hello',
    fontName: { family: 'Inter', style: 'Regular' }, fontSize: 12, lineHeight: { unit: 'PIXELS', value: 16 }, textStyle: 'Body', componentPropertyDefinitions: {}, variantProperties: {}, description: 'Description', documentationLinks: ['https://example.org'], boundVariables: { width: 'Spacing' } };
}
function fixture(root: string) {
  mkdirSync(join(root, 'figma/dump'), { recursive: true });
  mkdirSync(join(root, 'figma/results'), { recursive: true });
  writeFileSync(join(root, 'components.json'), JSON.stringify({ generatedAt: 'date', components: [] }));
  writeFileSync(join(root, 'figma/results/variables.json'), JSON.stringify({ variables: [] }));
  writeFileSync(join(root, 'figma/dump/Main.json'), JSON.stringify({ page: 'Main', pageIndex: 0, nodes: [node('Main#0/Label#0')], _ids: { page: root } }));
}

test('determinism normalization ignores run metadata but retains ordered layout values', () => {
  const a = { generatedAt: 'old', runId: 'A', layout: [{ width: 10, x: 1 }] };
  const b = { runId: 'B', layout: [{ x: 1, width: 10 }], generatedAt: 'new' };
  assert.deepEqual(normalize(a), normalize(b)); assert.equal(canonicalHash(a), canonicalHash(b));
  assert.notEqual(canonicalHash(a), canonicalHash({ ...a, layout: [{ width: 11, x: 1 }] }));
});

test('layout file hashing preserves baseline integer and float JSON semantics', () => {
  const root = mkdtempSync(join(tmpdir(), 'design-lab-layout-hash-'));
  try {
    const floatPath = join(root, 'float.json'), integerPath = join(root, 'integer.json');
    writeFileSync(floatPath, '{"value":10.0}'); writeFileSync(integerPath, '{"value":10}');
    const baselineFloatDigest = createHash('sha256').update('{"value":10.0}').digest('hex');
    assert.equal(hashLayout(floatPath), baselineFloatDigest); assert.notEqual(hashLayout(floatPath), hashLayout(integerPath));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('identical run output scores 100 despite fresh Figma node ids', () => {
  const root = mkdtempSync(join(tmpdir(), 'design-lab-compare-'));
  try {
    fixture(join(root, 'a')); fixture(join(root, 'b'));
    const report = compareRuns(join(root, 'a'), join(root, 'b'));
    assert.equal(report.summary.score, 100); assert.equal(report.summary.ratios.identical_node, 1);
    assert.deepEqual(report.page_differences.Main!.changes, {});
    assert.equal(compareMany([join(root, 'a'), join(root, 'b')]).summary_matrix[join(root, 'a')]![join(root, 'a')], 100);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('comparison detects every node category and retains its exact score', () => {
  const root = mkdtempSync(join(tmpdir(), 'design-lab-compare-categories-'));
  try {
    fixture(join(root, 'a')); fixture(join(root, 'b'));
    const dumpPath = join(root, 'b/figma/dump/Main.json'), dump = JSON.parse(readFileSync(dumpPath, 'utf8')), changed = dump.nodes[0];
    changed.x = 1; changed.layoutMode = 'HORIZONTAL'; changed.cornerRadius = 4; changed.characters = 'Goodbye'; changed.fontSize = 14; changed.description = 'Changed';
    changed.componentPropertyDefinitions = { Label: { type: 'TEXT' } }; changed.boundVariables = { width: 'Other' }; changed.fills[0].boundVariables = { color: 'Blue' };
    writeFileSync(dumpPath, JSON.stringify(dump));
    writeFileSync(join(root, 'b/components.json'), JSON.stringify({ generatedAt: 'later', components: [1] }));
    const report = compareRuns(join(root, 'a'), join(root, 'b')), categories = report.page_differences.Main!.changes['Main#0/Label#0']!;
    assert.deepEqual(Object.keys(categories).sort(), ['bindings', 'docs', 'geometry', 'layout', 'properties/variants', 'style', 'text', 'typography'].sort());
    assert.deepEqual(report.summary.category_counts, { geometry: 1, layout: 1, style: 1, text: 1, typography: 1, bindings: 1, 'properties/variants': 1, docs: 1 });
    assert.equal(report.summary.score, 25.76); assert.deepEqual(report.summary.ratios, { identical_node: 0, geometry_exact: 0, text_exact: 0, binding_exact: 0 });
    assert.deepEqual(report.artifacts['components.json']!.differences, [{ path: '/components/0', a: null, b: 1 }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('comparison detects missing nodes and page ordering drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'design-lab-compare-pages-'));
  try {
    fixture(join(root, 'a')); fixture(join(root, 'b'));
    const main = join(root, 'b/figma/dump/Main.json'), dump = JSON.parse(readFileSync(main, 'utf8')); dump.nodes.push(node('Main#0/Extra#0')); writeFileSync(main, JSON.stringify(dump));
    let report = compareRuns(join(root, 'a'), join(root, 'b'));
    assert.deepEqual(report.page_differences.Main!.added, ['Main#0/Extra#0']); assert.equal(report.summary.score, 59.09);
    writeFileSync(join(root, 'a/figma/dump/Next.json'), JSON.stringify({ page: 'Next', pageIndex: 1, nodes: [] }));
    writeFileSync(join(root, 'b/figma/dump/Next.json'), JSON.stringify({ page: 'Next', pageIndex: -1, nodes: [] }));
    report = compareRuns(join(root, 'a'), join(root, 'b')); assert.equal(report.pages.order_equal, false); assert.equal(report.summary.score, 50);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
