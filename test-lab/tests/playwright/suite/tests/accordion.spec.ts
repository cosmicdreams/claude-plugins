import { expect, test } from '@playwright/test';

import { AccordionPage } from '../support/helpers/accordion-page';
import { bindCase, caseStep } from '../support/test-lab/case-step';

const CASE = 'EX-ACC-001';

for (const width of [1440, 900]) {
  test.describe(`accordion at ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('component title is serif and item rows are sans-serif', bindCase(CASE), async ({ page }) => {
      const accordion = new AccordionPage(page);
      await caseStep(page, { case: CASE, step: 'S1' }, 'Open the page', async () => {
        await accordion.open();
        await caseStep(page, { case: CASE, step: 'S1', obligation: 'O1' }, 'The component title renders in the serif face', async () => {
          await expect(accordion.title).toHaveCSS('font-family', /Georgia/);
        });
        await caseStep(page, { case: CASE, step: 'S1', obligation: 'O2' }, 'Every item row renders in the sans-serif face', async () => {
          await expect(accordion.items).toHaveCount(2);
          for (const item of await accordion.items.all()) await expect(item).toHaveCSS('font-family', /Arial/);
        });
      });
    });
  });
}
