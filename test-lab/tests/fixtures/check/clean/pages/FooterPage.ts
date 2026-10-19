import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class FooterPage extends BasePage {
  // --- Footer ---
  readonly footer: Locator;
  readonly logo: Locator;
  readonly links: Locator;

  constructor(page: Page) {
    super(page);
    this.footer = page.getByRole('contentinfo');
    this.logo = this.footer.getByRole('link', { name: 'Home' });
    this.links = this.footer.getByRole('link');
  }

  /** Parameterized locators stay as methods. */
  link(name: string): Locator {
    return this.footer.getByRole('link', { name, exact: true });
  }
}
