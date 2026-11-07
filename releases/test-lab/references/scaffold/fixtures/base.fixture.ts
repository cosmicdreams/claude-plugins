import {test as base, expect, APIRequestContext} from '@playwright/test';
import {existsSync} from 'node:fs';
import {ExamplePage} from '../pages/ExamplePage';
import {contentFactory, ContentFactory} from '../factories/content';

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
  /**
   * Test data factories, already bound to an authenticated request context.
   *
   * Exposed as a fixture for the same reason the authenticated page is: a spec
   * that builds its own factory builds its own credentials, and that is the
   * anti-pattern this suite exists to make visible.
   */
  content: ContentFactory;
};

const SESSION = 'tests/e2e/.auth/editor.json';

/**
 * Decide locality from the parsed hostname, never by matching the whole URL.
 *
 * A substring test against the full string is a real hole rather than a
 * theoretical one: `https://www.example.com/?next=localhost` matches, and so
 * does the host `project.ddev.site.example.com`. Either one hands a stored
 * editor session to a shared environment, which is the one thing this fixture
 * exists to prevent.
 *
 * Adjust the suffix for your own local domain — `.ddev.site` is Drupal's; the
 * rule that it must be a parsed-hostname suffix match is not negotiable.
 */
function isLocal(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  let host: string;
  try {
    host = new URL(baseURL).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.ddev.site');
}

export const test = base.extend<Fixtures>({
  examplePage: async ({page}, use) => {
    await use(new ExamplePage(page));
  },

  content: async ({playwright, baseURL}, use) => {
    const context: APIRequestContext = await playwright.request.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      httpCredentials: process.env.E2E_API_USER
        ? {username: process.env.E2E_API_USER, password: process.env.E2E_API_PASS ?? ''}
        : undefined,
    });
    try {
      await use(contentFactory(context));
    } finally {
      await context.dispose();
    }
  },

  authenticatedPage: async ({browser, baseURL}, use, testInfo) => {
    if (!isLocal(baseURL) || !existsSync(SESSION)) {
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

export {expect, isLocal};
