import {Locator, Page} from '@playwright/test';

/**
 * One reusable region of the interface.
 *
 * Locators are readonly and assigned in the constructor. Behaviour that reads
 * several of them at once is a method here, not logic spread across a spec.
 *
 * Locator strategy, in the order to try it:
 *
 *   1. Role and accessible name — `getByRole`, `getByLabel`, `getByText`. This
 *      asserts what a person using a screen reader receives, so a locator that
 *      breaks is usually a real accessibility regression rather than a test
 *      maintenance chore.
 *   2. A stable authored hook — `data-component-id`, `data-test`. Cheap for a
 *      front end team to add, and immune to theme churn.
 *   3. A theme class name, as a stated compromise. Acceptable where the markup
 *      offers nothing better. Comment it, and say what would improve it.
 *
 * Never a generated hook that changes on rebuild — a component framework's
 * hashed instance class is worse than a stable theme class however specific it
 * looks.
 */
export class ExampleComponent {
  readonly root: Locator;
  readonly items: Locator;

  constructor(private readonly page: Page) {
    // Preferred: the accessible role and name a person actually navigates by.
    this.root = page.getByRole('navigation', {name: 'Example'});

    // Compromise, kept as an illustration of how to record one. This markup
    // exposes no per-item role or name, so the item locator falls back to an
    // authored hook with a theme class behind it. Upgrade: ask the front end
    // team for `data-component-id` on each item, then drop the class half.
    this.items = this.root.locator('[data-component-id="example-item"], .example__item');
  }

  async itemHrefs(): Promise<string[]> {
    return this.items.evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href));
  }
}
