import { test as base } from '@playwright/test';
import { FooterPage } from '../pages/FooterPage';

type Fixtures = { footer: FooterPage };

export const test = base.extend<Fixtures>({
  footer: async ({ page }, use) => {
    await use(new FooterPage(page));
  },
});

export { expect } from '@playwright/test';
