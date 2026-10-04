/** Close consent UI through its own controls, including DataGrail's open shadow root.
 * Never hide/remove it with CSS: an unclosed panel must fail capture.
 * cookiePreferences: false preserves a panel that is itself the component under test.
 */
export async function dismissCookiePreferences(page, config = {}, { waitForLoad = false } = {}) {
  if (config.cookiePreferences === false) return;
  const options = config.cookiePreferences ?? {};
  const bannerSelector = options.bannerSelector ?? '.dg-consent-banner';
  const closeSelector = options.closeSelector ?? '.dg-header-close';
  const timeout = options.timeout ?? 5000;
  const banners = page.locator(bannerSelector);
  // The vendor script loads asynchronously. Allow its initial render on navigation,
  // then check again immediately before each measurement/screenshot for late arrivals.
  const expected = options.bannerSelector || await page.locator('script[src*="consentjs.datagrail.io"]').count();
  if (waitForLoad && expected) {
    try { await banners.first().waitFor({ state: 'visible', timeout }); }
    catch (error) { if (error.name !== 'TimeoutError') throw error; }
  }
  for (const banner of await banners.all()) {
    if (!await banner.isVisible()) continue;
    // Playwright CSS locators pierce open shadow roots; document.querySelector does not.
    await banner.locator(closeSelector).first().click({ timeout });
    await banner.waitFor({ state: 'hidden', timeout });
  }
}
