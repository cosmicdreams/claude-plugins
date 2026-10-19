// Failure classes (plan §8 "Failures and flakes"): a person chooses one of five for each failure on a
// saved run. Triage records what happened; it never changes the verdict, which stays exactly as the run
// wrote it in verdict.json. The class goes to triage.json beside it, and the page is re-rendered from
// both, so the Markdown and HTML pages and the pane show it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Actor } from './authoring.ts';
import { renderHtml, renderMarkdown, VERDICT_JSON, VERDICT_MD, type VerdictFile } from './page.ts';

export const FAILURE_CLASSES = ['product-bug', 'automation-bug', 'system-issue', 'no-defect', 'to-investigate'] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];
export type TriageEntry = { failure: number; test: string; class: FailureClass; by: string; role: 'qa' | 'developer'; standIn: boolean; at: string; note: string };
export type TriageFile = { schema: 1; entries: TriageEntry[] };
export const TRIAGE_FILE = 'triage.json';

export function readTriage(runDir: string): TriageFile {
  const path = join(runDir, TRIAGE_FILE);
  if (!existsSync(path)) return { schema: 1, entries: [] };
  const v = JSON.parse(readFileSync(path, 'utf8')) as TriageFile;
  if (v.schema !== 1 || !Array.isArray(v.entries) || !v.entries.every((e) => (FAILURE_CLASSES as readonly string[]).includes(e.class) && Number.isSafeInteger(e.failure))) throw new Error(`${path} is not a test-lab triage file`);
  return v;
}

/** The latest class chosen for each failure, by its index on the page. */
export function currentClasses(triage: TriageFile): Map<number, TriageEntry> {
  const out = new Map<number, TriageEntry>();
  for (const e of triage.entries) out.set(e.failure, e);
  return out;
}

export function recordTriage(runDir: string, input: { failure: number; class: FailureClass; actor: Actor; note: string }): { failure: number; test: string; class: FailureClass; verdictUnchanged: true } {
  const file = JSON.parse(readFileSync(join(runDir, VERDICT_JSON), 'utf8')) as VerdictFile;
  const failure = file.verdict.failures[input.failure - 1];
  if (!Number.isSafeInteger(input.failure) || failure === undefined) throw new Error(`the run lists ${file.verdict.failures.length} failure(s); --failure counts from 1`);
  const test = `${failure.test.file} › ${failure.test.titlePath.join(' › ')} [${failure.project}]`;
  const triage = readTriage(runDir);
  triage.entries.push({ failure: input.failure, test, class: input.class, by: input.actor.by, role: input.actor.role, standIn: input.actor.standIn, at: new Date().toISOString(), note: input.note });
  writeFileSync(join(runDir, TRIAGE_FILE), `${JSON.stringify(triage, null, 2)}\n`);
  writeFileSync(join(runDir, VERDICT_MD), renderMarkdown(file, triage));
  writeFileSync(join(runDir, 'verdict.html'), renderHtml(file, triage));
  return { failure: input.failure, test, class: input.class, verdictUnchanged: true };
}
