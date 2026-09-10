import {Locator, Page} from '@playwright/test';

/**
 * One reusable region of the interface.
 *
 * Locators are readonly and assigned in the constructor. Behaviour that reads
 * several of them at once is a method here, not logic spread across a spec.
 *
 * Comment the locator strategy when it is a compromise. Theme class names are
 * acceptable where the markup offers nothing better; say what would improve it.
 */
export class ExampleComponent {
  readonly root: Locator;
  readonly items: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('[data-test="example"], .example').first();
    this.items = this.root.locator('[data-test="example-item"], .example__item');
  }

  async itemHrefs(): Promise<string[]> {
    return this.items.evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href));
  }
}
