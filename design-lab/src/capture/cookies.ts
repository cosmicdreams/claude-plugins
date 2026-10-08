import type { Page } from 'playwright';
import type { CaptureConfig } from './types.ts';
/** Close consent UI through its own controls, including DataGrail's open shadow root.
 * Never hide/remove it with CSS: an unclosed panel must fail capture.
 * cookiePreferences: false preserves a panel that is itself the component under test.
 * Without a config, the known vendors below are tried; each is expected only when its
 * script is on the page.
 */
type Vendor = { banner: string; close: string | string[]; script?: string; expected?: boolean };
const VENDORS: Vendor[] = [
  { banner: '.dg-consent-banner', close: '.dg-header-close', script: 'script[src*="consentjs.datagrail.io"]' },
  // Klaro (Drupal's klaro module): decline keeps the site in its no-consent state; a site that
  // hides the decline button (hideDeclineAll) is closed through its accept button instead.
  {
    banner: '.klaro .cookie-notice:not(.cookie-modal-notice)',
    close: ['.cn-decline', '.cm-btn-success', '.cn-ok'],
    script: 'script[src*="klaro"]',
  },
];

export async function dismissCookiePreferences(
  page: Page,
  config: Pick<CaptureConfig, 'cookiePreferences'> = {},
  { waitForLoad = false } = {},
) {
  if (config.cookiePreferences === false) return;
  const options = config.cookiePreferences ?? {};
  const timeout = options.timeout ?? 5000;
  // A config naming its own banner always expects it; one naming only a close control still
  // applies it to the DataGrail banner, as before vendors were a list.
  const vendors: Vendor[] = options.bannerSelector
    ? [{ banner: options.bannerSelector, close: options.closeSelector ?? '.dg-header-close', expected: true }]
    : options.closeSelector
      ? [{ ...VENDORS[0]!, close: options.closeSelector }, ...VENDORS.slice(1)]
      : VENDORS;
  for (const vendor of vendors) {
    const banners = page.locator(vendor.banner);
    // The vendor script loads asynchronously. Allow its initial render on navigation,
    // then check again immediately before each measurement/screenshot for late arrivals.
    const expected = vendor.expected || (vendor.script ? await page.locator(vendor.script).count() : 0);
    if (waitForLoad && expected) {
      try {
        await banners.first().waitFor({ state: 'visible', timeout });
      } catch (error) {
        if ((error as Error).name !== 'TimeoutError') throw error;
      }
    }
    for (const banner of await banners.all()) {
      if (!(await banner.isVisible())) continue;
      // Playwright CSS locators pierce open shadow roots; document.querySelector does not.
      const controls = Array.isArray(vendor.close) ? vendor.close : [vendor.close];
      let control = banner.locator(controls[0]!).first();
      for (const selector of controls) {
        if (await banner.locator(selector).count()) {
          control = banner.locator(selector).first();
          break;
        }
      }
      await control.click({ timeout });
      await banner.waitFor({ state: 'hidden', timeout });
    }
  }
}
