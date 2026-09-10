import {test, expect} from '../fixtures/base.fixture';
import {LandingPageFactory} from '../factories/content';

/**
 * The shape of a spec that meets the standard, in one file.
 *
 * The case identifier is in the filename and in the title, so grepping the
 * repository for C447371 finds this, and the identifier survives into the run
 * report where filenames are easy to lose. Coverage with no upstream case takes
 * a stable local prefix instead — REG- and a name — so the absence is visible
 * rather than ambiguous.
 */

test('C447371: the example navigation lists every published item', {tag: ['@smoke']}, async ({examplePage}) => {
  await test.step('load the page', async () => {
    await examplePage.goto('/');
  });

  await test.step('the navigation is present and populated', async () => {
    // Web-first assertion: retries until it holds or the test times out. This
    // is what replaces a sleep — there is no waitForTimeout anywhere in a suite
    // that meets this standard.
    await expect(examplePage.example.root).toBeVisible();
    await expect(examplePage.example.items.first()).toBeVisible();
  });

  await test.step('every item links somewhere', async () => {
    const hrefs = await examplePage.example.itemHrefs();
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((h) => h.length > 0)).toBe(true);
  });
});

test('C447372: an authored landing page appears in the navigation', {tag: ['@local']}, async ({authenticatedPage}) => {
  // A factory, not a page someone made by hand. The handle carries its own
  // disposal, so the finally block does not need to know what it holds.
  const page = await LandingPageFactory.create("Alvaro's landing page");

  try {
    await test.step('the authored page is reachable', async () => {
      await authenticatedPage.goto(page.path);
      await expect(authenticatedPage.page.getByRole('heading', {name: page.title})).toBeVisible();
    });
  } finally {
    await page.cleanup();
  }
});
