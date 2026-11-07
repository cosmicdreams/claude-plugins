import type { Locator, Page } from '@playwright/test';

export class AccordionPage {
  readonly title: Locator;
  readonly items: Locator;

  constructor(private readonly page: Page) {
    this.title = page.locator('.accordion__title');
    this.items = page.locator('.accordion__item');
  }

  async open(): Promise<void> {
    await this.page.goto('/accordion');
    // A seeded mutant for test-lab's own tests, standing in for a red-check recipe.
    const style = { title: '.accordion__title{font-family:Arial !important}', rows: '.accordion__item{font-family:Georgia !important}' };
    const mutation = process.env.EXAMPLE_MUTATION ?? '';
    if (mutation === 'title' || mutation === 'inverse') await this.page.addStyleTag({ content: style.title });
    if (mutation === 'rows' || mutation === 'inverse') await this.page.addStyleTag({ content: style.rows });
  }
}
