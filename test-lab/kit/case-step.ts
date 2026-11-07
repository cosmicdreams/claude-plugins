// caseStep(): one Playwright step per case step, one nested caseStep per obligation, each carrying its
// case, step and obligation IDs to the step reporter. The IDs travel as a step attachment
// (TestStepInfo.attach), which round-trips on every supported Playwright release from 1.58; step
// `params` (1.63+) are not used, so one code path serves every version.
//
// Each attachment also records the configuration the step really ran under: the project, the viewport
// read from the page (a describe-scope `test.use({ viewport })` is not visible in testInfo.project.use),
// the role the project's storageState names, and the browser's name and version.

import { test, type Page, type TestDetails, type TestStepInfo } from '@playwright/test';

import { KIT_VERSION, RECORD_SCHEMA, STEP_ATTACHMENT, type RoleObservation, type StepAttachment } from './records.ts';

export type CaseStepIds = { case: string; step: string; obligation?: string };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function checkId(kind: string, value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`caseStep: ${kind} ID ${JSON.stringify(value)} is not a valid ID`);
  return value;
}

function roleOf(storageState: unknown): RoleObservation {
  if (typeof storageState === 'string') {
    const name = storageState.split(/[\\/]/).pop() ?? storageState;
    return { name: name.replace(/\.json$/i, ''), source: 'project-storage-state' };
  }
  if (storageState !== undefined && storageState !== null) return { name: 'inline', source: 'project-inline-storage-state' };
  return { name: 'anonymous', source: 'none' };
}

/** The case annotation for a test's details: `test('title', bindCase('CASE-1'), async ({ page }) => ...)`. */
export function bindCase(...caseIds: string[]): TestDetails {
  if (caseIds.length === 0) throw new Error('bindCase: name at least one case');
  return { annotation: caseIds.map((id) => ({ type: 'case', description: checkId('case', id) })) };
}

export async function caseStep<T>(
  page: Page,
  ids: CaseStepIds,
  title: string,
  body: (step: TestStepInfo) => T | Promise<T>,
): Promise<T> {
  const record: Omit<StepAttachment, 'viewport' | 'browser'> = {
    schema: RECORD_SCHEMA,
    kit: KIT_VERSION,
    case: checkId('case', ids.case),
    step: checkId('step', ids.step),
    obligation: ids.obligation === undefined ? null : checkId('obligation', ids.obligation),
    project: test.info().project.name,
    role: roleOf(test.info().project.use.storageState),
  };
  return test.step(title, async (step) => {
    const browser = page.context().browser();
    const attachment: StepAttachment = {
      ...record,
      viewport: page.viewportSize(),
      browser: browser === null ? null : { name: browser.browserType().name(), version: browser.version() },
      navigationOrigin: /^https?:\/\//.test(page.url()) ? new URL(page.url()).origin : null,
    };
    await step.attach(STEP_ATTACHMENT, { body: JSON.stringify(attachment), contentType: 'application/json' });
    return body(step);
  });
}
