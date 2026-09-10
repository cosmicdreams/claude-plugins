import {test as base, expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {ExamplePage} from './ExamplePage';

/**
 * The suite's entry point. Specs import test and expect from here, and receive
 * page objects already built.
 *
 * An authenticated page is a fixture, never something a spec arranges itself.
 * It builds its own context from a stored session and closes it afterwards, so
 * a session cannot leak into an anonymous test.
 */
type Fixtures = {
  examplePage: ExamplePage;
  authenticatedPage: ExamplePage;
};

const SESSION = 'tests/e2e/.auth/editor.json';

export const test = base.extend<Fixtures>({
  examplePage: async ({page}, use) => {
    await use(new ExamplePage(page));
  },

  authenticatedPage: async ({browser, baseURL}, use, testInfo) => {
    const local = !!baseURL && /\.ddev\.site|localhost/.test(baseURL);
    if (!local || !existsSync(SESSION)) {
      testInfo.skip(true, 'authenticated coverage runs against a local site only');
      return;
    }
    const context = await browser.newContext({storageState: SESSION, ignoreHTTPSErrors: true});
    const page = await context.newPage();
    try {
      await use(new ExamplePage(page));
    } finally {
      await context.close();
    }
  },
});

export {expect};
