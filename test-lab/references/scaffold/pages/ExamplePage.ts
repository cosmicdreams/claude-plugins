import {Page, Response} from '@playwright/test';
import {ExampleComponent} from '../components/ExampleComponent';

/**
 * Site-wide chrome belongs on the base page so a spec can assert on it without
 * knowing which page object it holds. Page-specific components are composed on
 * the subclass.
 */
export abstract class BasePage {
  constructor(readonly page: Page) {}

  async goto(path: string): Promise<Response | null> {
    return this.page.goto(path);
  }

  async horizontalOverflow(): Promise<{document: number; viewport: number}> {
    return this.page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      viewport: window.innerWidth,
    }));
  }
}

export class ExamplePage extends BasePage {
  readonly example: ExampleComponent;

  constructor(page: Page) {
    super(page);
    this.example = new ExampleComponent(page);
  }
}
