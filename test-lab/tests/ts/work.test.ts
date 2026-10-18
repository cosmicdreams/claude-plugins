// The work journal, scope log and binding (plan §2, §3), over real files and a real repository's local
// configuration. The journal is written before the committed log; a verdict's check never changes it; an
// import keeps the log's order and refuses divergence before changing anything.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  bindBranch,
  boundTicket,
  currentBranch,
  importWork,
  journalPath,
  readJournal,
  readWorkFile,
  recordScopeChange,
  resolveWork,
  verifyWork,
  workFilePath,
  writeWorkFile,
  type Journal,
  type ScopeEvent,
  type WorkFile,
} from '../../src/work.ts';
import { DEV, tmp } from './support.ts';

let clock = 0;
const ev = (kind: ScopeEvent['kind'], c?: string, extra: Partial<ScopeEvent> = {}): ScopeEvent => {
  clock += 1;
  return { id: `e${clock}`, kind, ticket: 'WORK-1', ...(c === undefined ? {} : { case: c }), by: DEV, role: 'developer', standIn: false, reason: 'because', at: new Date(Date.UTC(2026, 9, 9, 0, clock)).toISOString(), ...extra };
};

function setup() {
  const data = tmp('test-lab-data-');
  process.env['TEST_LAB_DATA'] = data;
  const suite = tmp('test-lab-suite-');
  return { data, suite, key: 'repo-key' };
}

const journalOf = (key: string) => readJournal(journalPath(key, 'WORK-1'));
const fileOf = (suite: string) => readWorkFile(workFilePath(suite, 'WORK-1')) as WorkFile;

describe('scope changes go to the journal first', () => {
  test('recording start, add and drop keeps the journal and the committed log identical', () => {
    const s = setup();
    for (const e of [ev('start'), ev('add', 'ADD-1'), ev('add', 'ADD-2'), ev('drop', 'ADD-2')]) recordScopeChange(s.suite, s.key, e, 'feature/x');
    const file = fileOf(s.suite);
    assert.deepEqual(file.addendum, ['ADD-1']);
    const check = verifyWork(journalOf(s.key), file);
    assert.equal(check.ok, true, JSON.stringify(check.problems));
    assert.deepEqual(check.events.map((e) => e.kind), ['start', 'add', 'add', 'drop']);
  });

  test('a scope change that cannot apply changes neither the journal nor the log', () => {
    const s = setup();
    recordScopeChange(s.suite, s.key, ev('start'), 'feature/x');
    const before = readFileSync(journalPath(s.key, 'WORK-1'), 'utf8');
    assert.throws(() => recordScopeChange(s.suite, s.key, ev('drop', 'NOT-THERE'), 'feature/x'));
    assert.equal(readFileSync(journalPath(s.key, 'WORK-1'), 'utf8'), before);
    assert.equal(fileOf(s.suite).log.length, 1);
  });
});

describe('the committed log is checked against the journal', () => {
  function recorded() {
    const s = setup();
    for (const e of [ev('start'), ev('add', 'ADD-1'), ev('add', 'ADD-2'), ev('drop', 'ADD-2')]) recordScopeChange(s.suite, s.key, e, 'feature/x');
    return s;
  }

  test('a rebase resolved with an older work file drops an add-and-drop pair: not evaluable, then still not evaluable', () => {
    const s = recorded();
    const file = fileOf(s.suite);
    writeWorkFile(workFilePath(s.suite, 'WORK-1'), { ...file, log: file.log.slice(0, 2), addendum: ['ADD-1'] });
    const journalText = readFileSync(journalPath(s.key, 'WORK-1'), 'utf8');
    for (let i = 0; i < 3; i++) {
      const check = verifyWork(journalOf(s.key), fileOf(s.suite));
      assert.equal(check.ok, false);
      assert.equal(check.problems[0]?.kind, 'missing-event');
    }
    assert.equal(readFileSync(journalPath(s.key, 'WORK-1'), 'utf8'), journalText, 'a check never changes the journal');
    const imported = importWork(journalOf(s.key), fileOf(s.suite), s.key, new Date());
    assert.ok('refused' in imported, 'an import refuses a truncated log');
  });

  test('a declaration that disagrees with its log is not evaluable', () => {
    const s = recorded();
    const file = fileOf(s.suite);
    writeWorkFile(workFilePath(s.suite, 'WORK-1'), { ...file, addendum: ['ADD-1', 'ADD-9'] });
    assert.equal(verifyWork(journalOf(s.key), fileOf(s.suite)).problems[0]?.kind, 'declaration-mismatch');
  });

  test('an event altered in the committed log is not evaluable', () => {
    const s = recorded();
    const file = fileOf(s.suite);
    writeWorkFile(workFilePath(s.suite, 'WORK-1'), { ...file, log: file.log.map((e, i) => (i === 3 ? { ...e, reason: 'rewritten' } : e)) });
    assert.equal(verifyWork(journalOf(s.key), fileOf(s.suite)).problems[0]?.kind, 'altered-event');
  });

  test('a fresh clone of existing work is not evaluable until imported, then marked', () => {
    const s = recorded();
    const file = fileOf(s.suite);
    assert.equal(verifyWork(null, file).problems.some((p) => p.kind === 'no-journal'), true);
    const imported = importWork(null, file, s.key, new Date('2026-10-09T12:00:00Z'));
    assert.ok('journal' in imported);
    const check = verifyWork(imported.journal, file);
    assert.equal(check.ok, true);
    assert.equal(check.uncheckedBefore, '2026-10-09T12:00:00.000Z');
  });

  test('events made on a second machine need import; after import, their later loss is caught on every run', () => {
    const s = recorded();
    const mine = journalOf(s.key) as Journal;
    const file = fileOf(s.suite);
    const theirs = [ev('add', 'ADD-3', { by: 'Other Dev' })];
    const pulled: WorkFile = { ...file, log: [...file.log, ...theirs], addendum: ['ADD-1', 'ADD-3'] };
    assert.equal(verifyWork(mine, pulled).problems[0]?.kind, 'needs-import');
    const imported = importWork(mine, pulled, s.key, new Date());
    assert.ok('journal' in imported);
    assert.deepEqual(imported.journal.entries.map((e) => e.origin), ['local', 'local', 'local', 'local', 'imported']);
    for (let i = 0; i < 2; i++) assert.equal(verifyWork(imported.journal, file).problems[0]?.kind, 'missing-event');
  });

  test('a pull followed by a local scope change imports first, so the intact log passes and a later truncation fails on every run', () => {
    const s = recorded();
    const file = fileOf(s.suite);
    const theirs = ev('add', 'ADD-3', { by: 'Other Dev' });
    writeWorkFile(workFilePath(s.suite, 'WORK-1'), { ...file, log: [...file.log, theirs], addendum: ['ADD-1', 'ADD-3'] });
    recordScopeChange(s.suite, s.key, ev('add', 'ADD-4'), 'feature/x');
    const after = fileOf(s.suite);
    const j = journalOf(s.key) as Journal;
    assert.deepEqual(j.entries.map((e) => e.event.id), after.log.map((e) => e.id), 'the journal keeps the log\'s order');
    assert.equal(verifyWork(j, after).ok, true);
    writeWorkFile(workFilePath(s.suite, 'WORK-1'), { ...after, log: after.log.filter((e) => e.id !== theirs.id), addendum: ['ADD-1', 'ADD-4'] });
    for (let i = 0; i < 2; i++) assert.equal(verifyWork(journalOf(s.key), fileOf(s.suite)).ok, false);
  });

  test('a diverged journal and log: import refuses before changing anything', () => {
    const s = recorded();
    const file = fileOf(s.suite);
    const reordered: WorkFile = { ...file, log: [file.log[0], file.log[2], file.log[1], file.log[3]] as ScopeEvent[] };
    const before = readFileSync(journalPath(s.key, 'WORK-1'), 'utf8');
    writeWorkFile(workFilePath(s.suite, 'WORK-1'), reordered);
    assert.throws(() => recordScopeChange(s.suite, s.key, ev('add', 'ADD-5'), 'feature/x'), /refused before changing anything/);
    assert.equal(readFileSync(journalPath(s.key, 'WORK-1'), 'utf8'), before);
  });

  test('a hand-edited work file with a malformed event is refused when read', () => {
    const s = recorded();
    const path = workFilePath(s.suite, 'WORK-1');
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { log: Record<string, unknown>[] };
    delete raw.log[1]?.['by'];
    writeFileSync(path, JSON.stringify(raw));
    assert.throws(() => readWorkFile(path), /not a valid test-lab work file/);
  });
});

describe('which work a run judges is bound, never guessed', () => {
  function repo() {
    const root = tmp('test-lab-binding-');
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'test: fixture base');
    git('checkout', '-q', '-b', 'feature/x');
    return { root, git };
  }
  const declarations = [{ ticket: 'WORK-1', branch: 'feature/x', closed: false }];

  test('a bound branch renamed is still bound', async () => {
    const r = repo();
    await bindBranch(r.root, 'feature/x', 'WORK-1');
    r.git('branch', '-m', 'feature/renamed');
    const branch = await currentBranch(r.root);
    assert.equal(branch, 'feature/renamed');
    const res = resolveWork({ branch, bound: await boundTicket(r.root, branch as string), declarations });
    assert.deepEqual(res, { status: 'bound', ticket: 'WORK-1', via: 'git-config' });
  });

  test('an unbound branch matching a declaration only suggests; renamed, it is still not evaluable', async () => {
    const r = repo();
    const res = resolveWork({ branch: 'feature/x', bound: await boundTicket(r.root, 'feature/x'), declarations });
    assert.equal(res.status, 'unresolved');
    assert.equal(res.status === 'unresolved' ? res.suggestion : null, 'WORK-1');
    r.git('branch', '-m', 'feature/renamed');
    const renamed = resolveWork({ branch: 'feature/renamed', bound: await boundTicket(r.root, 'feature/renamed'), declarations });
    assert.equal(renamed.status, 'unresolved');
  });

  test('a detached checkout with no --work is not evaluable; --work or --no-work decide it', async () => {
    const r = repo();
    r.git('checkout', '-q', '--detach');
    assert.equal(await currentBranch(r.root), null);
    assert.equal(resolveWork({ branch: null, bound: null, declarations }).status, 'unresolved');
    assert.equal(resolveWork({ work: 'WORK-1', branch: null, bound: null, declarations }).status, 'bound');
    assert.equal(resolveWork({ noWork: true, branch: null, bound: null, declarations }).status, 'none');
  });

  test('work B on a branch inheriting A\'s declaration has an empty addendum until B declares', () => {
    const res = resolveWork({ branch: 'feature/b', bound: null, declarations });
    assert.equal(res.status, 'unresolved');
    assert.equal(res.status === 'unresolved' ? res.suggestion : 'x', null);
  });
});
