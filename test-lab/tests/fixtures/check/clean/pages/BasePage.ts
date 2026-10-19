import { type Page } from '@playwright/test';

export class BasePage {
  constructor(readonly page: Page) {}

  async goto(path = '/') {
    await this.page.goto(path);
    await this.page.waitForLoadState('domcontentloaded');
  }
}
