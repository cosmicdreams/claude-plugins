import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pluginRoot } from '../../src/runtime.ts';

test(
  'directory includes catch future Node entrypoints; Figma config permits API and rejects Node globals',
  { timeout: 30_000 },
  () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'design-lab-typecheck-'));
    try {
      for (const name of [
        'src',
        'scripts/ts-tool.ts',
        'tsconfig.src.json',
        'tsconfig.figma.json',
        'package.json',
        'package-lock.json',
      ]) {
        cpSync(resolve(pluginRoot, name), resolve(dir, name), { recursive: true });
      }
      mkdirSync(resolve(dir, 'templates/node/nested'), { recursive: true });
      mkdirSync(resolve(dir, 'src/figma'), { recursive: true });
      writeFileSync(
        resolve(dir, 'scripts/workflow.ts'),
        'const pid: number = process.pid; const bad: string = 1; export { pid, bad };\n',
      );
      writeFileSync(resolve(dir, 'templates/node/nested/entry.ts'), "export const bad: number = 'wrong';\n");
      writeFileSync(resolve(dir, 'src/figma/probe.ts'), "figma.currentPage.name = 'probe'; export {};\n");
      const check = (mode: string) =>
        spawnSync(process.execPath, [resolve(dir, 'scripts/ts-tool.ts'), mode], { cwd: dir, encoding: 'utf8' });
      const node = check('check');
      assert.notEqual(node.status, 0);
      assert.match(node.stdout, /scripts\/workflow.ts.*TS2322/);
      assert.match(node.stdout, /templates\/node\/nested\/entry.ts.*TS2322/);
      assert.doesNotMatch(node.stdout, /Cannot find name 'process'/);
      const figma = check('check-figma');
      assert.equal(figma.status, 0, figma.stdout + figma.stderr);
      writeFileSync(
        resolve(dir, 'src/figma/probe.ts'),
        "figma.currentPage.name = 'probe'; process.cwd(); export {};\n",
      );
      const noNode = check('check-figma');
      assert.notEqual(noNode.status, 0);
      assert.match(noNode.stdout, /Cannot find name 'process'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
