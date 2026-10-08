import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pluginRoot } from '../../src/runtime.ts';

interface Evidence {
  file: string;
  needle: string;
  claim: string;
}
interface Diagnostic {
  id: number;
  location: string;
  code: string;
  message: string;
  rawDiagnostic: string;
  class: 'a' | 'b' | 'c';
  portStatus: string;
  counterpart: string;
  rationale: string;
  evidence: Evidence[];
  behaviorBug: { input: string; currentBehavior: string; portBehavior: string } | null;
}
const fixturePath = resolve(pluginRoot, 'tests/fixtures/checkjs-triage.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  baseline: { report: string; compilerLog: string; total: number };
  counts: Record<'a' | 'b' | 'c', number>;
  diagnostics: Diagnostic[];
};

test('all 156 checkJs diagnostics retain their exact location and compiler message', () => {
  assert.equal(fixture.diagnostics.length, fixture.baseline.total);
  assert.deepEqual(
    fixture.diagnostics.map((d) => d.id),
    Array.from({ length: fixture.baseline.total }, (_, i) => i + 1),
  );
  const seen = new Set<string>();
  for (const diagnostic of fixture.diagnostics) {
    const match = /^(design-lab\/.+):(\d+):(\d+)$/.exec(diagnostic.location);
    assert.ok(match, `invalid location for #${diagnostic.id}: ${diagnostic.location}`);
    const [, file, line, column] = match;
    assert.equal(
      diagnostic.rawDiagnostic,
      `${file}(${line},${column}): error ${diagnostic.code}: ${diagnostic.message}`,
      `raw checkJs line #${diagnostic.id}`,
    );
    const key = `${diagnostic.location}|${diagnostic.code}|${diagnostic.message}`;
    assert.ok(!seen.has(key), `duplicate checkJs diagnostic #${diagnostic.id}`);
    seen.add(key);
  }
});

test('all triage entries have ported TypeScript counterparts and evidence, with no pending rows', () => {
  const counts = { a: 0, b: 0, c: 0 };
  for (const diagnostic of fixture.diagnostics) {
    counts[diagnostic.class]++;
    assert.equal(diagnostic.portStatus, 'ported', `diagnostic #${diagnostic.id}`);
    assert.ok(diagnostic.rationale.trim(), `missing rationale for #${diagnostic.id}`);
    assert.doesNotMatch(diagnostic.rationale, /pending/i, `pending rationale for #${diagnostic.id}`);

    const counterpart = resolve(pluginRoot, diagnostic.counterpart.replace(/^design-lab\//, ''));
    assert.ok(existsSync(counterpart), `missing TS counterpart for #${diagnostic.id}: ${diagnostic.counterpart}`);
    assert.ok(diagnostic.evidence.length, `missing evidence for #${diagnostic.id}`);
    for (const evidence of diagnostic.evidence) {
      const path = resolve(pluginRoot, evidence.file.replace(/^design-lab\//, ''));
      assert.ok(existsSync(path), `missing evidence source for #${diagnostic.id}: ${evidence.file}`);
      assert.ok(
        readFileSync(path, 'utf8').includes(evidence.needle),
        `missing evidence needle for #${diagnostic.id}: ${evidence.needle}`,
      );
      assert.ok(evidence.claim.trim(), `missing evidence claim for #${diagnostic.id}`);
    }

    if (diagnostic.class === 'a') {
      assert.ok(diagnostic.behaviorBug?.input.trim(), `class a needs a concrete input for #${diagnostic.id}`);
      assert.ok(diagnostic.behaviorBug?.currentBehavior.trim(), `class a needs current behavior for #${diagnostic.id}`);
      assert.ok(diagnostic.behaviorBug?.portBehavior.trim(), `class a needs port behavior for #${diagnostic.id}`);
    } else assert.equal(diagnostic.behaviorBug, null, `non-bug diagnostic #${diagnostic.id}`);
  }
  assert.deepEqual(counts, fixture.counts);
  assert.deepEqual(counts, { a: 0, b: 145, c: 11 });
});
