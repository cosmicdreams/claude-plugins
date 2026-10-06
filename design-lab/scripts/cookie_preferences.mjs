/** Close consent UI through its own controls, including DataGrail's open shadow root.
 * Never hide/remove it with CSS: an unclosed panel must fail capture.
 * cookiePreferences: false preserves a panel that is itself the component under test.
 * Without a config, the known vendors below are tried; each is expected only when its
 * script is on the page.
 */
const VENDORS = [
  { banner: '.dg-consent-banner', close: '.dg-header-close', script: 'script[src*="consentjs.datagrail.io"]' },
  // Klaro (Drupal's klaro module): decline keeps the site in its no-consent state.
  { banner: '.klaro .cookie-notice:not(.cookie-modal-notice)', close: '.cn-decline', script: 'script[src*="klaro"]' },
];

export async function dismissCookiePreferences(page, config = {}, { waitForLoad = false } = {}) {
  if (config.cookiePreferences === false) return;
  const options = config.cookiePreferences ?? {};
  const timeout = options.timeout ?? 5000;
  const vendors = options.bannerSelector
    ? [{ banner: options.bannerSelector, close: options.closeSelector ?? '.dg-header-close', expected: true }]
    : VENDORS;
  for (const vendor of vendors) {
    const banners = page.locator(vendor.banner);
    // The vendor script loads asynchronously. Allow its initial render on navigation,
    // then check again immediately before each measurement/screenshot for late arrivals.
    const expected = vendor.expected || await page.locator(vendor.script).count();
    if (waitForLoad && expected) {
      try { await banners.first().waitFor({ state: 'visible', timeout }); }
      catch (error) { if (error.name !== 'TimeoutError') throw error; }
    }
    for (const banner of await banners.all()) {
      if (!await banner.isVisible()) continue;
      // Playwright CSS locators pierce open shadow roots; document.querySelector does not.
      await banner.locator(vendor.close).first().click({ timeout });
      await banner.waitFor({ state: 'hidden', timeout });
    }
  }
}
